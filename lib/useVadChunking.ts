"use client";
import { useCallback, useRef, useState } from 'react';

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
}

export interface UseVadChunkingReturn {
  isListening: boolean;
  isSpeaking: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

export function useVadChunking(options: UseVadChunkingOptions): UseVadChunkingReturn {
  const { onUtterance, onSpeechStart, onAudioLevel } = options;
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const vadRef = useRef<any>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  
  // Auto-Chunk: Sammelt Frames seit Sprechbeginn für forced flush
  const speechFramesRef = useRef<Float32Array[]>([]);
  const speechStartTimeRef = useRef<number>(0);
  const isSpeechActiveRef = useRef(false);
  const autoChunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utilsRef = useRef<any>(null);
  // Trackt wieviele Samples bereits per Auto-Chunk gesendet wurden
  const samplesAlreadySentRef = useRef<number>(0);

  const start = useCallback(async () => {
    const { MicVAD, utils } = await loadVad();
    utilsRef.current = utils;

    // Flush-Funktion: Erzwingt Utterance-Abschluss aus gesammelten Frames
    const flushCollectedFrames = () => {
      const frames = speechFramesRef.current;
      if (frames.length === 0) return;
      
      // Frames zusammenfügen
      const totalLength = frames.reduce((sum, f) => sum + f.length, 0);
      const combined = new Float32Array(totalLength);
      let offset = 0;
      for (const frame of frames) {
        combined.set(frame, offset);
        offset += frame.length;
      }
      speechFramesRef.current = [];
      
      // Merken wieviel wir schon gesendet haben (für onSpeechEnd Deduplizierung)
      samplesAlreadySentRef.current += totalLength;
      
      console.log(`[VAD] Auto-chunk: ${(totalLength / 16000).toFixed(1)}s Audio (total sent: ${(samplesAlreadySentRef.current / 16000).toFixed(1)}s)`);
      const wavBuffer = utils.encodeWAV(combined);
      const blob = new Blob([wavBuffer], { type: 'audio/wav' });
      onUtterance(blob);
    };

    const vad = await MicVAD.new({
      // Assets liegen in /public/
      baseAssetPath: '/',
      onnxWASMBasePath: '/',
      model: 'v5',

      // Tuning: etwas konservativer, damit kurze Denk-/Atempausen
      // nicht mitten im Satz ein Utterance beenden.
      // Etwas empfindlicherer Start, damit der Beginn leiser/komplizierter
      // Wortfolgen nicht erst mitten in der Äußerung erkannt wird.
      positiveSpeechThreshold: 0.42,
      negativeSpeechThreshold: 0.35,
      redemptionFrames: 10,       // ~600ms Pause bis zum Commit
      minSpeechFrames: 4,         // Mind. ~240ms Sprache gegen Fehlzündungen
      preSpeechPadFrames: 15,     // ~900ms Audio vor Sprechbeginn

      onSpeechStart: () => {
        setIsSpeaking(true);
        isSpeechActiveRef.current = true;
        speechFramesRef.current = [];
        speechStartTimeRef.current = Date.now();
        samplesAlreadySentRef.current = 0;
        console.log('[VAD] Speech start detected');
        onSpeechStart?.();
        
        // Auto-Chunk deaktiviert: Schneidet bei schnellem Sprechen mitten im Satz
        // und erzeugt Duplikate/Fragmente. VAD onSpeechEnd reicht als Trigger.
      },

      onSpeechEnd: (audio: Float32Array) => {
        setIsSpeaking(false);
        isSpeechActiveRef.current = false;
        speechFramesRef.current = [];
        speechStartTimeRef.current = 0;
        if (autoChunkTimerRef.current) {
          clearTimeout(autoChunkTimerRef.current);
          autoChunkTimerRef.current = null;
        }
        
        // Etwas mehr Nachlauf-Stille hilft, dass Endsilben und das letzte
        // Wort am Chunk-Ende nicht abgeschnitten werden.
        const padSamples = Math.round(0.45 * 16000); // 450ms bei 16kHz
        const padded = new Float32Array(audio.length + padSamples);
        padded.set(audio, 0);
        const wavBuffer = utils.encodeWAV(padded);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        console.log(`[VAD] Speech end -> utterance ${estimateWavDurationSeconds(blob.size).toFixed(2)}s, ${blob.size} bytes`);
        onUtterance(blob);
      },

      onVADMisfire: () => {
        const bufferedSamples = speechFramesRef.current.reduce((sum, frame) => sum + frame.length, 0);
        const bufferedSeconds = bufferedSamples / 16000;
        const activeMs = speechStartTimeRef.current > 0 ? Date.now() - speechStartTimeRef.current : 0;
        const frameCount = speechFramesRef.current.length;
        setIsSpeaking(false);
        isSpeechActiveRef.current = false;
        speechFramesRef.current = [];
        speechStartTimeRef.current = 0;
        samplesAlreadySentRef.current = 0;
        if (autoChunkTimerRef.current) {
          clearTimeout(autoChunkTimerRef.current);
          autoChunkTimerRef.current = null;
        }
        console.warn(
          `[VAD] Misfire - speech start discarded after ${activeMs}ms with ${bufferedSeconds.toFixed(2)}s buffered audio across ${frameCount} frames. No utterance will be transcribed.`
        );
      },

      onFrameProcessed: (_probs: any, frame: Float32Array) => {
        // Frames sammeln für Auto-Chunk (nur während Sprechen)
        if (isSpeechActiveRef.current && speechStartTimeRef.current > 0) {
          speechFramesRef.current.push(new Float32Array(frame));
        }
        
        // Audio-Level aus Analyser lesen (wenn vorhanden)
        if (analyserRef.current && onAudioLevel) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          onAudioLevel(Math.min(100, (average / 128) * 100));
        }
      },
    });

    vadRef.current = vad;

    // Audio-Level-Analyser an den AudioContext der VAD hängen
    try {
      const audioCtx = (vad as any)._audioContext as AudioContext | undefined;
      const source = (vad as any)._mediaStreamAudioSourceNode as MediaStreamAudioSourceNode | undefined;
      if (audioCtx && source) {
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
      }
    } catch {
      // Nicht kritisch – Audio Level funktioniert halt nicht
    }

    await vad.start();
    setIsListening(true);
  }, [onUtterance, onSpeechStart, onAudioLevel]);

  const stop = useCallback(() => {
    // Auto-Chunk Timer aufräumen
    if (autoChunkTimerRef.current) {
      clearTimeout(autoChunkTimerRef.current);
      autoChunkTimerRef.current = null;
    }
    // Letzte gesammelte Frames noch als Utterance senden
    if (isSpeechActiveRef.current && speechFramesRef.current.length > 0 && utilsRef.current) {
      const frames = speechFramesRef.current;
      const totalLength = frames.reduce((sum, f) => sum + f.length, 0);
      if (totalLength > 1600) { // mind. 100ms Audio
        const combined = new Float32Array(totalLength);
        let offset = 0;
        for (const frame of frames) {
          combined.set(frame, offset);
          offset += frame.length;
        }

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
    speechStartTimeRef.current = 0;
    isSpeechActiveRef.current = false;
    
    if (vadRef.current) {
      vadRef.current.destroy();
      vadRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    analyserRef.current = null;
    setIsListening(false);
    setIsSpeaking(false);
  }, [onUtterance]);

  return { isListening, isSpeaking, start, stop };
}
