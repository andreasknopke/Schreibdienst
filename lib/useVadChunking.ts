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
 */

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

  const start = useCallback(async () => {
    const { MicVAD, utils } = await loadVad();

    const vad = await MicVAD.new({
      // Assets liegen in /public/
      baseAssetPath: '/',
      onnxWASMBasePath: '/',
      model: 'v5',

      // Tuning: 500 ms Pause = Utterance-Ende
      // minSpeechFrames verhindert Fehlzündungen bei sehr kurzen Geräuschen
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      redemptionFrames: 8,        // ~500 ms bei 16kHz/1536 Samples pro Frame
      minSpeechFrames: 5,         // Mind. ~300 ms Sprache
      preSpeechPadFrames: 3,      // Etwas Audio vor dem Sprechbeginn mitnehmen

      onSpeechStart: () => {
        setIsSpeaking(true);
        onSpeechStart?.();
      },

      onSpeechEnd: (audio: Float32Array) => {
        setIsSpeaking(false);
        // audio ist Float32 16kHz mono → WAV encodieren
        const wavBuffer = utils.encodeWAV(audio);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        onUtterance(blob);
      },

      onVADMisfire: () => {
        setIsSpeaking(false);
      },

      onFrameProcessed: () => {
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
  }, []);

  return { isListening, isSpeaking, start, stop };
}
