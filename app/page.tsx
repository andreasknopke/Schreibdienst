"use client";
import { useEffect, useRef, useState, useCallback } from 'react';
import { Tabs } from '@/components/Tabs';
import { exportDocx } from '@/lib/formatMedical';
import Spinner from '@/components/Spinner';

// Intervall für kontinuierliche Transkription (in ms)
const TRANSCRIPTION_INTERVAL = 5000;

export default function HomePage() {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const allChunksRef = useRef<BlobPart[]>([]);
  const transcriptionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [transcript, setTranscript] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [mode, setMode] = useState<'arztbrief' | 'befund'>('arztbrief');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Funktion zum Transkribieren eines Blobs
  const transcribeChunk = useCallback(async (blob: Blob, isLive: boolean = false): Promise<string> => {
    try {
      const fd = new FormData();
      fd.append('file', blob, 'audio.webm');
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`Transkription fehlgeschlagen (${res.status})`);
      const data = await res.json();
      return data.text || '';
    } catch (err: any) {
      if (!isLive) {
        setError(err.message || 'Unbekannter Fehler');
      }
      return '';
    }
  }, []);

  // Kontinuierliche Transkription während der Aufnahme
  const processLiveTranscription = useCallback(async () => {
    if (allChunksRef.current.length === 0) return;
    
    setTranscribing(true);
    try {
      // Transkribiere alle bisher gesammelten Chunks
      const blob = new Blob(allChunksRef.current, { type: 'audio/webm' });
      const text = await transcribeChunk(blob, true);
      if (text) {
        setLiveTranscript(text);
      }
    } finally {
      setTranscribing(false);
    }
  }, [transcribeChunk]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (transcriptionIntervalRef.current) {
        clearInterval(transcriptionIntervalRef.current);
      }
    };
  }, []);

  async function startRecording() {
    setError(null);
    setLiveTranscript("");
    chunksRef.current = [];
    allChunksRef.current = [];
    
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
        allChunksRef.current.push(e.data);
      }
    };
    
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
    };
    
    mediaRecorderRef.current = mr;
    // Request data every second for more granular chunks
    mr.start(1000);
    setRecording(true);
    
    // Starte kontinuierliche Transkription
    transcriptionIntervalRef.current = setInterval(() => {
      processLiveTranscription();
    }, TRANSCRIPTION_INTERVAL);
  }

  async function stopRecording() {
    // Stoppe das Intervall
    if (transcriptionIntervalRef.current) {
      clearInterval(transcriptionIntervalRef.current);
      transcriptionIntervalRef.current = null;
    }
    
    mediaRecorderRef.current?.stop();
    setRecording(false);
    
    // Finale Transkription mit allen Chunks
    if (allChunksRef.current.length > 0) {
      setBusy(true);
      try {
        const blob = new Blob(allChunksRef.current, { type: 'audio/webm' });
        const text = await transcribeChunk(blob, false);
        if (text) {
          setTranscript(text);
          setLiveTranscript("");
        }
      } finally {
        setBusy(false);
      }
    }
  }

  async function transcribeBlob(blob: Blob) {
    setBusy(true);
    setError(null);
    try {
      const text = await transcribeChunk(blob, false);
      setTranscript(text);
    } finally {
      setBusy(false);
    }
  }

  async function handleTranscribeFromRecording() {
    if (allChunksRef.current.length === 0) return;
    const blob = new Blob(allChunksRef.current, { type: 'audio/webm' });
    await transcribeBlob(blob);
  }

  async function handleFile(file: File) {
    await transcribeBlob(file);
  }

  async function handleFormat() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: transcript, mode }),
      });
      if (!res.ok) throw new Error('Formatierung fehlgeschlagen');
      const data = await res.json();
      setTranscript(data.text);
    } catch (err: any) {
      setError(err.message || 'Fehler bei der Formatierung');
    } finally {
      setBusy(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(transcript);
  }

  async function handleExportDocx() {
    await exportDocx(transcript, mode);
  }

  const Aufnahme = (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {recording ? (
          <span className="badge inline-flex items-center gap-2">
            <span className="pulse-dot" /> 
            Aufnahme läuft
            {transcribing && <span className="ml-2 text-xs opacity-70">(transkribiert...)</span>}
          </span>
        ) : (
          <span className="badge">Bereit</span>
        )}
      </div>
      
      {/* Live-Transkription während Aufnahme */}
      {recording && liveTranscript && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Live-Vorschau</span>
            {transcribing && <Spinner size={12} />}
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{liveTranscript}</p>
        </div>
      )}
      
      <div className="flex gap-2">
        {!recording ? (
          <button className="btn btn-primary" onClick={startRecording}>Aufnahme starten</button>
        ) : (
          <button className="btn text-white" style={{ background: '#dc2626' }} onClick={stopRecording} disabled={busy}>
            {busy ? <Spinner className="mr-2" size={14} /> : null} Aufnahme stoppen
          </button>
        )}
      </div>
    </div>
  );

  const DateiUpload = (
    <div className="space-y-4">
      <input className="input" type="file" accept="audio/*" onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
      }} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="card-body flex items-center gap-3">
          <label className="text-sm text-gray-600">Format:</label>
          <select className="select max-w-xs" value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="arztbrief">Arztbrief</option>
            <option value="befund">Befund</option>
          </select>
        </div>
      </div>

      <Tabs
        tabs={[
          { label: 'Aufnehmen', content: Aufnahme },
          { label: 'Datei hochladen', content: DateiUpload },
        ]}
      />

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="card-body space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Ergebnis</label>
            <span className="text-xs text-gray-500">{transcript ? `${transcript.length} Zeichen` : ''}</span>
          </div>
          <textarea
            className="textarea font-mono text-sm"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Transkribierter Text erscheint hier..."
          />
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={handleFormat} disabled={busy || !transcript}>
              {busy && <Spinner className="mr-2" size={14} />} Korrigieren & Formatieren
            </button>
            <button className="btn btn-outline" onClick={handleCopy} disabled={!transcript}>Kopieren</button>
            <button className="btn btn-outline" onClick={handleExportDocx} disabled={!transcript}>Als .docx exportieren</button>
          </div>
        </div>
      </div>
    </div>
  );
}
