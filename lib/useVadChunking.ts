"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMicrophone } from '@/lib/MicrophoneContext';

/**
 * VAD-basiertes Utterance-Chunking für Online-Diktat.
 * 
 * Nutzt @ricky0123/vad-web (Silero ONNX) um Sprachpausen zu erkennen.
 * Jede Utterance (Sprachsegment zwischen Pausen) wird einmal an /api/transcribe
 * geschickt und danach als "committed" gelockt – sie ändert sich nie mehr.
 * 
 * Während gesprochen wird, zeigt "tentative" den noch nicht abgeschlossenen
 * Audio-Abschnitt an (wird bei jeder Pause finalisiert).
 * 
 * Auto-Chunk: Nach MAX_UTTERANCE_SECONDS wird auch ohne Pause automatisch
 * ein Chunk abgeschlossen und transkribiert, damit bei schnellem Sprechen
 * keine langen Wartezeiten entstehen.
 */

// Max. Dauer einer Utterance bevor Auto-Chunk greift (Sekunden)
const MAX_UTTERANCE_SECONDS = 8;
const PRE_SPEECH_PAD_FRAMES = 30; // ~900ms (30ms/Frame) – schützt das erste Wort
const WAV_HEADER_BYTES = 44;
const WAV_BYTES_PER_SECOND = 16000 * 2;

function estimateWavDurationSeconds(blobSize: number): number {
  return Math.max(0, (blobSize - WAV_HEADER_BYTES) / WAV_BYTES_PER_SECOND);
}

// Dynamischer Import damit SSR nicht crasht
let MicVADImport: any = null;
let utilsImport: any = null;

async function loadVad() {
  if (!MicVADImport) {
    const mod = await import('@ricky0123/vad-web');
    MicVADImport = mod.MicVAD;
    utilsImport = mod.utils;
  }
  return { MicVAD: MicVADImport, utils: utilsImport };
}

export interface UseVadChunkingOptions {
  /** Aufgerufen wenn eine Utterance finalisiert ist (nach Pause). Audio als WAV-Blob. */
  onUtterance: (wavBlob: Blob) => void;
  /** Aufgerufen wenn Sprache beginnt (für tentative-Anzeige) */
  onSpeechStart?: () => void;
  /** Audio-Level Callback (0-100) */
  onAudioLevel?: (level: number) => void;
  /** VAD-Erkennungsschwelle (0.30 = empfindlich, 0.75 = unempfindlich). Default: 0.42.
   *  Höhere Werte filtern leise Hintergrundgeräusche und Nebengespräche besser aus. */
  vadThreshold?: number;
}

export interface UseVadChunkingReturn {
  isListening: boolean;
  isSpeaking: boolean;
  /** Aufnahme starten (erster Aufruf: Stream+Prewarm+MicVAD+Pre-Roll; danach: nur Resume) */
  start: () => Promise<void>;
  /** Aufnahme pausieren (Stream läuft weiter, kein destroy – schnelles Wieder-Anschalten) */
  stop: () => Promise<void>;
  /** Kompletter Cleanup: MicVAD.destroy(), Stream stoppen. Nur bei Unmount / Seitenwechsel. */
  destroy: () => Promise<void>;
}

export function useVadChunking(options: UseVadChunkingOptions): UseVadChunkingReturn {
  const { onUtterance, onSpeechStart, onAudioLevel, vadThreshold = 0.42 } = options;
  const { getStream: getMicStream } = useMicrophone();
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const vadRef = useRef<any>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const sessionIdRef = useRef(0);
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  const firstStartDoneRef = useRef(false);
  // isPausedRef steuert die VAD-Frame-Callbacks: wenn true, werden alle
  // Frames verworfen (Stream läuft im Hintergrund, aber keine Utterances).
  // Löst das Closure-Problem: die Callbacks werden einmal beim ersten
  // MicVAD.new registriert und vergleichen gegen diese Ref statt gegen
  // eine eingefrorene sessionId-Closure.
  const isPausedRef = useRef(true);

  const vadThresholdRef = useRef(vadThreshold);
  vadThresholdRef.current = vadThreshold;

  useEffect(() => {
    if (vadRef.current?.frameProcessor?.setOptions) {
      const pos = vadThresholdRef.current;
      const neg = Math.max(0.1, pos - 0.07);
      vadRef.current.frameProcessor.setOptions({
        positiveSpeechThreshold: pos,
        negativeSpeechThreshold: neg,
      });
    }
  }, [vadThreshold]);

  const speechFramesRef = useRef<Float32Array[]>([]);
  const preSpeechFramesRef = useRef<Float32Array[]>([]);
  const speechStartTimeRef = useRef<number>(0);
  const isSpeechActiveRef = useRef(false);
  const autoChunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utilsRef = useRef<any>(null);
  const samplesAlreadySentRef = useRef<number>(0);

  const start = useCallback(async () => {
    if (stopPromiseRef.current) {
      const DESTROY_TIMEOUT_MS = 5000;
      await Promise.race([
        stopPromiseRef.current,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Destroy-Timeout nach ' + DESTROY_TIMEOUT_MS + 'ms')), DESTROY_TIMEOUT_MS)
        ),
      ]).catch((err) => {
        console.warn('[VAD] stopPromiseRef.current timeout – force-clearing:', err?.message || err);
        stopPromiseRef.current = null;
      });
    }

    const isFirstStart = !firstStartDoneRef.current;

    // ── Erster Start: MicVAD erstellen, Stream vorwärmen ──────────
    if (isFirstStart) {
      firstStartDoneRef.current = true;

      // Stream vorwärmen: Nordic-USB (VID=0x1915) braucht 200-800ms
      try {
        const warmStream = await getMicStream({
          channelCount: 1, echoCancellation: true,
          autoGainControl: true, noiseSuppression: true,
        });
        await new Promise(r => setTimeout(r, 600));
        warmStream.getTracks().forEach(t => t.stop());
      } catch { /* optional */ }

      const sessionId = sessionIdRef.current + 1;
      sessionIdRef.current = sessionId;

      const { MicVAD, utils } = await loadVad();
      utilsRef.current = utils;

      const vad = await MicVAD.new({
        baseAssetPath: '/',
        onnxWASMBasePath: '/',
        model: 'v5',
        getStream: () => getMicStream({
          channelCount: 1, echoCancellation: true,
          autoGainControl: true, noiseSuppression: true,
        }),
        startOnLoad: false,
        positiveSpeechThreshold: vadThresholdRef.current,
        negativeSpeechThreshold: Math.max(0.1, vadThresholdRef.current - 0.07),
        redemptionFrames: 10,
        minSpeechFrames: 4,
        preSpeechPadFrames: 30,

        onSpeechStart: () => {
          if (isPausedRef.current) return;
          if (sessionIdRef.current !== sessionId) return;
          setIsSpeaking(true);
          isSpeechActiveRef.current = true;
          speechFramesRef.current = preSpeechFramesRef.current.map(f => new Float32Array(f));
          speechStartTimeRef.current = Date.now();
          samplesAlreadySentRef.current = 0;
          onSpeechStart?.();
        },

        onSpeechEnd: (audio: Float32Array) => {
          if (isPausedRef.current) return;
          if (sessionIdRef.current !== sessionId) return;
          setIsSpeaking(false);
          isSpeechActiveRef.current = false;
          speechFramesRef.current = [];
          preSpeechFramesRef.current = [];
          speechStartTimeRef.current = 0;
          if (autoChunkTimerRef.current) {
            clearTimeout(autoChunkTimerRef.current);
            autoChunkTimerRef.current = null;
          }
          const padSamples = Math.round(0.45 * 16000);
          const padded = new Float32Array(audio.length + padSamples);
          padded.set(audio, 0);
          const wavBuffer = utils.encodeWAV(padded);
          const blob = new Blob([wavBuffer], { type: 'audio/wav' });
          console.log(`[VAD] Speech end -> utterance ${estimateWavDurationSeconds(blob.size).toFixed(2)}s, ${blob.size} bytes`);
          onUtterance(blob);
        },

        onVADMisfire: () => {
          if (isPausedRef.current) return;
          if (sessionIdRef.current !== sessionId) return;
          setIsSpeaking(false);
          isSpeechActiveRef.current = false;
          speechFramesRef.current = [];
          preSpeechFramesRef.current = [];
          speechStartTimeRef.current = 0;
          samplesAlreadySentRef.current = 0;
          if (autoChunkTimerRef.current) { clearTimeout(autoChunkTimerRef.current); autoChunkTimerRef.current = null; }
          console.warn('[VAD] Misfire - discarded');
        },

        onFrameProcessed: (_probs: any, frame: Float32Array) => {
          if (isPausedRef.current) return;
          if (sessionIdRef.current !== sessionId) return;
          const frameCopy = new Float32Array(frame);
          preSpeechFramesRef.current.push(frameCopy);
          if (preSpeechFramesRef.current.length > PRE_SPEECH_PAD_FRAMES) {
            preSpeechFramesRef.current.shift();
          }
          if (isSpeechActiveRef.current && speechStartTimeRef.current > 0) {
            speechFramesRef.current.push(frameCopy);
          }
          if (analyserRef.current && onAudioLevel) {
            const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
            analyserRef.current.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a: number, b: number) => a + b) / dataArray.length;
            onAudioLevel(Math.min(100, (average / 128) * 100));
          }
        },
      });

      vadRef.current = vad;

      if (sessionIdRef.current !== sessionId) { await vad.destroy(); vadRef.current = null; return; }

      try {
        const audioCtx = (vad as any)._audioContext as AudioContext | undefined;
        const source = (vad as any)._mediaStreamAudioSourceNode as MediaStreamAudioSourceNode | undefined;
        if (audioCtx && source) {
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analyserRef.current = analyser;
        }
      } catch { /* non-critical */ }

      let startAttempts = 0;
      while (startAttempts < 3) {
        try { await vad.start(); break; }
        catch (err) {
          startAttempts++;
          if (startAttempts >= 3) throw err;
          console.warn(`[VAD] start() attempt ${startAttempts} failed – retrying in 400ms...`);
          await new Promise(r => setTimeout(r, 400));
        }
      }
      if (sessionIdRef.current !== sessionId) { await vad.destroy(); vadRef.current = null; return; }

      // Pre-Roll nur beim ersten Start: warten bis Pre-Speech-Buffer mit
      // echtem Audio gefüllt ist (kalte USB-Pipeline → erstes Wort sonst weg)
      {
        const deadline = Date.now() + 3000;
        while (preSpeechFramesRef.current.length < PRE_SPEECH_PAD_FRAMES) {
          if (Date.now() > deadline) {
            console.warn(`[VAD] Pre-roll timeout – ${preSpeechFramesRef.current.length}/${PRE_SPEECH_PAD_FRAMES} frames`);
            break;
          }
          await new Promise(r => setTimeout(r, 50));
        }
        console.log(`[VAD] First-start pre-roll done: ${preSpeechFramesRef.current.length} frames`);
      }
      isPausedRef.current = false;
      setIsListening(true);
      return;
    }

    // ── Folge-Aufruf: Stream läuft noch (pausiert) → nur Resume ──
    const currentVad = vadRef.current;
    if (!currentVad) {
      console.warn('[VAD] start() called but vadRef is null – re-creating');
      firstStartDoneRef.current = false;
      return start();
    }

    const resumeId = sessionIdRef.current + 1;
    sessionIdRef.current = resumeId;

    // Resume: VAD-Callbacks wieder scharf schalten BEVOR start() aufgerufen wird.
    // Sonst würden die ersten Frames nach start() noch von isPausedRef=true
    // abgefangen, und der Pre-Speech-Buffer bliebe leer.
    isPausedRef.current = false;

    try {
      await currentVad.start();
    } catch (err: any) {
      console.error('[VAD] resume failed:', err?.message || err);
      isPausedRef.current = true;
      firstStartDoneRef.current = false;
      vadRef.current = null;
      return start();
    }
    if (sessionIdRef.current !== resumeId) return;

    // Kurzer Pre-Roll (~50ms). Stream ist warm, Frames kommen sofort da
    // isPausedRef bereits false ist und onFrameProcessed den Buffer füllt.
    await new Promise(r => setTimeout(r, 50));
    setIsListening(true);

    return;
  }, [onUtterance, onSpeechStart, onAudioLevel, getMicStream]);

  const stop = useCallback(() => {
    // VAD-Callbacks sofort stummschalten, damit keine neuen Frames mehr
    // gesammelt werden. Die bereits gesammelten werden im Stop-Flush unten
    // noch als Utterance gesendet.
    isPausedRef.current = true;
    sessionIdRef.current += 1;

    if (autoChunkTimerRef.current) { clearTimeout(autoChunkTimerRef.current); autoChunkTimerRef.current = null; }

    // Letzte gesammelte Frames als Utterance senden
    if (isSpeechActiveRef.current && speechFramesRef.current.length > 0 && utilsRef.current) {
      const frames = speechFramesRef.current;
      const totalLength = frames.reduce((sum, f) => sum + f.length, 0);
      if (totalLength > 1600) {
        const combined = new Float32Array(totalLength);
        let offset = 0;
        for (const frame of frames) { combined.set(frame, offset); offset += frame.length; }
        const padSamples = Math.round(0.45 * 16000);
        const padded = new Float32Array(combined.length + padSamples);
        padded.set(combined, 0);
        const wavBuffer = utilsRef.current.encodeWAV(padded);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        console.log(`[VAD] Stop flush -> utterance ${estimateWavDurationSeconds(blob.size).toFixed(2)}s, ${blob.size} bytes`);
        onUtterance(blob);
      }
    }
    speechFramesRef.current = [];
    preSpeechFramesRef.current = [];
    speechStartTimeRef.current = 0;
    isSpeechActiveRef.current = false;
    setIsListening(false);
    setIsSpeaking(false);
    samplesAlreadySentRef.current = 0;

    // Nur pausieren – Stream + MicVAD bleiben am Leben für schnelles Resume
    const currentVad = vadRef.current;
    const pausePromise = (async () => {
      if (currentVad) {
        await Promise.race([
          currentVad.pause(),
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('VAD pause timeout')), 3000)),
        ]).catch(err => { console.warn('[VAD] pause error:', err?.message || err); });
      }
    })().finally(() => { stopPromiseRef.current = null; });

    stopPromiseRef.current = pausePromise;
    return pausePromise;
  }, [onUtterance]);

  const destroy = useCallback(async () => {
    sessionIdRef.current += 1;
    const currentVad = vadRef.current;
    vadRef.current = null;
    firstStartDoneRef.current = false;
    if (currentVad) {
      await Promise.race([
        currentVad.destroy(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('VAD destroy timeout')), 3000)),
      ]).catch(err => { console.warn('[VAD] destroy error:', err?.message || err); });
    }
    analyserRef.current = null;
    speechFramesRef.current = [];
    preSpeechFramesRef.current = [];
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  // Cleanup bei Unmount
  useEffect(() => {
    return () => { destroy(); };
  }, [destroy]);

  return { isListening, isSpeaking, start, stop, destroy };
}
