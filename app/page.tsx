"use client";
import { useEffect, useRef, useState, useCallback } from 'react';
import { Tabs } from '@/components/Tabs';
import { exportDocx } from '@/lib/formatMedical';
import Spinner from '@/components/Spinner';
import { useAuth } from '@/components/AuthProvider';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';
import { ChangeIndicator, ChangeWarningBanner } from '@/components/ChangeIndicator';
import { applyFormattingControlWords, preprocessTranscription } from '@/lib/textFormatting';
import CustomActionButtons from '@/components/CustomActionButtons';
import CustomActionsManager from '@/components/CustomActionsManager';
import DiffHighlight, { DiffStats } from '@/components/DiffHighlight';
import { parseSpeaKINGXml, readFileAsText, SpeaKINGMetadata } from '@/lib/audio';

// Identifier für PowerShell Clipboard-Listener (RadCentre Integration)
const CLIPBOARD_IDENTIFIER = '##RAD##';

// Hilfsfunktion zum Kopieren in Zwischenablage mit Identifier
async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(CLIPBOARD_IDENTIFIER + text);
}

// Intervall für kontinuierliche Transkription (in ms)
// 2 Sekunden für schnelle Rückmeldung
const TRANSCRIPTION_INTERVAL = 2000;

// Steuerbefehle für Befund-Felder
type BefundField = 'methodik' | 'befund' | 'beurteilung';

// Template-Interface
interface Template {
  id: number;
  name: string;
  content: string;
  field: BefundField;
}

export default function HomePage() {
  const { username, autoCorrect, defaultMode, getAuthHeader, getDbTokenHeader } = useAuth();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  // Flag um zu tracken ob nach Aufnahme noch keine Korrektur durchgeführt wurde
  const [pendingCorrection, setPendingCorrection] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const allChunksRef = useRef<BlobPart[]>([]);
  const transcriptionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Mikrofonpegel-Visualisierung
  const [audioLevel, setAudioLevel] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Text der VOR dieser Aufnahme-Session existierte
  const existingTextRef = useRef<string>("");
  // Letzter transkribierter Text dieser Session
  const lastTranscriptRef = useRef<string>("");
  
  const [transcript, setTranscript] = useState("");
  const [mode, setMode] = useState<'arztbrief' | 'befund'>('befund');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Status tracking for UI indicators
  // Show banner during entire recording session, not just during active processing
  const isProcessing = recording || transcribing || correcting || busy;
  const processingStatus = recording 
    ? 'Aufnahme läuft...' 
    : correcting 
      ? 'Korrektur läuft...' 
      : transcribing 
        ? 'Transkription läuft...' 
        : busy 
          ? 'Verarbeitung...' 
          : null;
  
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

  // Revert-Funktion: Speichert den Text VOR der letzten Korrektur
  const [preCorrectionState, setPreCorrectionState] = useState<{
    methodik: string;
    befund: string;
    beurteilung: string;
    transcript: string; // Für Arztbrief-Modus
  } | null>(null);
  // Roher Whisper-Text (vor Formatierung) für Toggle zwischen roh und formatiert
  const [rawWhisperState, setRawWhisperState] = useState<{
    methodik: string;
    befund: string;
    beurteilung: string;
    transcript: string;
  } | null>(null);
  const [canRevert, setCanRevert] = useState(false);
  const [isReverted, setIsReverted] = useState(false); // Zeigt an ob gerade der unkorrigierte Text angezeigt wird
  const [applyFormatting, setApplyFormatting] = useState(true); // Formatierung standardmäßig an
  
  // Änderungsscore für Ampelsystem
  const [changeScore, setChangeScore] = useState<number | null>(null);
  const [befundChangeScores, setBefundChangeScores] = useState<{
    methodik: number;
    befund: number;
    beurteilung: number;
  } | null>(null);
  
  // Diff-Ansicht: Zeigt Unterschiede zwischen formatiertem Original und KI-korrigiertem Text
  const [showDiffView, setShowDiffView] = useState(false);

  // Custom Actions Manager
  const [showCustomActionsManager, setShowCustomActionsManager] = useState(false);

  // SpeaKING Import State
  const [speakingMetadata, setSpeakingMetadata] = useState<SpeaKINGMetadata | null>(null);
  const [speakingWavFile, setSpeakingWavFile] = useState<File | null>(null);
  const [showSpeakingImport, setShowSpeakingImport] = useState(false);

  // Template-Modus: Textbaustein mit diktierten Änderungen kombinieren
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [templateMode, setTemplateMode] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Templates laden
  const fetchTemplates = useCallback(async () => {
    if (!username) return;
    setLoadingTemplates(true);
    try {
      const response = await fetch('/api/templates', {
        headers: { 
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        }
      });
      const data = await response.json();
      if (data.templates) {
        setTemplates(data.templates);
      }
    } catch (error) {
      console.error('[Templates] Load error:', error);
    } finally {
      setLoadingTemplates(false);
    }
  }, [username, getAuthHeader, getDbTokenHeader]);

  // Mode vom defaultMode des Benutzers setzen
  useEffect(() => {
    if (defaultMode) {
      setMode(defaultMode);
    }
  }, [defaultMode]);

  // WhisperX Warmup beim Start - lädt Modell vor für minimale Latenz
  useEffect(() => {
    const warmupWhisper = async () => {
      try {
        console.log('[Warmup] Triggering WhisperX model preload...');
        const res = await fetch('/api/warmup', {
          method: 'POST',
        });
        const data = await res.json();
        
        if (data.status === 'warmed_up' || data.status === 'already_warmed_up') {
          console.log(`[Warmup] ✓ WhisperX ready - Device: ${data.device}, Model: ${data.model}`);
        } else if (data.status === 'service_unavailable') {
          console.log('[Warmup] WhisperX service not available (may be external)');
        } else {
          console.warn('[Warmup] Warmup status:', data.status, data.message);
        }
      } catch (err) {
        // Warmup-Fehler sind nicht kritisch - Service läuft möglicherweise extern
        console.log('[Warmup] Could not reach warmup endpoint (service may be external)');
      }
    };
    
    // Warmup nach kurzem Delay starten (UI nicht blockieren)
    const timer = setTimeout(warmupWhisper, 500);
    return () => clearTimeout(timer);
  }, []);

  // Templates beim Start laden
  useEffect(() => {
    if (username && mode === 'befund') {
      fetchTemplates();
    }
  }, [username, mode, fetchTemplates]);

  // Event-Listener für Template-Aktualisierungen (wenn Templates im Modal geändert werden)
  useEffect(() => {
    const handleTemplatesChanged = () => {
      console.log('[Templates] Received update event, refreshing...');
      fetchTemplates();
    };
    
    window.addEventListener('templates-changed', handleTemplatesChanged);
    return () => window.removeEventListener('templates-changed', handleTemplatesChanged);

  // Reset template selection when active field changes and template doesn't match
  }, [fetchTemplates]);

  useEffect(() => {
    if (selectedTemplate && selectedTemplate.field !== activeField) {
      setSelectedTemplate(null);
      setTemplateMode(false);
    }
  }, [activeField, selectedTemplate]);

  // Funktion zum Transkribieren eines Blobs
  const transcribeChunk = useCallback(async (blob: Blob, isLive: boolean = false): Promise<string> => {
    try {
      const fd = new FormData();
      fd.append('file', blob, 'audio.webm');
      if (username) {
        fd.append('username', username);
      }
      const res = await fetchWithDbToken('/api/transcribe', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`Transkription fehlgeschlagen (${res.status})`);
      const data = await res.json();
      
      // Log provider info to browser console
      const provider = data.provider || 'unknown';
      const textLength = (data.text || '').length;
      console.log(`[Transcription] Provider: ${provider}, Text: ${textLength} chars`);
      if (data.text) {
        console.log(`[Transcription] Result: "${data.text.substring(0, 100)}${data.text.length > 100 ? '...' : ''}"`);
      }
      
      return data.text || '';
    } catch (err: any) {
      console.error('[Transcription] Error:', err.message);
      if (!isLive) {
        setError(err.message || 'Unbekannter Fehler');
      }
      return '';
    }
  }, [username]);

  // Kombiniert existierenden Text mit neuem Transkript
  const combineTexts = useCallback((existing: string, newText: string): string => {
    if (!existing) return newText;
    if (!newText) return existing;
    // Füge Leerzeichen oder Zeilenumbruch hinzu wenn nötig
    const separator = existing.endsWith('\n') || existing.endsWith(' ') ? '' : ' ';
    return existing + separator + newText;
  }, []);

  // Erkennt Steuerbefehle und teilt Text auf alle Felder auf
  const parseFieldCommands = useCallback((text: string): { 
    methodik: string | null; 
    befund: string | null; 
    beurteilung: string | null;
    lastField: BefundField | null;
  } => {
    // Regex für Steuerbefehle (case-insensitive) - matcht "Methodik:", "Methodik Doppelpunkt", etc.
    const fieldPattern = /\b(methodik|befund|beurteilung|zusammenfassung)\s*(?:[:：]|doppelpunkt)/gi;
    
    // Finde alle Matches mit ihren Positionen
    const matches: { field: BefundField; index: number; length: number }[] = [];
    let match;
    
    while ((match = fieldPattern.exec(text)) !== null) {
      const fieldName = match[1].toLowerCase();
      let field: BefundField;
      if (fieldName === 'methodik') field = 'methodik';
      else if (fieldName === 'beurteilung' || fieldName === 'zusammenfassung') field = 'beurteilung';
      else field = 'befund';
      
      matches.push({ field, index: match.index, length: match[0].length });
    }
    
    // Wenn keine Matches, gib null zurück
    if (matches.length === 0) {
      return { methodik: null, befund: null, beurteilung: null, lastField: null };
    }
    
    // Teile den Text basierend auf den Matches auf
    const result: { methodik: string | null; befund: string | null; beurteilung: string | null; lastField: BefundField | null } = {
      methodik: null,
      befund: null,
      beurteilung: null,
      lastField: matches[matches.length - 1].field
    };
    
    // Text VOR dem ersten Match gehört zum aktuellen aktiven Feld (wird separat behandelt)
    const textBeforeFirst = text.substring(0, matches[0].index).trim();
    
    // Verarbeite jeden Match
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const next = matches[i + 1];
      
      // Text nach diesem Match bis zum nächsten Match (oder Ende)
      const startPos = current.index + current.length;
      const endPos = next ? next.index : text.length;
      const fieldText = text.substring(startPos, endPos).trim();
      
      // Füge zum entsprechenden Feld hinzu
      if (fieldText) {
        switch (current.field) {
          case 'methodik':
            result.methodik = result.methodik ? result.methodik + ' ' + fieldText : fieldText;
            break;
          case 'beurteilung':
            result.beurteilung = result.beurteilung ? result.beurteilung + ' ' + fieldText : fieldText;
            break;
          case 'befund':
            result.befund = result.befund ? result.befund + ' ' + fieldText : fieldText;
            break;
        }
      }
    }
    
    // Text vor dem ersten Steuerbefehl wird als "unzugewiesen" zurückgegeben
    // Dieser wird dem aktuellen aktiven Feld hinzugefügt
    if (textBeforeFirst) {
      // Füge es zum Befund hinzu wenn kein anderes Feld explizit angegeben
      result.befund = result.befund ? textBeforeFirst + ' ' + result.befund : textBeforeFirst;
    }
    
    return result;
  }, []);

  // Verarbeitet Text und verteilt auf die richtigen Felder (für Befund-Modus)
  const processTextForBefundFields = useCallback((rawText: string) => {
    if (mode !== 'befund') {
      const formatted = applyFormattingControlWords(rawText);
      setTranscript(formatted);
      return;
    }
    
    // Formatierung auf den Text anwenden (um Steuerwörter sofort zu ersetzen)
    const formattedText = applyFormattingControlWords(rawText);
    const parsed = parseFieldCommands(formattedText);
    
    // Wenn Steuerbefehle erkannt wurden, verteile Text auf die entsprechenden Felder
    if (parsed.lastField) {
      setActiveField(parsed.lastField);
      
      // Setze jeden Feldinhalt wenn vorhanden
      if (parsed.methodik !== null) {
        setMethodik(combineTexts(existingMethodikRef.current, parsed.methodik));
      }
      if (parsed.befund !== null) {
        setTranscript(combineTexts(existingTextRef.current, parsed.befund));
      }
      if (parsed.beurteilung !== null) {
        setBeurteilung(combineTexts(existingBeurteilungRef.current, parsed.beurteilung));
      }
    } else {
      // Kein Steuerbefehl erkannt - Text geht ins aktive Feld
      switch (activeField) {
        case 'methodik':
          setMethodik(combineTexts(existingMethodikRef.current, formattedText));
          break;
        case 'beurteilung':
          setBeurteilung(combineTexts(existingBeurteilungRef.current, formattedText));
          break;
        case 'befund':
        default:
          setTranscript(combineTexts(existingTextRef.current, formattedText));
          break;
      }
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
        
        // HINWEIS: Während der Live-Transkription wird KEINE Formatierung angewendet,
        // um Hin-und-Her-Springen des Textes zu vermeiden (Whisper arbeitet in Chunks
        // und kann sich wiederholen). Die Formatierung wird erst nach Aufnahmeende
        // in stopRecording() angewendet.
        
        if (mode === 'befund') {
          // Im Befund-Modus: Parse Steuerbefehle und verteile auf Felder
          // Hier nur grob nach Feldwechsel-Kommandos schauen, ohne Formatierung
          const parsed = parseFieldCommands(currentTranscript);
          
          if (parsed.lastField) {
            setActiveField(parsed.lastField);
            
            // Verteile Text auf die entsprechenden Felder
            if (parsed.methodik !== null) {
              lastMethodikRef.current = parsed.methodik;
              setMethodik(combineTexts(existingMethodikRef.current, parsed.methodik));
            }
            if (parsed.befund !== null) {
              setTranscript(combineTexts(existingTextRef.current, parsed.befund));
            }
            if (parsed.beurteilung !== null) {
              lastBeurteilungRef.current = parsed.beurteilung;
              setBeurteilung(combineTexts(existingBeurteilungRef.current, parsed.beurteilung));
            }
          } else {
            // Kein Steuerbefehl - Text geht ins aktive Feld
            switch (activeField) {
              case 'methodik':
                lastMethodikRef.current = currentTranscript;
                setMethodik(combineTexts(existingMethodikRef.current, currentTranscript));
                break;
              case 'beurteilung':
                lastBeurteilungRef.current = currentTranscript;
                setBeurteilung(combineTexts(existingBeurteilungRef.current, currentTranscript));
                break;
              case 'befund':
              default:
                setTranscript(combineTexts(existingTextRef.current, currentTranscript));
                break;
            }
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
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Funktion zum Zurücksetzen aller Felder (New-Button) - hier oben für Hotkey-Unterstützung
  const handleReset = useCallback(() => {
    setTranscript('');
    setMethodik('');
    setBeurteilung('');
    setActiveField('befund');
    setError(null);
    setPreCorrectionState(null);
    setRawWhisperState(null);
    setCanRevert(false);
    setPendingCorrection(false);
    setChangeScore(null);
    setBefundChangeScores({ methodik: 0, befund: 0, beurteilung: 0 });
    setApplyFormatting(true); // Reset auf Standard
    setShowDiffView(false); // Reset diff view
  }, []);

  // Revert-Funktion: Stellt den Text vor der letzten Korrektur wieder her
  const handleRevert = useCallback(() => {
    if (!preCorrectionState) return;
    
    if (mode === 'befund') {
      setMethodik(preCorrectionState.methodik);
      setTranscript(preCorrectionState.befund);
      setBeurteilung(preCorrectionState.beurteilung);
    } else {
      setTranscript(preCorrectionState.transcript);
    }
    setCanRevert(false);
    setIsReverted(true); // Jetzt zeigen wir den unkorrigierten Text
    // Formatierung bleibt wie sie war (standardmäßig true = formatiert)
  }, [preCorrectionState, mode]);

  // Formatierung auf den unkorrigierten Text anwenden/entfernen
  // Toggle zwischen rohem Whisper-Text und formatiertem Text
  const handleApplyFormattingToggle = useCallback((apply: boolean) => {
    if (!rawWhisperState || !preCorrectionState) return;
    setApplyFormatting(apply);
    
    if (apply) {
      // Formatierung anwenden (preCorrectionState enthält bereits den formatierten Text)
      if (mode === 'befund') {
        setMethodik(preCorrectionState.methodik);
        setTranscript(preCorrectionState.befund);
        setBeurteilung(preCorrectionState.beurteilung);
      } else {
        setTranscript(preCorrectionState.transcript);
      }
    } else {
      // Zurück zum rohen Whisper-Text (ohne Formatierung)
      if (mode === 'befund') {
        setMethodik(rawWhisperState.methodik);
        setTranscript(rawWhisperState.befund);
        setBeurteilung(rawWhisperState.beurteilung);
      } else {
        setTranscript(rawWhisperState.transcript);
      }
    }
  }, [rawWhisperState, preCorrectionState, mode]);

  // Re-Correct-Funktion: Führt die Korrektur erneut durch
  const handleReCorrect = useCallback(async () => {
    if (!preCorrectionState) return;
    
    setCorrecting(true);
    setError(null);
    
    try {
      if (mode === 'befund') {
        const res = await fetchWithDbToken('/api/correct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            befundFields: {
              methodik: preCorrectionState.methodik,
              befund: preCorrectionState.befund,
              beurteilung: preCorrectionState.beurteilung
            },
            username
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.befundFields) {
            setMethodik(data.befundFields.methodik || preCorrectionState.methodik);
            setTranscript(data.befundFields.befund || preCorrectionState.befund);
            setBeurteilung(data.befundFields.beurteilung || preCorrectionState.beurteilung);
            if (data.changeScores) {
              setBefundChangeScores(data.changeScores);
            }
            setChangeScore(data.changeScore ?? null);
          }
          setCanRevert(true);
          setIsReverted(false);
        } else {
          throw new Error('Korrektur fehlgeschlagen');
        }
      } else {
        const res = await fetchWithDbToken('/api/correct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: preCorrectionState.transcript, username }),
        });
        if (res.ok) {
          const data = await res.json();
          setTranscript(data.correctedText || preCorrectionState.transcript);
          setChangeScore(data.changeScore ?? null);
          setCanRevert(true);
          setIsReverted(false);
        } else {
          throw new Error('Korrektur fehlgeschlagen');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Fehler bei erneuter Korrektur');
    } finally {
      setCorrecting(false);
    }
  }, [preCorrectionState, mode, username]);

  // Hotkey-Unterstützung für Philips SpeechMike und andere Diktiermikrofone
  // Konfigurieren Sie das SpeechMike im "Keyboard Mode" mit folgenden Tasten:
  // - F9: Aufnahme starten/stoppen (Toggle)
  // - F10: Aufnahme stoppen
  // - F11: Alle Felder zurücksetzen (Neu)
  // - Escape: Aufnahme abbrechen
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignoriere Hotkeys wenn in Textfeldern
      const activeElement = document.activeElement;
      const isEditing = activeElement?.tagName === 'TEXTAREA' || activeElement?.tagName === 'INPUT';
      if (isEditing) return;

      switch (e.key) {
        case 'F9':
          e.preventDefault();
          // Toggle Aufnahme
          if (recordingRef.current) {
            stopRecording();
          } else {
            startRecording();
          }
          break;
        case 'F10':
          e.preventDefault();
          // Stoppe Aufnahme
          if (recordingRef.current) {
            stopRecording();
          }
          break;
        case 'F11':
          e.preventDefault();
          // Neu (alle Felder löschen)
          handleReset();
          break;
        case 'Escape':
          e.preventDefault();
          // Aufnahme abbrechen
          if (recordingRef.current) {
            stopRecording();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startRecording, stopRecording, handleReset]);

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
    
    // Setup Audio Level Monitor
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);
    analyser.fftSize = 256;
    microphone.connect(analyser);
    
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const updateLevel = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setAudioLevel(Math.min(100, (average / 128) * 100));
      animationFrameRef.current = requestAnimationFrame(updateLevel);
    };
    updateLevel();
    
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) {
        allChunksRef.current.push(e.data);
      }
    };
    
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      setAudioLevel(0);
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
          // Formatierung auf den Text anwenden (um Steuerwörter sofort zu ersetzen)
          const formattedTranscript = applyFormattingControlWords(sessionTranscript);
          
          // TEMPLATE-MODUS: Textbaustein mit diktierten Änderungen kombinieren
          if (templateMode && selectedTemplate) {
            setCorrecting(true);
            try {
              console.log('[Template] Adapting template:', selectedTemplate.name);
              console.log('[Template] Changes:', formattedTranscript);
              
              const res = await fetch('/api/templates/adapt', {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': getAuthHeader(),
                  ...getDbTokenHeader()
                },
                body: JSON.stringify({
                  template: selectedTemplate.content,
                  changes: formattedTranscript,
                  field: selectedTemplate.field,
                  username
                }),
              });
              
              if (res.ok) {
                const data = await res.json();
                if (data.adaptedText) {
                  // Speichere aktuellen Zustand für Revert
                  setPreCorrectionState({
                    methodik: methodik,
                    befund: transcript,
                    beurteilung: beurteilung,
                    transcript: ''
                  });
                  
                  // Setze den angepassten Text ins entsprechende Feld
                  switch (selectedTemplate.field) {
                    case 'methodik':
                      setMethodik(data.adaptedText);
                      break;
                    case 'beurteilung':
                      setBeurteilung(data.adaptedText);
                      break;
                    case 'befund':
                    default:
                      setTranscript(data.adaptedText);
                      break;
                  }
                  setCanRevert(true);
                  setIsReverted(false);
                }
              } else {
                const errorData = await res.json();
                setError(errorData.error || 'Template-Anpassung fehlgeschlagen');
              }
            } catch (err: any) {
              console.error('[Template] Adapt error:', err);
              setError(err.message || 'Fehler bei Template-Anpassung');
            } finally {
              setCorrecting(false);
              // Template-Modus nach Anwendung zurücksetzen
              setSelectedTemplate(null);
              setTemplateMode(false);
            }
          } else {
            // STANDARD-MODUS: Normale Verarbeitung
            // Verarbeite Transkript und setze Text in Felder
            if (mode === 'befund') {
              // Im Befund-Modus: Parse Steuerbefehle und verteile auf Felder
              const parsed = parseFieldCommands(formattedTranscript);
              // Parse auch den rohen Text für rawWhisperState
              const rawParsed = parseFieldCommands(sessionTranscript);
              
              // Aktualisiere die Felder basierend auf parsed results
              let currentMethodik = methodik;
              let currentBefund = transcript;
              let currentBeurteilung = beurteilung;
              
              // Rohe Whisper-Werte (vor Formatierung)
              let rawMethodik = methodik;
              let rawBefund = transcript;
              let rawBeurteilung = beurteilung;
              
              if (parsed.lastField) {
                // Steuerbefehle erkannt - verteile auf entsprechende Felder
                if (parsed.methodik !== null) {
                  currentMethodik = combineTexts(existingMethodikRef.current, parsed.methodik);
                }
                if (parsed.befund !== null) {
                  currentBefund = combineTexts(existingTextRef.current, parsed.befund);
                }
                if (parsed.beurteilung !== null) {
                  currentBeurteilung = combineTexts(existingBeurteilungRef.current, parsed.beurteilung);
                }
                // Rohe Version
                if (rawParsed.methodik !== null) {
                  rawMethodik = combineTexts(existingMethodikRef.current, rawParsed.methodik);
                }
                if (rawParsed.befund !== null) {
                  rawBefund = combineTexts(existingTextRef.current, rawParsed.befund);
                }
                if (rawParsed.beurteilung !== null) {
                  rawBeurteilung = combineTexts(existingBeurteilungRef.current, rawParsed.beurteilung);
                }
              } else {
              // Kein Steuerbefehl - Text geht ins aktive Feld
              switch (activeField) {
                case 'methodik':
                  currentMethodik = combineTexts(existingMethodikRef.current, formattedTranscript);
                  rawMethodik = combineTexts(existingMethodikRef.current, sessionTranscript);
                  break;
                case 'beurteilung':
                  currentBeurteilung = combineTexts(existingBeurteilungRef.current, formattedTranscript);
                  rawBeurteilung = combineTexts(existingBeurteilungRef.current, sessionTranscript);
                  break;
                case 'befund':
                default:
                  currentBefund = combineTexts(existingTextRef.current, formattedTranscript);
                  rawBefund = combineTexts(existingTextRef.current, sessionTranscript);
                  break;
              }
            }
            
            // Speichere Text VOR der Korrektur für Revert-Funktion (formatierte Version)
            setPreCorrectionState({
              methodik: currentMethodik,
              befund: currentBefund,
              beurteilung: currentBeurteilung,
              transcript: ''
            });
            
            // Speichere rohen Whisper-Text (ohne Formatierung)
            setRawWhisperState({
              methodik: rawMethodik,
              befund: rawBefund,
              beurteilung: rawBeurteilung,
              transcript: ''
            });
            
            // Wenn autoCorrect deaktiviert: Nur Text setzen, keine Korrektur
            if (!autoCorrect) {
              setMethodik(currentMethodik);
              setTranscript(currentBefund);
              setBeurteilung(currentBeurteilung);
              setPendingCorrection(true);
            } else {
              // Automatische Korrektur durchführen
              setCorrecting(true);
              try {
                // Korrigiere NUR das aktive Feld (oder die Felder mit neuen Steuerbefehlen)
                // Ermittle welche Felder sich geändert haben
                const changedFields: { methodik?: string; befund?: string; beurteilung?: string } = {};
                
                if (parsed.lastField) {
                  // Steuerbefehle erkannt - korrigiere nur die betroffenen Felder
                  if (parsed.methodik !== null) changedFields.methodik = currentMethodik;
                  if (parsed.befund !== null) changedFields.befund = currentBefund;
                  if (parsed.beurteilung !== null) changedFields.beurteilung = currentBeurteilung;
                } else {
                  // Nur das aktive Feld wurde geändert
                  switch (activeField) {
                    case 'methodik':
                      changedFields.methodik = currentMethodik;
                      break;
                    case 'beurteilung':
                      changedFields.beurteilung = currentBeurteilung;
                      break;
                    case 'befund':
                    default:
                      changedFields.befund = currentBefund;
                      break;
                  }
                }
                
                // Korrigiere nur die geänderten Felder
                const res = await fetchWithDbToken('/api/correct', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    befundFields: changedFields,
                    username
                  }),
                });
                if (res.ok) {
                  const data = await res.json();
                  if (data.befundFields) {
                    // Speichere Änderungsscores für Ampelsystem
                    if (data.changeScores) {
                      setBefundChangeScores(data.changeScores);
                    }
                    setChangeScore(data.changeScore ?? null);
                    
                    // Setze nur die korrigierten Felder, behalte andere unverändert
                    if (changedFields.methodik !== undefined) {
                      setMethodik(data.befundFields.methodik || currentMethodik);
                    } else {
                      setMethodik(currentMethodik);
                    }
                    if (changedFields.befund !== undefined) {
                      setTranscript(data.befundFields.befund || currentBefund);
                    } else {
                      setTranscript(currentBefund);
                    }
                    if (changedFields.beurteilung !== undefined) {
                      setBeurteilung(data.befundFields.beurteilung || currentBeurteilung);
                    } else {
                      setBeurteilung(currentBeurteilung);
                    }
                    setCanRevert(true);
                  }
                } else {
                  // Fallback: Setze unkorrigierten Text
                  setMethodik(currentMethodik);
                  setTranscript(currentBefund);
                  setBeurteilung(currentBeurteilung);
                }
              } catch {
                // Bei Fehler: Setze unkorrigierten Text
                setMethodik(currentMethodik);
                setTranscript(currentBefund);
                setBeurteilung(currentBeurteilung);
              } finally {
                setCorrecting(false);
              }
            }
          } else {
            // Im Arztbrief-Modus: Normales Verhalten
            const fullText = combineTexts(existingTextRef.current, formattedTranscript);
            const rawFullText = combineTexts(existingTextRef.current, sessionTranscript);
            
            // Speichere Text VOR der Korrektur für Revert-Funktion (formatierte Version)
            setPreCorrectionState({
              methodik: '',
              befund: '',
              beurteilung: '',
              transcript: fullText
            });
            
            // Speichere rohen Whisper-Text (ohne Formatierung)
            setRawWhisperState({
              methodik: '',
              befund: '',
              beurteilung: '',
              transcript: rawFullText
            });
            
            // Wenn autoCorrect deaktiviert: Nur Text setzen, keine Korrektur
            if (!autoCorrect) {
              setTranscript(fullText);
              setPendingCorrection(true);
            } else {
              // Automatische Korrektur durchführen
              setCorrecting(true);
              try {
                const res = await fetchWithDbToken('/api/correct', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: fullText, username }),
                });
                if (res.ok) {
                  const data = await res.json();
                  setTranscript(data.correctedText || fullText);
                  setChangeScore(data.changeScore ?? null);
                  setCanRevert(true);
                } else {
                  setTranscript(fullText);
                  setChangeScore(null);
                }
              } catch {
                setTranscript(fullText);
              } finally {
                setCorrecting(false);
              }
            }
          }
          } // Ende STANDARD-MODUS (else vom Template-Modus)
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
      // Formatierung auf den Text anwenden (um Steuerwörter sofort zu ersetzen)
      const formattedText = applyFormattingControlWords(text);
      setTranscript(formattedText);
      // Speichere Text VOR der Korrektur für Revert-Funktion
      if (formattedText) {
        setPreCorrectionState({
          methodik: '',
          befund: '',
          beurteilung: '',
          transcript: formattedText
        });
      }
      // Korrektur nach Upload nur wenn autoCorrect aktiviert
      if (formattedText && autoCorrect) {
        setCorrecting(true);
        try {
          const res = await fetchWithDbToken('/api/correct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: formattedText, username }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.correctedText) {
              setTranscript(data.correctedText);
              setChangeScore(data.changeScore ?? null);
              setCanRevert(true);
            }
          }
        } finally {
          setCorrecting(false);
        }
      } else if (formattedText && !autoCorrect) {
        // Wenn autoCorrect deaktiviert, zeige Button für manuelle Korrektur
        setPendingCorrection(true);
      }
    } finally {
      setBusy(false);
    }
  }

  // SpeaKING XML-Datei verarbeiten
  async function handleSpeakingXml(file: File) {
    try {
      const xmlContent = await readFileAsText(file);
      const metadata = parseSpeaKINGXml(xmlContent);
      if (metadata) {
        setSpeakingMetadata(metadata);
        setShowSpeakingImport(true);
        console.log('[SpeaKING] XML geladen:', metadata);
      } else {
        setError('Konnte SpeaKING XML nicht parsen');
      }
    } catch (err: any) {
      setError('Fehler beim Lesen der XML-Datei: ' + err.message);
    }
  }

  // SpeaKING WAV-Datei mit Metadaten transkribieren
  async function handleSpeakingImport() {
    if (!speakingWavFile) {
      setError('Bitte wählen Sie eine WAV-Datei aus');
      return;
    }

    setBusy(true);
    setError(null);
    setShowSpeakingImport(false);

    try {
      // Transkribieren (die WAV wird serverseitig normalisiert)
      const text = await transcribeChunk(speakingWavFile, false);
      
      // Formatierung anwenden
      let formattedText = applyFormattingControlWords(text);
      
      // Wenn Metadaten vorhanden, Header mit Patientendaten erstellen
      if (speakingMetadata) {
        const headerLines: string[] = [];
        if (speakingMetadata.patientName) {
          headerLines.push(`Patient: ${speakingMetadata.patientName}`);
        }
        if (speakingMetadata.patientId) {
          headerLines.push(`ID: ${speakingMetadata.patientId}`);
        }
        if (speakingMetadata.docType) {
          headerLines.push(`Dokumenttyp: ${speakingMetadata.docType}`);
        }
        if (speakingMetadata.creator) {
          headerLines.push(`Diktiert von: ${speakingMetadata.creator}`);
        }
        if (speakingMetadata.creationTime) {
          const date = new Date(speakingMetadata.creationTime);
          headerLines.push(`Datum: ${date.toLocaleDateString('de-DE')} ${date.toLocaleTimeString('de-DE')}`);
        }
        
        if (headerLines.length > 0) {
          formattedText = headerLines.join('\n') + '\n\n---\n\n' + formattedText;
        }
      }
      
      setTranscript(formattedText);
      
      // Speichere Text VOR der Korrektur
      if (formattedText) {
        setPreCorrectionState({
          methodik: '',
          befund: '',
          beurteilung: '',
          transcript: formattedText
        });
      }
      
      // Auto-Korrektur wenn aktiviert
      if (formattedText && autoCorrect) {
        setCorrecting(true);
        try {
          const res = await fetchWithDbToken('/api/correct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: formattedText, username }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.correctedText) {
              setTranscript(data.correctedText);
              setChangeScore(data.changeScore ?? null);
              setCanRevert(true);
            }
          }
        } finally {
          setCorrecting(false);
        }
      } else if (formattedText && !autoCorrect) {
        setPendingCorrection(true);
      }
      
      // Aufräumen
      setSpeakingMetadata(null);
      setSpeakingWavFile(null);
      
    } catch (err: any) {
      setError('SpeaKING Import fehlgeschlagen: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  // Datei-Handler der XML und WAV unterscheidet
  async function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const xmlFile = fileArray.find(f => f.name.endsWith('.xml'));
    const wavFile = fileArray.find(f => f.name.endsWith('.wav'));
    const otherAudio = fileArray.find(f => 
      f.type.startsWith('audio/') && !f.name.endsWith('.wav')
    );

    // Fall 1: XML + WAV zusammen ausgewählt
    if (xmlFile && wavFile) {
      await handleSpeakingXml(xmlFile);
      setSpeakingWavFile(wavFile);
      return;
    }

    // Fall 2: Nur XML - zeige Import-Dialog
    if (xmlFile) {
      await handleSpeakingXml(xmlFile);
      return;
    }

    // Fall 3: Nur WAV - könnte SpeaKING sein
    if (wavFile) {
      // Wenn bereits Metadaten vorhanden, als SpeaKING verarbeiten
      if (speakingMetadata) {
        setSpeakingWavFile(wavFile);
        await handleSpeakingImport();
      } else {
        // Direkter Import als normale Audio-Datei
        await handleFile(wavFile);
      }
      return;
    }

    // Fall 4: Andere Audio-Datei
    if (otherAudio) {
      await handleFile(otherAudio);
      return;
    }

    // Fall 5: Erste Datei als Fallback
    await handleFile(files[0]);
  }

  async function handleFormat() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithDbToken('/api/format', {
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
      const res = await fetchWithDbToken('/api/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          befundFields: {
            methodik: methodik,
            befund: transcript,
            beurteilung: beurteilung
          },
          username
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.befundFields) {
          setMethodik(data.befundFields.methodik || methodik);
          setTranscript(data.befundFields.befund || transcript);
          setBeurteilung(data.befundFields.beurteilung || beurteilung);
          if (data.changeScores) {
            setBefundChangeScores(data.changeScores);
          }
          setChangeScore(data.changeScore ?? null);
          setCanRevert(true);
          setPendingCorrection(false);
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

  // Manuelle Korrektur für Arztbrief-Modus
  async function handleManualCorrect() {
    if (!transcript.trim()) return;
    
    setBusy(true);
    setError(null);
    setCorrecting(true);
    try {
      const res = await fetchWithDbToken('/api/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: transcript, username }),
      });
      if (res.ok) {
        const data = await res.json();
        setTranscript(data.correctedText || transcript);
        setChangeScore(data.changeScore ?? null);
        setCanRevert(true);
        setPendingCorrection(false);
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
    copyToClipboard(combinedText);
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
      const res = await fetchWithDbToken('/api/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          suggestBeurteilung: true,
          methodik: methodik,
          befund: transcript,
          username
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
    copyToClipboard(transcript);
  }

  async function handleExportDocx() {
    await exportDocx(transcript, mode);
  }

  const Aufnahme = (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {recording ? (
          <div className="flex items-center gap-3 flex-1">
            <span className="badge inline-flex items-center gap-2">
              <span className="pulse-dot" /> 
              Aufnahme läuft
              {transcribing && <span className="ml-2 text-xs opacity-70">(transkribiert...)</span>}
              {correcting && <span className="ml-2 text-xs opacity-70">(korrigiert...)</span>}
            </span>
            {/* Mikrofonpegel-Anzeige */}
            <div className="flex items-center gap-2 flex-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              </svg>
              <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-500 transition-all duration-100"
                  style={{ width: `${audioLevel}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 w-8">{Math.round(audioLevel)}%</span>
            </div>
          </div>
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
    <div className="py-2 space-y-3">
      {/* Standard Audio-Import */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Audio-Datei importieren
        </label>
        <input 
          className="input text-sm" 
          type="file" 
          accept="audio/*,.xml" 
          multiple
          onChange={(e) => handleFileSelect(e.target.files)} 
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Unterstützt: MP3, WAV, WebM, M4A, OGG • SpeaKING: XML + WAV zusammen auswählen
        </p>
      </div>

      {/* SpeaKING Import Dialog */}
      {showSpeakingImport && speakingMetadata && (
        <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-4 bg-blue-50 dark:bg-blue-900/30">
          <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" x2="12" y1="19" y2="22"/>
            </svg>
            SpeaKING Diktat erkannt
          </h4>
          
          {/* Metadaten anzeigen */}
          <div className="grid grid-cols-2 gap-2 text-sm mb-3">
            {speakingMetadata.patientName && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">Patient:</span>{' '}
                <span className="font-medium">{speakingMetadata.patientName}</span>
              </div>
            )}
            {speakingMetadata.patientId && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">ID:</span>{' '}
                <span className="font-medium">{speakingMetadata.patientId}</span>
              </div>
            )}
            {speakingMetadata.docType && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">Dokumenttyp:</span>{' '}
                <span className="font-medium">{speakingMetadata.docType}</span>
              </div>
            )}
            {speakingMetadata.creator && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">Diktiert von:</span>{' '}
                <span className="font-medium">{speakingMetadata.creator}</span>
              </div>
            )}
            {speakingMetadata.creationTime && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">Datum:</span>{' '}
                <span className="font-medium">
                  {new Date(speakingMetadata.creationTime).toLocaleDateString('de-DE')}
                </span>
              </div>
            )}
            {speakingMetadata.organisation && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">Abteilung:</span>{' '}
                <span className="font-medium">{speakingMetadata.organisation}</span>
              </div>
            )}
          </div>

          {/* WAV-Datei Status */}
          {speakingWavFile ? (
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300 mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              WAV-Datei: {speakingWavFile.name}
            </div>
          ) : (
            <div className="mb-3">
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                WAV-Datei auswählen:
              </label>
              <input 
                className="input text-sm" 
                type="file" 
                accept=".wav"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setSpeakingWavFile(f);
                }} 
              />
              {speakingMetadata.audioFilename && (
                <p className="text-xs text-gray-500 mt-1">
                  Erwartet: {speakingMetadata.audioFilename}
                </p>
              )}
            </div>
          )}

          {/* Aktionsbuttons */}
          <div className="flex gap-2">
            <button
              className="btn btn-primary text-sm"
              onClick={handleSpeakingImport}
              disabled={!speakingWavFile || busy}
            >
              {busy ? <Spinner size={16} /> : 'Transkribieren'}
            </button>
            <button
              className="btn btn-secondary text-sm"
              onClick={() => {
                setShowSpeakingImport(false);
                setSpeakingMetadata(null);
                setSpeakingWavFile(null);
              }}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Ref für den Mikrofon-Button
  const recordButtonRef = useRef<HTMLButtonElement>(null);

  // Globaler Click-Handler: Klick auf nicht-interaktive Bereiche → Mikrofon-Button
  const handleGlobalClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    
    // Prüfe ob das Ziel oder ein Elternelement ein interaktives Element ist
    const interactiveSelectors = 'button, a, input, textarea, select, [role="button"], [tabindex]:not([tabindex="-1"])';
    const isInteractive = target.closest(interactiveSelectors);
    
    // Prüfe ob ein Textfeld fokussiert ist (blinkender Cursor)
    const activeElement = document.activeElement;
    const isEditing = activeElement?.tagName === 'TEXTAREA' || activeElement?.tagName === 'INPUT';
    
    // Wenn nicht interaktiv und nicht am Editieren, toggle Aufnahme
    if (!isInteractive && !isEditing) {
      if (recording) {
        stopRecording();
      } else {
        startRecording();
      }
    }
  }, [recording, startRecording, stopRecording]);

  // Rechtsklick-Handler: Löst "Neu" aus (alle Felder löschen) - nur auf nicht-interaktiven Elementen
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    
    // Prüfe ob das Ziel oder ein Elternelement ein interaktives Element ist
    const interactiveSelectors = 'button, a, input, textarea, select, [role="button"], [tabindex]:not([tabindex="-1"])';
    const isInteractive = target.closest(interactiveSelectors);
    
    // Prüfe ob ein Textfeld fokussiert ist (blinkender Cursor)
    const activeElement = document.activeElement;
    const isEditing = activeElement?.tagName === 'TEXTAREA' || activeElement?.tagName === 'INPUT';
    
    // Nur wenn nicht interaktiv und nicht am Editieren
    if (!isInteractive && !isEditing) {
      e.preventDefault(); // Verhindere das Standard-Kontextmenü
      handleReset();
    }
  }, [handleReset]);

  // Kompakter Aufnahme-Button für Header-Bereich
  const RecordButton = (
    <div className="flex items-center gap-3">
      {!recording ? (
        <button 
          ref={recordButtonRef}
          className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow-md transition-all hover:scale-105" 
          onClick={startRecording}
          title="Aufnahme starten"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        </button>
      ) : (
        <button 
          ref={recordButtonRef}
          className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-md transition-all hover:scale-105 animate-pulse" 
          onClick={stopRecording} 
          disabled={busy}
          title="Aufnahme stoppen"
        >
          {busy ? (
            <Spinner size={18} />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2"/>
            </svg>
          )}
        </button>
      )}
      <div className="text-xs">
        {recording ? (
          <div className="flex flex-col">
            <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
              <span className="pulse-dot" style={{ width: 8, height: 8 }} /> 
              Aufnahme
            </span>
            {transcribing && (
              <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1">
                <Spinner size={10} /> Live
              </span>
            )}
          </div>
        ) : correcting ? (
          <span className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400">
            <Spinner size={10} /> KI-Korrektur
          </span>
        ) : busy ? (
          <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
            <Spinner size={10} /> Verarbeitung
          </span>
        ) : (
          <span className="text-gray-500">Bereit</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3 min-h-[calc(100vh-120px)] cursor-pointer" onClick={handleGlobalClick} onContextMenu={handleContextMenu}>
      {/* Kompakte Steuerleiste */}
      <div className="card">
        <div className="card-body py-3 flex items-center justify-between gap-3">
          {RecordButton}
          <div className="flex items-center gap-2">
            <button 
              className="btn btn-outline text-sm py-1.5 px-3" 
              onClick={handleReset}
              title="Alle Felder löschen (oder Rechtsklick)"
            >
              ✨ Neu
            </button>
            {canRevert && preCorrectionState && (
              <>
                <button 
                  className="btn btn-outline text-sm py-1.5 px-3 text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-600 dark:hover:bg-amber-900/20" 
                  onClick={handleRevert}
                  title="Korrektur rückgängig machen - zeigt den Originaltext"
                  disabled={correcting}
                >
                  ↩ Revert
                </button>
                <button 
                  className={`btn text-sm py-1.5 px-3 ${showDiffView ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setShowDiffView(!showDiffView)}
                  title="Zeigt Unterschiede zwischen Original und KI-Korrektur"
                  disabled={correcting || isReverted}
                >
                  🔍 {showDiffView ? 'Diff aus' : 'Diff'}
                </button>
              </>
            )}
            {isReverted && preCorrectionState && (
              <>
                <button 
                  className="btn btn-outline text-sm py-1.5 px-3 text-purple-600 border-purple-300 hover:bg-purple-50 dark:text-purple-400 dark:border-purple-600 dark:hover:bg-purple-900/20" 
                  onClick={handleReCorrect}
                  title="Korrektur erneut durchführen"
                  disabled={correcting}
                >
                  {correcting ? <Spinner size={14} /> : '🔄 Neu korrigieren'}
                </button>
                <label 
                  className="flex items-center gap-1.5 text-xs cursor-pointer select-none px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                  title="Sprachbefehle wie 'Punkt eins', 'Nächster Punkt', 'Absatz' anwenden"
                >
                  <input
                    type="checkbox"
                    checked={applyFormatting}
                    onChange={(e) => handleApplyFormattingToggle(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-600 dark:text-gray-400">Formatierung</span>
                </label>
              </>
            )}
            {/* Manueller Korrektur-Button wenn Änderungen vorliegen */}
            {pendingCorrection && (
              <button 
                className="btn btn-primary text-sm py-1.5 px-3 animate-pulse" 
                onClick={mode === 'befund' ? handleFormatBefund : handleManualCorrect}
                title="KI-Korrektur durchführen"
                disabled={correcting || busy || (mode === 'befund' ? !methodik.trim() && !transcript.trim() && !beurteilung.trim() : !transcript.trim())}
              >
                {correcting ? <Spinner size={14} /> : '🤖 Korrigieren'}
              </button>
            )}
            
            {/* Textbaustein-Auswahl (nur im Befund-Modus) */}
            {mode === 'befund' && templates.filter(t => t.field === activeField).length > 0 && (
              <div className="flex items-center gap-1">
                <select 
                  className={`select text-sm py-1.5 w-auto ${templateMode ? 'border-orange-400 ring-1 ring-orange-300' : ''}`}
                  value={selectedTemplate?.id || ''}
                  onChange={(e) => {
                    const id = parseInt(e.target.value);
                    const template = templates.find(t => t.id === id);
                    setSelectedTemplate(template || null);
                    setTemplateMode(!!template);
                  }}
                  title="Textbaustein auswählen - diktieren Sie nur die Änderungen"
                >
                  <option value="">📝 Baustein...</option>
                  {templates.filter(t => t.field === activeField).map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {templateMode && selectedTemplate && (
                  <button
                    onClick={() => {
                      setSelectedTemplate(null);
                      setTemplateMode(false);
                    }}
                    className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-1"
                    title="Textbaustein-Modus beenden"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Textbaustein-Hinweis wenn aktiv */}
      {templateMode && selectedTemplate && !recording && (
        <div className="text-sm bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 px-3 py-2 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-orange-600 dark:text-orange-400 font-medium">📝 Baustein: {selectedTemplate.name}</span>
              <span className="text-xs px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded">
                {selectedTemplate.field}
              </span>
            </div>
            <button
              onClick={() => {
                // Speichere aktuellen Zustand für Revert
                setPreCorrectionState({
                  methodik: methodik,
                  befund: transcript,
                  beurteilung: beurteilung,
                  transcript: ''
                });
                
                // Setze den Textbaustein direkt ins entsprechende Feld
                switch (selectedTemplate.field) {
                  case 'methodik':
                    setMethodik(selectedTemplate.content);
                    break;
                  case 'beurteilung':
                    setBeurteilung(selectedTemplate.content);
                    break;
                  case 'befund':
                  default:
                    setTranscript(selectedTemplate.content);
                    break;
                }
                setCanRevert(true);
                setIsReverted(false);
                
                // Template-Modus zurücksetzen
                setSelectedTemplate(null);
                setTemplateMode(false);
              }}
              className="px-2 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors"
              title="Textbaustein ohne Änderungen einfügen"
            >
              Einfügen
            </button>
          </div>
          <p className="text-xs text-orange-700 dark:text-orange-300 line-clamp-2">
            {selectedTemplate.content.substring(0, 150)}...
          </p>
          <p className="text-xs text-orange-600 dark:text-orange-400 mt-1 italic">
            💡 Diktieren Sie nur die Änderungen, oder klicken Sie "Einfügen" um den Baustein unverändert zu übernehmen
          </p>
        </div>
      )}

      {/* Sprachbefehle-Hinweis (kompakt) */}
      {recording && (
        <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/30 px-3 py-2 rounded-lg">
          💡 <strong>Befehle:</strong> "Punkt", "Komma", "neuer Absatz"
          {mode === 'befund' && (
            <span className="ml-2">
              | <strong>Felder:</strong> "Methodik:", "Befund:", "Beurteilung:"
              <span className="ml-1 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">
                {activeField}
              </span>
            </span>
          )}
        </div>
      )}

      {error && <div className="alert alert-error text-sm">{error}</div>}

      {/* Processing Status Indicator */}
      {isProcessing && (
        <div className={`${recording ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800' : 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800'} border rounded-lg px-4 py-3 flex items-center gap-3`}>
          <Spinner size={18} className={recording ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'} />
          <div className="flex-1">
            <span className={`text-sm font-medium ${recording ? 'text-green-700 dark:text-green-300' : 'text-blue-700 dark:text-blue-300'}`}>
              {processingStatus}
            </span>
            <p className={`text-xs mt-0.5 ${recording ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'}`}>
              {recording ? 'Sprechen Sie in das Mikrofon.' : 'Bitte warten Sie, bis die Verarbeitung abgeschlossen ist.'}
            </p>
          </div>
          <div className="flex gap-1">
            <span className={`w-2 h-2 ${recording ? 'bg-green-500' : 'bg-blue-500'} rounded-full animate-bounce`} style={{ animationDelay: '0ms' }}></span>
            <span className={`w-2 h-2 ${recording ? 'bg-green-500' : 'bg-blue-500'} rounded-full animate-bounce`} style={{ animationDelay: '150ms' }}></span>
            <span className={`w-2 h-2 ${recording ? 'bg-green-500' : 'bg-blue-500'} rounded-full animate-bounce`} style={{ animationDelay: '300ms' }}></span>
          </div>
        </div>
      )}

      {/* Befund-Modus: Drei separate Felder */}
      {mode === 'befund' ? (
        <div className="space-y-3">
          {/* Methodik-Feld mit Action-Buttons */}
          <div className="flex gap-2">
            <div className="card flex-1">
              <div className="card-body py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium flex items-center gap-2">
                    Methodik
                    {activeField === 'methodik' && recording && (
                      <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded text-xs">
                        ●
                      </span>
                    )}
                  </label>
                  <div className="flex items-center gap-2">
                    {showDiffView && preCorrectionState && (
                      <DiffStats originalText={preCorrectionState.methodik} correctedText={methodik} />
                    )}
                    <span className="text-xs text-gray-400">{methodik ? `${methodik.length}` : ''}</span>
                    <button 
                      className="text-xs text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800" 
                      onClick={() => copyToClipboard(methodik)}
                      disabled={!methodik}
                      title="Kopieren"
                    >
                      📋
                    </button>
                  </div>
                </div>
                {/* Diff View für Methodik */}
                {showDiffView && preCorrectionState && !isReverted && preCorrectionState.methodik && (
                  <div className="p-2 rounded-lg border bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 max-h-32 overflow-auto text-xs">
                    <DiffHighlight
                      originalText={preCorrectionState.methodik}
                      correctedText={methodik}
                      showDiff={true}
                    />
                  </div>
                )}
                <textarea
                  className={`textarea font-mono text-sm min-h-20 ${activeField === 'methodik' && recording ? 'ring-2 ring-green-500' : ''} ${isProcessing ? 'opacity-60 cursor-not-allowed' : ''}`}
                  value={methodik}
                  onChange={(e) => { setMethodik(e.target.value); setPendingCorrection(true); }}
                  onFocus={() => setActiveField('methodik')}
                  placeholder="Methodik..."
                  rows={2}
                  readOnly={isProcessing}
                />
              </div>
            </div>
            {/* Action Buttons für Methodik */}
            <div className="w-24 flex-shrink-0">
              <CustomActionButtons
                currentField="methodik"
                getText={() => methodik}
                getAllTexts={() => ({ methodik, befund: transcript, beurteilung })}
                onResult={(result) => setMethodik(result)}
                disabled={isProcessing}
                onManageClick={() => setShowCustomActionsManager(true)}
              />
            </div>
          </div>

          {/* Befund-Feld (Hauptfeld) mit Action-Buttons */}
          <div className="flex gap-2">
            <div className="card flex-1">
              <div className="card-body py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium flex items-center gap-2">
                    Befund
                    {activeField === 'befund' && recording && (
                      <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded text-xs">
                        ●
                      </span>
                    )}
                  </label>
                  <div className="flex items-center gap-2">
                    {showDiffView && preCorrectionState && (
                      <DiffStats originalText={preCorrectionState.befund} correctedText={transcript} />
                    )}
                    <span className="text-xs text-gray-400">{transcript ? `${transcript.length}` : ''}</span>
                    <button 
                      className="text-xs text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800" 
                      onClick={() => copyToClipboard(transcript)}
                      disabled={!transcript}
                      title="Kopieren"
                    >
                      📋
                    </button>
                  </div>
                </div>
                {/* Diff View für Befund */}
                {showDiffView && preCorrectionState && !isReverted && preCorrectionState.befund && (
                  <div className="p-2 rounded-lg border bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 max-h-48 overflow-auto text-xs">
                    <DiffHighlight
                      originalText={preCorrectionState.befund}
                      correctedText={transcript}
                      showDiff={true}
                    />
                  </div>
                )}
                <textarea
                  className={`textarea font-mono text-sm min-h-32 ${activeField === 'befund' && recording ? 'ring-2 ring-green-500' : ''} ${isProcessing ? 'opacity-60 cursor-not-allowed' : ''}`}
                  value={transcript}
                  onChange={(e) => { setTranscript(e.target.value); setPendingCorrection(true); }}
                  onFocus={() => setActiveField('befund')}
                  placeholder="Befund..."
                  readOnly={isProcessing}
                />
              </div>
            </div>
            {/* Action Buttons für Befund */}
            <div className="w-24 flex-shrink-0">
              <CustomActionButtons
                currentField="befund"
                getText={() => transcript}
                getAllTexts={() => ({ methodik, befund: transcript, beurteilung })}
                onResult={(result) => setTranscript(result)}
                disabled={isProcessing}
                onManageClick={() => setShowCustomActionsManager(true)}
              />
            </div>
          </div>

          {/* Warnbanner bei signifikanten Änderungen */}
          {changeScore !== null && changeScore > 35 && !isProcessing && (
            <ChangeWarningBanner score={changeScore} />
          )}

          {/* Beurteilung-Feld mit Action-Buttons */}
          <div className="flex gap-2">
            <div className="card flex-1">
              <div className="card-body py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium flex items-center gap-2">
                      Zusammenfassung
                      {activeField === 'beurteilung' && recording && (
                        <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded text-xs">
                          ●
                        </span>
                    )}
                    </label>
                    {changeScore !== null && !isProcessing && (
                      <ChangeIndicator score={changeScore} size="sm" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {showDiffView && preCorrectionState && (
                      <DiffStats originalText={preCorrectionState.beurteilung} correctedText={beurteilung} />
                    )}
                    <span className="text-xs text-gray-400">{beurteilung ? `${beurteilung.length}` : ''}</span>
                    <button 
                      className="text-xs text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800" 
                      onClick={() => copyToClipboard(beurteilung)}
                      disabled={!beurteilung}
                      title="Kopieren"
                    >
                      📋
                    </button>
                  </div>
                </div>
                {/* Diff View für Beurteilung */}
                {showDiffView && preCorrectionState && !isReverted && preCorrectionState.beurteilung && (
                  <div className="p-2 rounded-lg border bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 max-h-32 overflow-auto text-xs">
                    <DiffHighlight
                      originalText={preCorrectionState.beurteilung}
                      correctedText={beurteilung}
                      showDiff={true}
                    />
                  </div>
                )}
                <textarea
                  className={`textarea font-mono text-sm min-h-20 ${activeField === 'beurteilung' && recording ? 'ring-2 ring-green-500' : ''} ${isProcessing ? 'opacity-60 cursor-not-allowed' : ''}`}
                  value={beurteilung}
                  onChange={(e) => { setBeurteilung(e.target.value); setPendingCorrection(true); }}
                  onFocus={() => setActiveField('beurteilung')}
                  placeholder="Zusammenfassung..."
                  rows={2}
                  readOnly={isProcessing}
                />
                <button 
                  className="btn btn-primary w-full text-sm py-2" 
                  onClick={handleSuggestBeurteilung} 
                  disabled={!transcript.trim() || suggestingBeurteilung}
                >
                  {suggestingBeurteilung ? (
                    <><Spinner className="mr-2" size={14} /> Generiere...</>
                  ) : (
                    '✨ Zusammenfassung erstellen'
                  )}
                </button>
              </div>
            </div>
            {/* Action Buttons für Beurteilung */}
            <div className="w-24 flex-shrink-0">
              <CustomActionButtons
                currentField="beurteilung"
                getText={() => beurteilung}
                getAllTexts={() => ({ methodik, befund: transcript, beurteilung })}
                onResult={(result) => setBeurteilung(result)}
                disabled={isProcessing}
                onManageClick={() => setShowCustomActionsManager(true)}
              />
            </div>
          </div>
        </div>
      ) : (
        /* Arztbrief-Modus: Ein einzelnes Feld */
        <div className="card">
          <div className="card-body py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium">Ergebnis</label>
                {changeScore !== null && !isProcessing && (
                  <ChangeIndicator score={changeScore} size="sm" />
                )}
              </div>
              <div className="flex items-center gap-2">
                {showDiffView && preCorrectionState && (
                  <DiffStats originalText={preCorrectionState.transcript} correctedText={transcript} />
                )}
                <span className="text-xs text-gray-400">{transcript ? `${transcript.length}` : ''}</span>
                <button 
                  className="text-xs text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800" 
                  onClick={handleCopy}
                  disabled={!transcript}
                  title="Kopieren"
                >
                  📋
                </button>
              </div>
            </div>
            
            {/* Warnbanner bei signifikanten Änderungen */}
            <ChangeWarningBanner score={changeScore} />
            
            {/* Diff View für Arztbrief */}
            {showDiffView && preCorrectionState && !isReverted && preCorrectionState.transcript && (
              <div className="p-3 rounded-lg border bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 max-h-64 overflow-auto">
                <DiffHighlight
                  originalText={preCorrectionState.transcript}
                  correctedText={transcript}
                  showDiff={true}
                />
              </div>
            )}
            
            <div className="flex gap-2">
              <div className="flex-1">
                <textarea
                  className={`textarea font-mono text-sm min-h-40 w-full ${isProcessing ? 'opacity-60 cursor-not-allowed' : ''}`}
                  value={transcript}
                  onChange={(e) => { setTranscript(e.target.value); setPendingCorrection(true); }}
                  placeholder="Text erscheint hier..."
                  readOnly={isProcessing}
                />
                <div className="flex gap-2 mt-2">
                  <button className="btn btn-primary flex-1 text-sm py-2" onClick={handleFormat} disabled={busy || !transcript}>
                    {busy && <Spinner className="mr-2" size={14} />} Formatieren
                  </button>
                  <button className="btn btn-outline text-sm py-2" onClick={handleExportDocx} disabled={!transcript}>.docx</button>
                </div>
              </div>
              {/* Action Buttons für Arztbrief */}
              <div className="w-24 flex-shrink-0">
                <CustomActionButtons
                  currentField="transcript"
                  getText={() => transcript}
                  onResult={(result) => setTranscript(result)}
                  disabled={isProcessing}
                  onManageClick={() => setShowCustomActionsManager(true)}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Actions Manager Modal */}
      {showCustomActionsManager && (
        <CustomActionsManager onClose={() => setShowCustomActionsManager(false)} />
      )}
    </div>
  );
}
