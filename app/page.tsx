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
      <div className="flex gap-2">
        {!recording ? (
          <button className="px-4 py-2 bg-black text-white rounded" onClick={startRecording}>Aufnahme starten</button>
        ) : (
          <button className="px-4 py-2 bg-red-600 text-white rounded" onClick={stopRecording}>Aufnahme stoppen</button>
        )}
        <button className="px-4 py-2 border rounded" onClick={handleTranscribeFromRecording} disabled={busy}>Transkribieren</button>
      </div>
    </div>
  );

  const DateiUpload = (
    <div className="space-y-4">
      <input type="file" accept="audio/*" onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
      }} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <label className="text-sm">Format:</label>
        <select className="border rounded px-2 py-1" value={mode} onChange={(e) => setMode(e.target.value as any)}>
          <option value="arztbrief">Arztbrief</option>
          <option value="befund">Befund</option>
        </select>
      </div>

      <Tabs
        tabs={[
          { label: 'Aufnehmen', content: Aufnahme },
          { label: 'Datei hochladen', content: DateiUpload },
        ]}
      />

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div className="space-y-2">
        <label className="text-sm font-medium">Ergebnis</label>
        <textarea
          className="w-full h-64 border rounded p-2 font-mono text-sm"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Transkribierter Text erscheint hier..."
        />
        <div className="flex flex-wrap gap-2">
          <button className="px-4 py-2 border rounded" onClick={handleFormat} disabled={busy || !transcript}>Korrigieren & Formatieren</button>
          <button className="px-4 py-2 border rounded" onClick={handleCopy} disabled={!transcript}>Kopieren</button>
          <button className="px-4 py-2 border rounded" onClick={handleExportDocx} disabled={!transcript}>Als .docx exportieren</button>
        </div>
      </div>
    </div>
  );
}
