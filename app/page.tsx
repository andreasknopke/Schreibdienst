"use client";
import { useEffect, useRef, useState, useCallback } from 'react';
import { Tabs } from '@/components/Tabs';
import { exportDocx } from '@/lib/formatMedical';
import Spinner from '@/components/Spinner';

// Intervall für kontinuierliche Transkription (in ms)
const TRANSCRIPTION_INTERVAL = 3000;

// Steuerbefehle für Befund-Felder
type BefundField = 'methodik' | 'befund' | 'beurteilung';

export default function HomePage() {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const allChunksRef = useRef<BlobPart[]>([]);
  const transcriptionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Text der VOR dieser Aufnahme-Session existierte
  const existingTextRef = useRef<string>("");
  // Letzter transkribierter Text dieser Session
  const lastTranscriptRef = useRef<string>("");
  
  const [transcript, setTranscript] = useState("");
  const [mode, setMode] = useState<'arztbrief' | 'befund'>('arztbrief');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Befund-spezifische Felder
  const [methodik, setMethodik] = useState("");
  const [beurteilung, setBeurteilung] = useState("");
  // Aktuelles aktives Feld für Befund-Modus
  const [activeField, setActiveField] = useState<BefundField>('befund');
  // Refs für existierenden Text pro Feld
  const existingMethodikRef = useRef<string>("");
  const existingBeurteilungRef = useRef<string>("");
  const lastMethodikRef = useRef<string>("");
  const lastBeurteilungRef = useRef<string>("");

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

  // Kombiniert existierenden Text mit neuem Transkript
  const combineTexts = useCallback((existing: string, newText: string): string => {
    if (!existing) return newText;
    if (!newText) return existing;
    // Füge Leerzeichen oder Zeilenumbruch hinzu wenn nötig
    const separator = existing.endsWith('\n') || existing.endsWith(' ') ? '' : ' ';
    return existing + separator + newText;
  }, []);

  // Erkennt Steuerbefehle und extrahiert Feld-Wechsel
  const parseFieldCommands = useCallback((text: string): { field: BefundField | null; cleanedText: string } => {
    // Regex für Steuerbefehle (case-insensitive)
    const methodikPattern = /\b(methodik)\s*[:：]/gi;
    const beurteilungPattern = /\b(beurteilung|zusammenfassung)\s*[:：]/gi;
    const befundPattern = /\b(befund)\s*[:：]/gi;
    
    let field: BefundField | null = null;
    let cleanedText = text;
    
    // Suche nach dem letzten Vorkommen eines Steuerbefehls
    const methodikMatch = [...text.matchAll(methodikPattern)].pop();
    const beurteilungMatch = [...text.matchAll(beurteilungPattern)].pop();
    const befundMatch = [...text.matchAll(befundPattern)].pop();
    
    // Finde den letzten Steuerbefehl
    let lastMatch: { match: RegExpMatchArray; field: BefundField } | null = null;
    
    if (methodikMatch) {
      const index = methodikMatch.index ?? 0;
      if (!lastMatch || index > (lastMatch.match.index ?? 0)) {
        lastMatch = { match: methodikMatch, field: 'methodik' };
      }
    }
    if (beurteilungMatch) {
      const index = beurteilungMatch.index ?? 0;
      if (!lastMatch || index > (lastMatch.match.index ?? 0)) {
        lastMatch = { match: beurteilungMatch, field: 'beurteilung' };
      }
    }
    if (befundMatch) {
      const index = befundMatch.index ?? 0;
      if (!lastMatch || index > (lastMatch.match.index ?? 0)) {
        lastMatch = { match: befundMatch, field: 'befund' };
      }
    }
    
    if (lastMatch) {
      field = lastMatch.field;
      // Entferne den Steuerbefehl aus dem Text
      cleanedText = text.replace(lastMatch.match[0], '').trim();
    }
    
    return { field, cleanedText };
  }, []);

  // Verarbeitet Text und verteilt auf die richtigen Felder (für Befund-Modus)
  const processTextForBefundFields = useCallback((rawText: string) => {
    if (mode !== 'befund') {
      setTranscript(rawText);
      return;
    }
    
    const { field, cleanedText } = parseFieldCommands(rawText);
    
    // Wenn ein Feldwechsel erkannt wurde, aktualisiere das aktive Feld
    if (field) {
      setActiveField(field);
    }
    
    // Bestimme das Zielfeld (entweder neu erkannt oder das aktuelle aktive)
    const targetField = field || activeField;
    
    // Setze den Text im entsprechenden Feld
    switch (targetField) {
      case 'methodik':
        setMethodik(prev => {
          const combined = combineTexts(existingMethodikRef.current, cleanedText);
          return combined;
        });
        break;
      case 'beurteilung':
        setBeurteilung(prev => {
          const combined = combineTexts(existingBeurteilungRef.current, cleanedText);
          return combined;
        });
        break;
      case 'befund':
      default:
        setTranscript(prev => {
          const combined = combineTexts(existingTextRef.current, cleanedText);
          return combined;
        });
        break;
    }
  }, [mode, activeField, parseFieldCommands, combineTexts]);

  // Kontinuierliche Transkription während der Aufnahme
  const processLiveTranscription = useCallback(async () => {
    if (allChunksRef.current.length === 0) return;
    
    setTranscribing(true);
    try {
      const blob = new Blob(allChunksRef.current, { type: 'audio/webm' });
      const currentTranscript = await transcribeChunk(blob, true);
      
      // Nur aktualisieren wenn sich etwas geändert hat
      if (currentTranscript && currentTranscript !== lastTranscriptRef.current) {
        lastTranscriptRef.current = currentTranscript;
        
        if (mode === 'befund') {
          // Im Befund-Modus: Parse Steuerbefehle und verteile auf Felder
          const { field, cleanedText } = parseFieldCommands(currentTranscript);
          if (field) {
            setActiveField(field);
          }
          const targetField = field || activeField;
          
          switch (targetField) {
            case 'methodik':
              lastMethodikRef.current = cleanedText;
              setMethodik(combineTexts(existingMethodikRef.current, cleanedText));
              break;
            case 'beurteilung':
              lastBeurteilungRef.current = cleanedText;
              setBeurteilung(combineTexts(existingBeurteilungRef.current, cleanedText));
              break;
            case 'befund':
            default:
              setTranscript(combineTexts(existingTextRef.current, cleanedText));
              break;
          }
        } else {
          // Im Arztbrief-Modus: Normales Verhalten
          const fullText = combineTexts(existingTextRef.current, currentTranscript);
          setTranscript(fullText);
        }
      }
    } finally {
      setTranscribing(false);
    }
  }, [transcribeChunk, combineTexts, mode, activeField, parseFieldCommands]);

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
    // Bestehenden Text behalten
    existingTextRef.current = transcript.trim();
    lastTranscriptRef.current = "";
    allChunksRef.current = [];
    
    // Für Befund-Modus: Auch die anderen Felder speichern
    if (mode === 'befund') {
      existingMethodikRef.current = methodik.trim();
      existingBeurteilungRef.current = beurteilung.trim();
      lastMethodikRef.current = "";
      lastBeurteilungRef.current = "";
    }
    
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) {
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
    // Stoppe die Intervalle
    if (transcriptionIntervalRef.current) {
      clearInterval(transcriptionIntervalRef.current);
      transcriptionIntervalRef.current = null;
    }
    
    mediaRecorderRef.current?.stop();
    setRecording(false);
    
    // Finale Transkription und Korrektur mit allen Chunks
    if (allChunksRef.current.length > 0) {
      setBusy(true);
      try {
        const blob = new Blob(allChunksRef.current, { type: 'audio/webm' });
        const sessionTranscript = await transcribeChunk(blob, false);
        if (sessionTranscript) {
          // Finale Korrektur
          setCorrecting(true);
          try {
            if (mode === 'befund') {
              // Im Befund-Modus: Parse Steuerbefehle und verteile auf Felder
              const { field, cleanedText } = parseFieldCommands(sessionTranscript);
              const targetField = field || activeField;
              
              // Aktualisiere das entsprechende Feld
              let currentMethodik = methodik;
              let currentBefund = transcript;
              let currentBeurteilung = beurteilung;
              
              switch (targetField) {
                case 'methodik':
                  currentMethodik = combineTexts(existingMethodikRef.current, cleanedText);
                  break;
                case 'beurteilung':
                  currentBeurteilung = combineTexts(existingBeurteilungRef.current, cleanedText);
                  break;
                case 'befund':
                default:
                  currentBefund = combineTexts(existingTextRef.current, cleanedText);
                  break;
              }
              
              // Korrigiere alle drei Felder gleichzeitig
              const res = await fetch('/api/correct', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  befundFields: {
                    methodik: currentMethodik,
                    befund: currentBefund,
                    beurteilung: currentBeurteilung
                  }
                }),
              });
              if (res.ok) {
                const data = await res.json();
                if (data.befundFields) {
                  setMethodik(data.befundFields.methodik || currentMethodik);
                  setTranscript(data.befundFields.befund || currentBefund);
                  setBeurteilung(data.befundFields.beurteilung || currentBeurteilung);
                }
              } else {
                // Fallback: Setze unkorrigierten Text
                setMethodik(currentMethodik);
                setTranscript(currentBefund);
                setBeurteilung(currentBeurteilung);
              }
            } else {
              // Im Arztbrief-Modus: Normales Verhalten
              const fullText = combineTexts(existingTextRef.current, sessionTranscript);
              const res = await fetch('/api/correct', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: fullText }),
              });
              if (res.ok) {
                const data = await res.json();
                setTranscript(data.correctedText || fullText);
              } else {
                setTranscript(fullText);
              }
            }
          } catch {
            // Bei Fehler: Setze unkorrigierten Text
            if (mode === 'befund') {
              const { field, cleanedText } = parseFieldCommands(sessionTranscript);
              const targetField = field || activeField;
              switch (targetField) {
                case 'methodik':
                  setMethodik(combineTexts(existingMethodikRef.current, cleanedText));
                  break;
                case 'beurteilung':
                  setBeurteilung(combineTexts(existingBeurteilungRef.current, cleanedText));
                  break;
                default:
                  setTranscript(combineTexts(existingTextRef.current, cleanedText));
              }
            } else {
              setTranscript(combineTexts(existingTextRef.current, sessionTranscript));
            }
          } finally {
            setCorrecting(false);
          }
        }
      } finally {
        setBusy(false);
      }
    }
  }

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const text = await transcribeChunk(file, false);
      setTranscript(text);
      // Korrektur nach Upload
      if (text) {
        setCorrecting(true);
        try {
          const res = await fetch('/api/correct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.correctedText) {
              setTranscript(data.correctedText);
            }
          }
        } finally {
          setCorrecting(false);
        }
      }
    } finally {
      setBusy(false);
    }
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

  // Befund-spezifische Handler
  async function handleFormatBefund() {
    setBusy(true);
    setError(null);
    setCorrecting(true);
    try {
      const res = await fetch('/api/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          befundFields: {
            methodik: methodik,
            befund: transcript,
            beurteilung: beurteilung
          }
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.befundFields) {
          setMethodik(data.befundFields.methodik || methodik);
          setTranscript(data.befundFields.befund || transcript);
          setBeurteilung(data.befundFields.beurteilung || beurteilung);
        }
      } else {
        throw new Error('Korrektur fehlgeschlagen');
      }
    } catch (err: any) {
      setError(err.message || 'Fehler bei der Korrektur');
    } finally {
      setCorrecting(false);
      setBusy(false);
    }
  }

  function handleCopyBefund() {
    const combinedText = [
      methodik ? `Methodik:\n${methodik}` : '',
      transcript ? `Befund:\n${transcript}` : '',
      beurteilung ? `Beurteilung:\n${beurteilung}` : ''
    ].filter(Boolean).join('\n\n');
    navigator.clipboard.writeText(combinedText);
  }

  async function handleExportDocxBefund() {
    const combinedText = [
      methodik ? `Methodik:\n${methodik}` : '',
      transcript ? `Befund:\n${transcript}` : '',
      beurteilung ? `Beurteilung:\n${beurteilung}` : ''
    ].filter(Boolean).join('\n\n');
    await exportDocx(combinedText, mode);
  }

  // Beurteilung durch LLM vorschlagen lassen
  const [suggestingBeurteilung, setSuggestingBeurteilung] = useState(false);
  
  async function handleSuggestBeurteilung() {
    if (!transcript.trim()) return;
    
    setSuggestingBeurteilung(true);
    setError(null);
    try {
      const res = await fetch('/api/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          suggestBeurteilung: true,
          methodik: methodik,
          befund: transcript
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.suggestedBeurteilung) {
          setBeurteilung(data.suggestedBeurteilung);
        }
      } else {
        throw new Error('Beurteilung konnte nicht generiert werden');
      }
    } catch (err: any) {
      setError(err.message || 'Fehler bei der Beurteilungs-Generierung');
    } finally {
      setSuggestingBeurteilung(false);
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
            {correcting && <span className="ml-2 text-xs opacity-70">(korrigiert...)</span>}
          </span>
        ) : (
          <span className="badge">Bereit</span>
        )}
      </div>
      
      {/* Hinweis zu Sprachbefehlen */}
      {recording && (
        <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/30 p-2 rounded">
          💡 <strong>Sprachbefehle:</strong> "Punkt", "Komma", "neuer Absatz", "lösche den letzten Satz", "lösche das letzte Wort"
          {mode === 'befund' && (
            <>
              <br />
              📋 <strong>Feld-Wechsel:</strong> "Methodik:", "Befund:", "Beurteilung:" oder "Zusammenfassung:"
              <span className="ml-2 px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded text-xs">
                Aktiv: {activeField.charAt(0).toUpperCase() + activeField.slice(1)}
              </span>
            </>
          )}
        </div>
      )}
      
      <div className="flex gap-2 items-center">
        {!recording ? (
          <button 
            className="w-16 h-16 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow-lg transition-all hover:scale-105" 
            onClick={startRecording}
            title="Aufnahme starten"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </button>
        ) : (
          <button 
            className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg transition-all hover:scale-105 animate-pulse" 
            onClick={stopRecording} 
            disabled={busy}
            title="Aufnahme stoppen"
          >
            {busy ? (
              <Spinner size={24} />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2"/>
              </svg>
            )}
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

      {/* Befund-Modus: Drei separate Felder */}
      {mode === 'befund' ? (
        <div className="space-y-4">
          {/* Methodik-Feld */}
          <div className="card">
            <div className="card-body space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium flex items-center gap-2">
                  Methodik
                  {activeField === 'methodik' && recording && (
                    <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded text-xs">
                      Aktiv
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{methodik ? `${methodik.length} Zeichen` : ''}</span>
                  <button 
                    className="btn btn-sm btn-outline px-2 py-1 text-xs" 
                    onClick={() => navigator.clipboard.writeText(methodik)}
                    disabled={!methodik}
                    title="Methodik kopieren"
                  >
                    📋 Kopieren
                  </button>
                </div>
              </div>
              <textarea
                className={`textarea font-mono text-sm ${activeField === 'methodik' && recording ? 'ring-2 ring-green-500' : ''}`}
                value={methodik}
                onChange={(e) => setMethodik(e.target.value)}
                placeholder="Methodik-Text erscheint hier..."
                rows={4}
              />
            </div>
          </div>

          {/* Befund-Feld (Hauptfeld) */}
          <div className="card">
            <div className="card-body space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium flex items-center gap-2">
                  Befund
                  {activeField === 'befund' && recording && (
                    <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded text-xs">
                      Aktiv
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{transcript ? `${transcript.length} Zeichen` : ''}</span>
                  <button 
                    className="btn btn-sm btn-outline px-2 py-1 text-xs" 
                    onClick={() => navigator.clipboard.writeText(transcript)}
                    disabled={!transcript}
                    title="Befund kopieren"
                  >
                    📋 Kopieren
                  </button>
                </div>
              </div>
              <textarea
                className={`textarea font-mono text-sm ${activeField === 'befund' && recording ? 'ring-2 ring-green-500' : ''}`}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Befund-Text erscheint hier..."
              />
            </div>
          </div>

          {/* Beurteilung-Feld */}
          <div className="card">
            <div className="card-body space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium flex items-center gap-2">
                  Beurteilung
                  {activeField === 'beurteilung' && recording && (
                    <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded text-xs">
                      Aktiv
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{beurteilung ? `${beurteilung.length} Zeichen` : ''}</span>
                  <button 
                    className="btn btn-sm btn-outline px-2 py-1 text-xs" 
                    onClick={() => navigator.clipboard.writeText(beurteilung)}
                    disabled={!beurteilung}
                    title="Beurteilung kopieren"
                  >
                    📋 Kopieren
                  </button>
                </div>
              </div>
              <textarea
                className={`textarea font-mono text-sm ${activeField === 'beurteilung' && recording ? 'ring-2 ring-green-500' : ''}`}
                value={beurteilung}
                onChange={(e) => setBeurteilung(e.target.value)}
                placeholder="Beurteilung/Zusammenfassung erscheint hier..."
                rows={4}
              />
              <button 
                className="btn btn-primary w-full" 
                onClick={handleSuggestBeurteilung} 
                disabled={!transcript.trim() || suggestingBeurteilung}
              >
                {suggestingBeurteilung ? (
                  <><Spinner className="mr-2" size={14} /> Generiere Beurteilung...</>
                ) : (
                  '✨ Beurteilung vorschlagen'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Arztbrief-Modus: Ein einzelnes Feld */
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
      )}
    </div>
  );
}
