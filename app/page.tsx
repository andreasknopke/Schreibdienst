"use client";
import { useEffect, useRef, useState } from 'react';
import { Tabs } from '@/components/Tabs';
import { exportDocx } from '@/lib/formatMedical';

export default function HomePage() {
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [transcript, setTranscript] = useState("");
  const [mode, setMode] = useState<'arztbrief' | 'befund'>('arztbrief');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  async function startRecording() {
    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    chunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
    };
    mediaRecorderRef.current = mr;
    mr.start();
    setRecording(true);
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  async function transcribeBlob(blob: Blob) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', blob, 'audio.webm');
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`Transkription fehlgeschlagen (${res.status})`);
      const data = await res.json();
      setTranscript(data.text || '');
    } catch (err: any) {
      setError(err.message || 'Unbekannter Fehler');
    } finally {
      setBusy(false);
    }
  }

  async function handleTranscribeFromRecording() {
    if (chunksRef.current.length === 0) return;
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
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
        <span className="badge">{recording ? 'Aufnahme läuft' : 'Bereit'}</span>
      </div>
      <div className="flex gap-2">
        {!recording ? (
          <button className="btn btn-primary" onClick={startRecording}>Aufnahme starten</button>
        ) : (
          <button className="btn text-white" style={{ background: '#dc2626' }} onClick={stopRecording}>Aufnahme stoppen</button>
        )}
        <button className="btn btn-outline" onClick={handleTranscribeFromRecording} disabled={busy}>Transkribieren</button>
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

      {error && <div className="text-sm text-red-600">{error}</div>}

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
            <button className="btn btn-primary" onClick={handleFormat} disabled={busy || !transcript}>Korrigieren & Formatieren</button>
            <button className="btn btn-outline" onClick={handleCopy} disabled={!transcript}>Kopieren</button>
            <button className="btn btn-outline" onClick={handleExportDocx} disabled={!transcript}>Als .docx exportieren</button>
          </div>
        </div>
      </div>
    </div>
  );
}
