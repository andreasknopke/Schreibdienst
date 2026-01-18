"use client";
import { useCallback, useRef, useState } from 'react';

/**
 * Hook für RealtimeSTT WebSocket-basierte Echtzeit-Transkription
 * 
 * RealtimeSTT erwartet:
 * - Audio-Chunks als Float32Array (mono, 16kHz)
 * - Sendet JSON mit {text: "..."} zurück
 */

interface UseFastWhisperOptions {
  wsUrl: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

interface UseFastWhisperReturn {
  isConnected: boolean;
  isRecording: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  currentTranscript: string;
}

export function useFastWhisper(options: UseFastWhisperOptions): UseFastWhisperReturn {
  const { wsUrl, onTranscript, onError, onConnect, onDisconnect } = options;
  
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[FastWhisper] Already connected');
      return;
    }

    return new Promise<void>((resolve, reject) => {
      try {
        console.log('[FastWhisper] Connecting to', wsUrl);
        const ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          console.log('[FastWhisper] Connected');
          setIsConnected(true);
          onConnect?.();
          resolve();
        };
        
        ws.onclose = () => {
          console.log('[FastWhisper] Disconnected');
          setIsConnected(false);
          setIsRecording(false);
          onDisconnect?.();
        };
        
        ws.onerror = (event) => {
          console.error('[FastWhisper] WebSocket error:', event);
          onError?.('WebSocket connection error');
          reject(new Error('WebSocket connection failed'));
        };
        
        ws.onmessage = (event) => {
          try {
            // RealtimeSTT sendet JSON mit {text: "..."} oder plain text
            let text: string;
            let isFinal = false;
            
            if (event.data.startsWith('{')) {
              const data = JSON.parse(event.data);
              text = data.text || data.transcript || '';
              isFinal = data.is_final || data.final || false;
            } else {
              text = event.data;
              isFinal = true;
            }
            
            if (text) {
              console.log('[FastWhisper] Received:', text, isFinal ? '(final)' : '(partial)');
              setCurrentTranscript(text);
              onTranscript?.(text, isFinal);
            }
          } catch (e) {
            // Plain text response
            console.log('[FastWhisper] Received text:', event.data);
            setCurrentTranscript(event.data);
            onTranscript?.(event.data, true);
          }
        };
        
        wsRef.current = ws;
      } catch (error: any) {
        console.error('[FastWhisper] Connection error:', error);
        onError?.(error.message);
        reject(error);
      }
    });
  }, [wsUrl, onConnect, onDisconnect, onError, onTranscript]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      await connect();
    }

    try {
      // Hole Mikrofon-Stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      streamRef.current = stream;

      // Erstelle AudioContext für Audio-Processing
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      
      // ScriptProcessorNode für Audio-Chunks (deprecated aber funktioniert überall)
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Konvertiere Float32Array zu Int16Array für RealtimeSTT
        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Sende als Binary
        wsRef.current.send(int16Data.buffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsRecording(true);
      console.log('[FastWhisper] Recording started');
    } catch (error: any) {
      console.error('[FastWhisper] Error starting recording:', error);
      onError?.(error.message);
      throw error;
    }
  }, [connect, onError]);

  const stopRecording = useCallback(() => {
    // Stoppe Audio-Stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Cleanup AudioContext
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsRecording(false);
    console.log('[FastWhisper] Recording stopped');
  }, []);

  return {
    isConnected,
    isRecording,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    currentTranscript,
  };
}
