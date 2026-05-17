"use client";
import { useEffect, useRef, useState, useCallback, type SetStateAction } from 'react';
import { Tabs } from '@/components/Tabs';
import { exportDocx } from '@/lib/formatMedical';
import Spinner from '@/components/Spinner';
import { useAuth } from '@/components/AuthProvider';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';
import { ChangeIndicator, ChangeWarningBanner } from '@/components/ChangeIndicator';
import { applyDeleteCommands, applyFormattingControlWords, applyOnlineDictationControlWords, applyOnlineUtteranceToText, combineFormattedText, preprocessTranscription, type OnlineUtteranceApplicationDebugStep } from '@/lib/textFormatting';
import { buildPhoneticIndex, applyPhoneticCorrections } from '@/lib/phoneticMatch';
import { mergeWithStandardDictionary } from '@/lib/standardDictionary';
import CustomActionButtons from '@/components/CustomActionButtons';
import CustomActionsManager from '@/components/CustomActionsManager';
import DiffHighlight, { DiffStats } from '@/components/DiffHighlight';
import { parseSpeaKINGXml, readFileAsText, SpeaKINGMetadata } from '@/lib/audio';
import { HID_MEDIA_CONTROL_EVENT, type HidMediaControlEventDetail } from '@/lib/hidMediaControls';
import { useVadChunking } from '@/lib/useVadChunking';
import { injectToActiveWindow, isClipboardFallback } from '@/lib/injectClient';

const DICTIONARY_CHANGED_EVENT = 'schreibdienst:dictionary-changed';
const UNRECOGNIZED_UTTERANCE_PLACEHOLDER = '[nicht verstanden]';

// Hilfsfunktion zum Kopieren in die Zwischenablage
async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
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

// Runtime Config Interface
interface RuntimeConfig {
  transcriptionProvider: 'whisperx' | 'elevenlabs' | 'mistral' | 'fast_whisper' | 'voxtral_local';
  fastWhisperWsUrl?: string;
  voxtralLocalWsUrl?: string;
  voxtralLocalOnlineMode?: 'websocket' | 'chunk';
}

type TextInsertionTarget = 'transcript' | BefundField;

interface CaretSelection {
  start: number;
  end: number;
  direction: HTMLTextAreaElement['selectionDirection'];
}

interface CaretOverlayPosition {
  top: number;
  left: number;
  height: number;
  visible: boolean;
}

interface TextInsertionResult {
  text: string;
  selection: CaretSelection;
}

function getDefaultSelection(text: string): CaretSelection {
  return {
    start: text.length,
    end: text.length,
    direction: 'none',
  };
}

function insertTextAtSelection(existing: string, incomingText: string, selection?: CaretSelection | null): TextInsertionResult {
  if (!incomingText) {
    return {
      text: existing,
      selection: selection ?? getDefaultSelection(existing),
    };
  }

  const baseSelection = selection ?? getDefaultSelection(existing);
  const start = Math.max(0, Math.min(baseSelection.start, existing.length));
  const end = Math.max(start, Math.min(baseSelection.end, existing.length));
  const before = existing.slice(0, start);
  const after = existing.slice(end);
  const needsPrefixSeparator = before.length > 0 && !before.endsWith('\n') && !before.endsWith(' ');
  const prefix = needsPrefixSeparator ? ' ' : '';
  const inserted = `${before}${prefix}${incomingText}`;
  const caretIndex = inserted.length;

  if (!after) {
    return {
      text: inserted,
      selection: {
        start: caretIndex,
        end: caretIndex,
        direction: 'none',
      },
    };
  }

  const needsSuffixSeparator = !inserted.endsWith('\n')
    && !inserted.endsWith(' ')
    && !after.startsWith('\n')
    && !after.startsWith(' ')
    && !/^[,.;:!?)]/.test(after);

  return {
    text: `${inserted}${needsSuffixSeparator ? ' ' : ''}${after}`,
    selection: {
      start: caretIndex,
      end: caretIndex,
      direction: 'none',
    },
  };
}

function getIncrementalTranscript(previousText: string, currentText: string): string {
  if (!previousText) return currentText;
  if (currentText.startsWith(previousText)) {
    return currentText.slice(previousText.length);
  }

  const normalizeToken = (token: string) => token
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

  const previousWords = (previousText.match(/\S+/g) || []).map(normalizeToken).filter(Boolean);
  const currentWordMatches = Array.from(currentText.matchAll(/\S+/g));
  const currentWords = currentWordMatches
    .map((match) => ({
      raw: match[0],
      start: match.index ?? 0,
      normalized: normalizeToken(match[0]),
    }))
    .filter((word) => word.normalized.length > 0);

  const maxOverlap = Math.min(previousWords.length, currentWords.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      if (previousWords[previousWords.length - overlap + index] !== currentWords[index].normalized) {
        matches = false;
        break;
      }
    }

    if (!matches) {
      continue;
    }

    if (overlap === currentWords.length) {
      return '';
    }

    return currentText.slice(currentWords[overlap].start);
  }

  let prefixLength = 0;
  const maxPrefixLength = Math.min(previousText.length, currentText.length);
  while (prefixLength < maxPrefixLength && previousText[prefixLength] === currentText[prefixLength]) {
    prefixLength += 1;
  }

  if (prefixLength > 0) {
    return currentText.slice(prefixLength);
  }

  return currentText;
}

function hiddenCaretOverlay(): CaretOverlayPosition {
  return { top: 0, left: 0, height: 0, visible: false };
}

function getTextareaCaretOverlay(
  textarea: HTMLTextAreaElement | null,
  selection?: CaretSelection | null
): CaretOverlayPosition {
  if (!textarea || !selection || selection.start !== selection.end) {
    return hiddenCaretOverlay();
  }

  const caretIndex = Math.max(0, Math.min(selection.end, textarea.value.length));
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');

  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordBreak = 'break-word';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.boxSizing = style.boxSizing;
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.font = style.font;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.fontStyle = style.fontStyle;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.textTransform = style.textTransform;
  mirror.style.textIndent = style.textIndent;
  mirror.style.textAlign = style.textAlign;
  mirror.style.tabSize = style.tabSize;

  const beforeCaret = textarea.value.slice(0, caretIndex);
  const afterCaret = textarea.value.slice(caretIndex) || ' ';
  mirror.textContent = beforeCaret;

  const marker = document.createElement('span');
  marker.textContent = afterCaret[0] === '\n' ? ' ' : afterCaret[0];
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
  const top = marker.offsetTop - textarea.scrollTop;
  const left = marker.offsetLeft - textarea.scrollLeft;

  document.body.removeChild(mirror);

  return {
    top: Math.max(0, top),
    left: Math.max(0, left),
    height: lineHeight,
    visible: true,
  };
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
  const recordingStartedAtRef = useRef<number | null>(null);
  const manualCorrectionTimersRef = useRef<Partial<Record<TextInsertionTarget, ReturnType<typeof setTimeout>>>>({});
  
  // Fast Whisper WebSocket State
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const fastWhisperWsRef = useRef<WebSocket | null>(null);
  const fastWhisperAudioContextRef = useRef<AudioContext | null>(null);
  const fastWhisperProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const fastWhisperStreamRef = useRef<MediaStream | null>(null);
  
  // Voxtral Local Realtime WebSocket State (shared audio refs with FastWhisper)
  const voxtralWsRef = useRef<WebSocket | null>(null);
  const voxtralAudioContextRef = useRef<AudioContext | null>(null);
  const voxtralProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const voxtralStreamRef = useRef<MediaStream | null>(null);
  
  // Fast Whisper: Akkumulierte finale Texte (wird bei jedem finalen Satz erweitert)
  const fastWhisperFinalTextRef = useRef<string>("");
  const fastWhisperFinalMethodikRef = useRef<string>("");
  const fastWhisperFinalBeurteilungRef = useRef<string>("");
  
  // Fast Whisper: Wort-für-Wort Anzeige - trackt stabile Wörter aus Partials
  const fastWhisperLastPartialRef = useRef<string>("");
  const fastWhisperPartialCountRef = useRef<number>(0); // Zählt wie oft der gleiche Partial kam
  const fastWhisperStableWordsRef = useRef<string>(""); // Bestätigte Wörter aus Partials
  const fastWhisperStableMethodikRef = useRef<string>("");
  const fastWhisperStableBeurteilungRef = useRef<string>("");
  
  // SSL-Zertifikat Status für Fast Whisper
  const [sslCertWarning, setSslCertWarning] = useState<{ show: boolean; serverUrl: string } | null>(null);
  
  // Mikrofonpegel-Visualisierung
  const [audioLevel, setAudioLevel] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Text der VOR dieser Aufnahme-Session existierte
  const existingTextRef = useRef<string>("");
  // Letzter transkribierter Text dieser Session
  const lastTranscriptRef = useRef<string>("");
  
  // VAD-basiertes Utterance-Commit: Gelockte Sätze + tentativer (aktuell gesprochener) Text
  const [committedUtterances, setCommittedUtterances] = useState<string[]>([]);
  const [tentativeText, setTentativeText] = useState<string>("");
  const committedUtterancesRef = useRef<string[]>([]);
  // Prompt-Kontext: Letzte 1-2 gelockte Sätze für konsistente Transkription
  const vadPromptContextRef = useRef<string>("");
  // VAD-Sequenzierung: Garantiert reihenfolgetreue Commits und verhindert Verlust
  // bei parallel laufenden Transkriptions-Requests (Race Condition).
  const vadSeqCounterRef = useRef<number>(0);          // Nächste zu vergebende Seq
  const vadNextCommitSeqRef = useRef<number>(0);       // Nächste zu committende Seq
  const vadInFlightCountRef = useRef<number>(0);       // Anzahl laufender Requests
  const vadSessionIdRef = useRef<number>(0);           // Trennt alte von neuen Aufnahme-Sessions
  // Ergebnisse, die auf vorherige Seq warten müssen, bevor sie committet werden können
  const vadPendingResultsRef = useRef<Map<number, { text: string; failed: boolean; blob: Blob }>>(new Map());
  // Audio-Blobs deren Transkription dauerhaft fehlgeschlagen ist (für manuelle Wiederholung)
  const [vadFailedUtterances, setVadFailedUtterances] = useState<Array<{ seq: number; blob: Blob; error: string }>>([]);
  
  const [transcript, setTranscript] = useState("");
  const methodikTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const befundTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const beurteilungTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [textSelections, setTextSelections] = useState<Partial<Record<TextInsertionTarget, CaretSelection>>>({});
  const textSelectionsRef = useRef<Partial<Record<TextInsertionTarget, CaretSelection>>>({});
  const [focusedTextField, setFocusedTextField] = useState<TextInsertionTarget | null>(null);
  const [caretOverlays, setCaretOverlays] = useState<Record<TextInsertionTarget, CaretOverlayPosition>>({
    transcript: hiddenCaretOverlay(),
    methodik: hiddenCaretOverlay(),
    befund: hiddenCaretOverlay(),
    beurteilung: hiddenCaretOverlay(),
  });
  const [mode, setMode] = useState<'arztbrief' | 'befund'>('befund');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [injectFeedback, setInjectFeedback] = useState<string | null>(null);
  const [liveInjectEnabled, setLiveInjectEnabled] = useState(false);
  const liveInjectEnabledRef = useRef(false);
  const liveInjectQueueRef = useRef<Promise<void>>(Promise.resolve());
  
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
  // Spiegel von activeField als Ref, damit asynchrone VAD-Commits (Voxtral online)
  // den aktuell aktiven Feld-Wert sehen, ohne dass der useCallback-Closure neu
  // erzeugt werden muss.
  const activeFieldRef = useRef<BefundField>('befund');
  useEffect(() => { activeFieldRef.current = activeField; }, [activeField]);
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

  const syncTextSelection = useCallback((field: TextInsertionTarget, textarea: HTMLTextAreaElement) => {
    const nextSelection: CaretSelection = {
      start: textarea.selectionStart ?? 0,
      end: textarea.selectionEnd ?? 0,
      direction: textarea.selectionDirection ?? 'none',
    };

    textSelectionsRef.current = {
      ...textSelectionsRef.current,
      [field]: nextSelection,
    };

    setTextSelections((prev) => {
      const current = prev[field];
      if (
        current
        && current.start === nextSelection.start
        && current.end === nextSelection.end
        && current.direction === nextSelection.direction
      ) {
        return prev;
      }

      return {
        ...prev,
        [field]: nextSelection,
      };
    });
  }, []);

  const setStoredSelection = useCallback((field: TextInsertionTarget, selection: CaretSelection) => {
    textSelectionsRef.current = {
      ...textSelectionsRef.current,
      [field]: selection,
    };

    setTextSelections((prev) => ({
      ...prev,
      [field]: selection,
    }));
  }, []);

  const getStoredSelection = useCallback((field: TextInsertionTarget, currentText: string) => {
    return textSelectionsRef.current[field] ?? getDefaultSelection(currentText);
  }, []);

  const setFieldText = useCallback((field: TextInsertionTarget, value: SetStateAction<string>) => {
    switch (field) {
      case 'methodik':
        setMethodik(value);
        break;
      case 'beurteilung':
        setBeurteilung(value);
        break;
      case 'befund':
      case 'transcript':
      default:
        setTranscript(value);
        break;
    }
  }, []);

  const combineTextForField = useCallback((field: TextInsertionTarget, existing: string, newText: string) => {
    const result = insertTextAtSelection(existing, newText, getStoredSelection(field, existing));
    setStoredSelection(field, result.selection);
    return result.text;
  }, [getStoredSelection, setStoredSelection]);

  useEffect(() => {
    liveInjectEnabledRef.current = liveInjectEnabled;
  }, [liveInjectEnabled]);

  const queueLiveInject = useCallback((text: string) => {
    if (!liveInjectEnabledRef.current || !text.trim()) return;

    liveInjectQueueRef.current = liveInjectQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const result = await injectToActiveWindow({
          text,
          restorePreviousWindow: false,
          delayMs: 0,
          charDelayMs: 2,
          fallbackToClipboard: false,
        });

        if (!result.ok) {
          setLiveInjectEnabled(false);
          setError(result.error || 'Live-Übertragung in die Ziel-App fehlgeschlagen');
        }
      });
  }, []);

  const replaceTextAtEndOrInsertDelta = useCallback((
    field: TextInsertionTarget,
    fullText: string,
    incomingDelta: string
  ) => {
    if (incomingDelta && incomingDelta.trim()) {
      queueLiveInject(incomingDelta);
    }

    // WICHTIG: Neu transkribierter Text wird IMMER gegen den aktuellsten Feld-State
    // berechnet. Der vorherige Stand darf nicht aus einem Render-Closure stammen,
    // weil mehrere VAD-Commits kurz hintereinander eintreffen koennen.
    setFieldText(field, (currentText) => {
      // Neu transkribierter Text wird an der aktuellen Cursor-Position eingefuegt,
      // nie per Vollersetzung des Feldinhalts.
      if (incomingDelta && incomingDelta.trim()) {
        return combineTextForField(field, currentText, incomingDelta);
      }

      // Kein textuelles Delta, aber `fullText` weicht vom aktuellen Feldinhalt ab
      // (z. B. nach einem Loesch-Steuerbefehl) UND der Vorzustand ist ein striktes
      // Praefix von `fullText`. Dann kann die Erweiterung sicher angehaengt werden.
      if (fullText && fullText !== currentText && fullText.startsWith(currentText)) {
        const extension = fullText.slice(currentText.length);
        if (extension) {
          return combineTextForField(field, currentText, extension);
        }
      }

      return currentText;
    });
  }, [setFieldText, combineTextForField, queueLiveInject]);

  const showPersistentCaret = recording || transcribing || busy || correcting;

  useEffect(() => {
    if (!showPersistentCaret) {
      setCaretOverlays({
        transcript: hiddenCaretOverlay(),
        methodik: hiddenCaretOverlay(),
        befund: hiddenCaretOverlay(),
        beurteilung: hiddenCaretOverlay(),
      });
      return;
    }

    setCaretOverlays({
      transcript: getTextareaCaretOverlay(transcriptTextareaRef.current, getStoredSelection('transcript', transcript)),
      methodik: getTextareaCaretOverlay(methodikTextareaRef.current, getStoredSelection('methodik', methodik)),
      befund: getTextareaCaretOverlay(befundTextareaRef.current, getStoredSelection('befund', transcript)),
      beurteilung: getTextareaCaretOverlay(beurteilungTextareaRef.current, getStoredSelection('beurteilung', beurteilung)),
    });
  }, [transcript, methodik, beurteilung, textSelections, showPersistentCaret, getStoredSelection]);

  // SpeaKING Import State
  const [speakingMetadata, setSpeakingMetadata] = useState<SpeaKINGMetadata | null>(null);
  const [speakingWavFile, setSpeakingWavFile] = useState<File | null>(null);
  const [showSpeakingImport, setShowSpeakingImport] = useState(false);

  // Template-Modus: Textbaustein mit diktierten Änderungen kombinieren
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [templateMode, setTemplateMode] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const currentTemplateField: BefundField = mode === 'befund' ? activeField : 'befund';
  const availableTemplates = templates.filter((template) => template.field === currentTemplateField);

  const getTextForBefundField = useCallback((field: BefundField): string => {
    switch (field) {
      case 'methodik':
        return methodik;
      case 'beurteilung':
        return beurteilung;
      case 'befund':
      default:
        return transcript;
    }
  }, [methodik, transcript, beurteilung]);

  const applySelectedTemplate = useCallback(async (changesOverride?: string) => {
    if (!selectedTemplate) {
      return false;
    }

    const changesText = (changesOverride ?? getTextForBefundField(selectedTemplate.field)).trim();
    setError(null);
    setCorrecting(true);

    try {
      let nextText = selectedTemplate.content;

      if (changesText) {
        console.log('[Template] Adapting template:', selectedTemplate.name);
        console.log('[Template] Changes:', changesText);

        const res = await fetch('/api/templates/adapt', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': getAuthHeader(),
            ...getDbTokenHeader(),
          },
          body: JSON.stringify({
            template: selectedTemplate.content,
            changes: changesText,
            field: selectedTemplate.field,
            username,
          }),
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'Template-Anpassung fehlgeschlagen');
        }

        const data = await res.json();
        if (!data.adaptedText) {
          throw new Error('Template-Anpassung lieferte keinen Text zurück');
        }

        nextText = data.adaptedText;
      }

      setPreCorrectionState({
        methodik,
        befund: transcript,
        beurteilung,
        transcript: '',
      });
      setFieldText(selectedTemplate.field, nextText);
      setCanRevert(true);
      setIsReverted(false);
      setPendingCorrection(false);
      return true;
    } catch (err: any) {
      console.error('[Template] Apply error:', err);
      setError(err.message || 'Fehler bei Template-Anpassung');
      return false;
    } finally {
      setCorrecting(false);
      setSelectedTemplate(null);
      setTemplateMode(false);
    }
  }, [selectedTemplate, getTextForBefundField, getAuthHeader, getDbTokenHeader, username, methodik, transcript, beurteilung, setFieldText]);

  // Wörterbuch-Einträge für Echtzeit-Korrektur und Initial Prompt
  interface DictionaryEntry {
    wrong: string;
    correct: string;
    useInPrompt?: boolean;
  }
  const [dictionaryEntries, setDictionaryEntries] = useState<DictionaryEntry[]>([]);
  const [standardDictEntries, setStandardDictEntries] = useState<{ wrong: string; correct: string }[]>([]);

  // Wörterbuch laden
  const fetchDictionary = useCallback(async () => {
    if (!username) return;
    try {
      const response = await fetch('/api/dictionary', {
        headers: { 
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        }
      });
      const data = await response.json();
      if (data.entries) {
        setDictionaryEntries(data.entries);
        console.log('[Dictionary] Loaded', data.entries.length, 'entries for real-time correction');
      }
    } catch (error) {
      console.error('[Dictionary] Load error:', error);
    }
  }, [username, getAuthHeader, getDbTokenHeader]);

  // Standard-Wörterbuch aus DB laden
  const fetchStandardDictionary = useCallback(async () => {
    if (!username) return;
    try {
      const response = await fetch('/api/standard-dictionary', {
        headers: { 
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        }
      });
      const data = await response.json();
      if (data.entries) {
        setStandardDictEntries(data.entries);
        console.log('[StandardDict] Loaded', data.entries.length, 'standard entries from DB');
      }
    } catch (error) {
      console.error('[StandardDict] Load error:', error);
    }
  }, [username, getAuthHeader, getDbTokenHeader]);

  // Wörterbuch-Ersetzungen auf Text anwenden (clientseitig)
  // Pass 1: Exaktes Matching, Pass 2: Phonetisches Matching (Kölner Phonetik)
  const phoneticIndexRef = useRef<ReturnType<typeof buildPhoneticIndex> | null>(null);
  
  // Gemergte Einträge (User + Standard-Wörterbuch)
  const mergedEntriesRef = useRef<{ wrong: string; correct: string }[]>([]);
  
  // Phonetischen Index neu aufbauen wenn sich Wörterbuch ändert
  useEffect(() => {
    const merged = mergeWithStandardDictionary(dictionaryEntries, standardDictEntries.length > 0 ? standardDictEntries : undefined);
    mergedEntriesRef.current = merged;
    phoneticIndexRef.current = buildPhoneticIndex(merged);
    console.log('[Phonetic] Index built with', merged.length, 'entries (', dictionaryEntries.length, 'user +', merged.length - dictionaryEntries.length, 'standard)');
  }, [dictionaryEntries, standardDictEntries]);

  const applyDictionaryToText = useCallback((text: string): string => {
    if (!text || mergedEntriesRef.current.length === 0) return text;
    
    // Pass 1: Exaktes Wort-Matching (User + Standard)
    let result = text;
    for (const entry of mergedEntriesRef.current) {
      // Unicode-sichere Wortgrenzen, damit z.B. "IgE" nicht das Suffix in
      // "übermäßige" trifft. \b ist dafür mit Umlauten/ß zu ungenau.
      const escaped = entry.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?<![A-ZÄÖÜa-zäöüß])${escaped}(?![A-ZÄÖÜa-zäöüß])`, 'gi');
      result = result.replace(regex, entry.correct);
    }
    
    // Pass 2: Phonetisches Matching für verbleibende unerkannte Wörter
    if (phoneticIndexRef.current) {
      result = applyPhoneticCorrections(result, phoneticIndexRef.current);
    }
    
    return result;
  }, [dictionaryEntries]);

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

  // Runtime Config laden (für Fast Whisper WebSocket URL)
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const res = await fetchWithDbToken('/api/config');
        const data = await res.json();
        if (data.config) {
          const configuredOnlineService = data.config.onlineService || data.config.transcriptionProvider || 'whisperx';
          const providerFromService = String(configuredOnlineService).split(':')[0] as RuntimeConfig['transcriptionProvider'];
          // Voxtral Local WS URL aus HTTP URL ableiten
          let voxtralWsUrl: string | undefined;
          if (data.envInfo?.voxtralLocalUrl) {
            voxtralWsUrl = data.envInfo.voxtralLocalUrl
              .replace(/^https:\/\//, 'wss://')
              .replace(/^http:\/\//, 'ws://')
              .replace(/\/$/, '') + '/v1/realtime';
          }
          const config = {
            transcriptionProvider: providerFromService,
            fastWhisperWsUrl: data.envInfo?.fastWhisperWsUrl,
            voxtralLocalWsUrl: voxtralWsUrl,
            voxtralLocalOnlineMode: data.config.voxtralLocalOnlineMode || 'websocket',
          };
          setRuntimeConfig(config);
          console.log('[Config] Loaded - Provider:', providerFromService, 'Voxtral mode:', config.voxtralLocalOnlineMode);
          
          // Bei Fast Whisper mit WSS: SSL-Zertifikat prüfen
          if (config.transcriptionProvider === 'fast_whisper' && config.fastWhisperWsUrl) {
            let wsUrl = config.fastWhisperWsUrl;
            // HTTPS-Seiten erfordern wss://
            if (typeof window !== 'undefined' && window.location.protocol === 'https:' && wsUrl.startsWith('ws://')) {
              wsUrl = wsUrl.replace('ws://', 'wss://');
            }
            
            if (wsUrl.startsWith('wss://')) {
              // Teste WebSocket-Verbindung
              console.log('[SSL Check] Testing WSS connection to', wsUrl);
              const testWs = new WebSocket(wsUrl);
              const timeout = setTimeout(() => {
                testWs.close();
                // Timeout = wahrscheinlich Zertifikatsproblem
                const serverUrl = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
                setSslCertWarning({ show: true, serverUrl });
                console.warn('[SSL Check] Connection timeout - certificate may need acceptance');
              }, 3000);
              
              testWs.onopen = () => {
                clearTimeout(timeout);
                testWs.close();
                setSslCertWarning(null);
                console.log('[SSL Check] ✓ WSS connection successful');
              };
              
              testWs.onerror = () => {
                clearTimeout(timeout);
                testWs.close();
                const serverUrl = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
                setSslCertWarning({ show: true, serverUrl });
                console.warn('[SSL Check] Connection error - certificate may need acceptance');
              };
            }
          }
        }
      } catch (err) {
        console.warn('[Config] Could not load runtime config');
      }
    };
    loadConfig();
  }, []);

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
    if (username) {
      fetchTemplates();
    }
  }, [username, fetchTemplates]);

  // Wörterbuch beim Start laden (für Echtzeit-Korrektur bei Fast Whisper)
  useEffect(() => {
    if (username) {
      fetchDictionary();
      fetchStandardDictionary();
    }
  }, [username, fetchDictionary, fetchStandardDictionary]);

  useEffect(() => {
    const handleDictionaryChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ scope?: string }>;
      if (customEvent.detail?.scope === 'private') {
        fetchDictionary();
      }

      if (customEvent.detail?.scope === 'standard') {
        fetchStandardDictionary();
      }
    };

    window.addEventListener(DICTIONARY_CHANGED_EVENT, handleDictionaryChanged);
    return () => window.removeEventListener(DICTIONARY_CHANGED_EVENT, handleDictionaryChanged);
  }, [fetchDictionary, fetchStandardDictionary]);

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
    if (selectedTemplate && selectedTemplate.field !== currentTemplateField) {
      setSelectedTemplate(null);
      setTemplateMode(false);
    }
  }, [currentTemplateField, selectedTemplate]);

  // Funktion zum Transkribieren eines Blobs
  const logManualCorrection = useCallback((field: TextInsertionTarget) => {
    if (!username) return;
    const existingTimer = manualCorrectionTimersRef.current[field];
    if (existingTimer) clearTimeout(existingTimer);

    manualCorrectionTimersRef.current[field] = setTimeout(() => {
      fetchWithDbToken('/api/online-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          eventType: 'manual_correction',
          manualCorrections: 1,
        }),
      }).catch((err) => console.warn('[Stats] Manual correction tracking failed:', err));
      delete manualCorrectionTimersRef.current[field];
    }, 1500);
  }, [username]);

  const handleManualTextChange = useCallback((
    field: TextInsertionTarget,
    value: string,
    setter: (nextValue: string) => void,
    textarea: HTMLTextAreaElement
  ) => {
    setter(value);
    setPendingCorrection(true);
    syncTextSelection(field, textarea);
    logManualCorrection(field);
  }, [logManualCorrection, syncTextSelection]);

  const transcribeChunk = useCallback(async (blob: Blob, isLive: boolean = false, audioDurationSeconds?: number): Promise<string> => {
    try {
      const fd = new FormData();
      fd.append('file', blob, 'audio.webm');
      if (username) {
        fd.append('username', username);
      }
      // Online-Diktat: Turbo-Modus (kein Alignment, schnellere Antwort)
      fd.append('speed_mode', 'turbo');
      fd.append('stats_event', isLive ? 'false' : 'true');
      if (audioDurationSeconds && audioDurationSeconds > 0) {
        fd.append('audio_duration_seconds', String(audioDurationSeconds));
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

  // Transkribiert eine Utterance mit Retry-Logik. Wirft Fehler erst nach allen Versuchen.
  const transcribeUtteranceWithRetry = useCallback(async (
    wavBlob: Blob,
    promptContext: string
  ): Promise<string> => {
    const MAX_ATTEMPTS = 3;
    const TIMEOUT_MS = 45000; // 45s pro Versuch (Utterances können lang sein)
    let lastError: any = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const fd = new FormData();
        fd.append('file', wavBlob, 'utterance.wav');
        if (username) fd.append('username', username);
        fd.append('speed_mode', 'turbo');
        if (promptContext) fd.append('prompt_context', promptContext);
        const res = await fetchWithDbToken('/api/transcribe', {
          method: 'POST',
          body: fd,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.text || '';
      } catch (err: any) {
        clearTimeout(timeout);
        lastError = err;
        const isAbort = err?.name === 'AbortError';
        console.warn(`[VAD] Transkriptions-Versuch ${attempt}/${MAX_ATTEMPTS} fehlgeschlagen${isAbort ? ' (Timeout)' : ''}: ${err?.message || err}`);
        if (attempt < MAX_ATTEMPTS) {
          // Exponentielles Backoff: 500ms, 1500ms
          await new Promise(r => setTimeout(r, 500 * attempt * attempt));
        }
      }
    }
    throw lastError || new Error('Transkription nach mehreren Versuchen fehlgeschlagen');
  }, [username]);

  const estimateWavDurationSeconds = useCallback((blob: Blob): number => {
    const wavHeaderBytes = 44;
    const wavBytesPerSecond = 16000 * 2;
    return Math.max(0, (blob.size - wavHeaderBytes) / wavBytesPerSecond);
  }, []);

  const getVadLogPreview = useCallback((text: string): string => {
    return text.replace(/\s+/g, ' ').trim().slice(0, 120);
  }, []);

  const getVadPromptContext = useCallback((text: string): string => {
    const trimmed = text.trim();
    if (!trimmed) return '';
    return trimmed.length > 200 ? trimmed.slice(-200) : trimmed;
  }, []);

  // Drainiert fertige Ergebnisse in der korrekten Reihenfolge in den committed-State.
  // Garantiert dass Utterances NIE in falscher Reihenfolge erscheinen oder verloren gehen.
  const drainVadCommitQueue = useCallback(() => {
    let didCommit = false;
    let combinedCommittedText = committedUtterancesRef.current.join(' ');
    const previousCommittedText = combinedCommittedText;
    while (vadPendingResultsRef.current.has(vadNextCommitSeqRef.current)) {
      const seq = vadNextCommitSeqRef.current;
      const entry = vadPendingResultsRef.current.get(seq)!;
      vadPendingResultsRef.current.delete(seq);
      vadNextCommitSeqRef.current = seq + 1;

      if (entry.failed) {
        // Permanenter Fehler: sichtbarer Platzhalter + Audio-Blob für manuelle Wiederholung aufbewahren
        const text = '[⚠ Audio-Abschnitt nicht transkribiert – bitte wiederholen]';
        console.warn(`[VAD] Commit utterance #${seq}: permanent failure placeholder inserted`);
        setVadFailedUtterances(prev => [...prev, {
          seq,
          blob: entry.blob,
          error: 'Transkription nach mehreren Versuchen fehlgeschlagen',
        }]);
        combinedCommittedText = combineFormattedText(combinedCommittedText, text);
        didCommit = true;
        continue;
      }

      const debugSteps: OnlineUtteranceApplicationDebugStep[] = [];
      const nextCombinedText = applyOnlineUtteranceToText(combinedCommittedText, entry.text, step => {
        debugSteps.push(step);
      });
      if (nextCombinedText !== combinedCommittedText) {
        console.log(
          `[VAD] Commit utterance #${seq}: text applied (input="${getVadLogPreview(entry.text)}", steps=${debugSteps
            .map(step => `${step.kind}:${step.commandType ?? getVadLogPreview(step.input)}:${step.changed ? 'changed' : 'noop'}`)
            .join(', ')})`
        );
        combinedCommittedText = nextCombinedText;
        didCommit = true;
      } else {
        console.warn(
          `[VAD] Commit utterance #${seq}: no visible text change (input="${getVadLogPreview(entry.text)}", steps=${debugSteps
            .map(step => `${step.kind}:${step.commandType ?? getVadLogPreview(step.input)}:${step.changed ? 'changed' : 'noop'}`)
            .join(', ')})`
        );
      }
    }

    if (didCommit) {
      const committed = combinedCommittedText.trim() ? [combinedCommittedText] : [];
      committedUtterancesRef.current = committed;
      setCommittedUtterances(committed);
      // Prompt-Kontext: letzte 2 gelockte Sätze (max. 200 Zeichen)
      const lastTwo = committed.slice(-2).join(' ');
      vadPromptContextRef.current = lastTwo.length > 200 ? lastTwo.slice(-200) : lastTwo;
      // Transcript-State synchronisieren (für Export, Korrektur etc.).
      // committed enthält im VAD-Pfad bereits den vollständigen aktuellen Textzustand,
      // inklusive bestehendem Text vor Session-Start.
      // Im Befund-Modus muss in das aktuell aktive Feld diktiert werden
      // (methodik / befund / beurteilung), nicht pauschal in 'befund'.
      const targetField: TextInsertionTarget = mode === 'befund'
        ? activeFieldRef.current
        : 'transcript';
      const fullText = committed[0] || '';
      const incomingDelta = getIncrementalTranscript(previousCommittedText, fullText);
      replaceTextAtEndOrInsertDelta(targetField, fullText, incomingDelta);
    }

    // Tentative nur löschen, wenn keine Requests mehr in flight sind
    if (vadInFlightCountRef.current === 0 && vadPendingResultsRef.current.size === 0) {
      setTentativeText('');
    }
  }, [mode, replaceTextAtEndOrInsertDelta]);

  // VAD Utterance Handler: Reiht Utterance reihenfolgetreu ein, retried bei Fehlern.
  // GARANTIE: Eine Utterance geht NIE verloren – bei permanentem Fehler wird ein
  // sichtbarer Platzhalter eingefügt und der Audio-Blob für manuelle Wiederholung gespeichert.
  const handleVadUtterance = useCallback(async (wavBlob: Blob) => {
    const sessionId = vadSessionIdRef.current;
    // Sequenznummer SOFORT vergeben, damit die Reihenfolge der eingehenden
    // Utterances erhalten bleibt, auch wenn Transkriptionen unterschiedlich lange dauern.
    const seq = vadSeqCounterRef.current++;
    const promptContext = vadPromptContextRef.current;
    const approxDurationSeconds = estimateWavDurationSeconds(wavBlob);

    console.log(`[VAD] Queue utterance #${seq}: ${approxDurationSeconds.toFixed(2)}s, ${wavBlob.size} bytes, promptContext=${promptContext.length} chars`);

    vadInFlightCountRef.current += 1;
    setTranscribing(true);

    let text = '';
    let failed = false;
    try {
      text = await transcribeUtteranceWithRetry(wavBlob, promptContext);
      if (text.trim()) {
        // Wörterbuch-Korrektur auf Rohtranskript anwenden; Steuerbefehle werden
        // erst beim Commit gegen den Gesamtkontext verarbeitet.
        text = applyDictionaryToText(text);
        console.log(`[VAD] Utterance #${seq} OK:`, text.substring(0, 80));
      } else {
        text = UNRECOGNIZED_UTTERANCE_PLACEHOLDER;
        console.warn(`[VAD] Utterance #${seq}: leeres Transkript (${approxDurationSeconds.toFixed(2)}s, ${wavBlob.size} bytes)`);
      }
    } catch (err: any) {
      failed = true;
      console.error(`[VAD] Utterance #${seq} ENDGÜLTIG fehlgeschlagen:`, err?.message || err);
      setError(`⚠ Audio-Abschnitt #${seq + 1} konnte nicht transkribiert werden (${err?.message || 'Fehler'}). Audio bleibt erhalten – bitte wiederholen.`);
    } finally {
      if (sessionId !== vadSessionIdRef.current) {
        console.warn(
          `[VAD] Drop stale utterance #${seq} from session ${sessionId} (current=${vadSessionIdRef.current}, failed=${failed}, text="${getVadLogPreview(text)}")`
        );
        return;
      }

      vadPendingResultsRef.current.set(seq, { text, failed, blob: wavBlob });
      vadInFlightCountRef.current = Math.max(0, vadInFlightCountRef.current - 1);
      drainVadCommitQueue();
      if (vadInFlightCountRef.current === 0 && vadPendingResultsRef.current.size === 0) {
        setTranscribing(false);
      }
    }
  }, [transcribeUtteranceWithRetry, applyDictionaryToText, drainVadCommitQueue, estimateWavDurationSeconds, getVadLogPreview]);

  // VAD Speech Start: Tentative-Anzeige aktivieren
  const handleVadSpeechStart = useCallback(() => {
    setTentativeText('...');
  }, []);

  // VAD Audio Level
  const handleVadAudioLevel = useCallback((level: number) => {
    setAudioLevel(level);
  }, []);

  // VAD Hook instanziieren
  const vad = useVadChunking({
    onUtterance: handleVadUtterance,
    onSpeechStart: handleVadSpeechStart,
    onAudioLevel: handleVadAudioLevel,
  });

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
        setMethodik(combineTextForField('methodik', methodik, parsed.methodik));
      }
      if (parsed.befund !== null) {
        setTranscript(combineTextForField('befund', transcript, parsed.befund));
      }
      if (parsed.beurteilung !== null) {
        setBeurteilung(combineTextForField('beurteilung', beurteilung, parsed.beurteilung));
      }
    } else {
      // Kein Steuerbefehl erkannt - Text geht ins aktive Feld
      switch (activeField) {
        case 'methodik':
          setMethodik(combineTextForField('methodik', methodik, formattedText));
          break;
        case 'beurteilung':
          setBeurteilung(combineTextForField('beurteilung', beurteilung, formattedText));
          break;
        case 'befund':
        default:
          setTranscript(combineTextForField('befund', transcript, formattedText));
          break;
      }
    }
  }, [mode, activeField, parseFieldCommands, combineTextForField, methodik, beurteilung, transcript]);

  // Kontinuierliche Transkription während der Aufnahme
  const processLiveTranscription = useCallback(async () => {
    if (allChunksRef.current.length === 0) return;
    
    setTranscribing(true);
    try {
      const blob = new Blob(allChunksRef.current, { type: 'audio/webm' });
      const currentTranscript = await transcribeChunk(blob, true);
      const previousTranscript = lastTranscriptRef.current;
      const transcriptDelta = getIncrementalTranscript(previousTranscript, currentTranscript);
      
      // Nur aktualisieren wenn sich etwas geändert hat
      if (currentTranscript && currentTranscript !== lastTranscriptRef.current) {
        lastTranscriptRef.current = currentTranscript;

        if (!transcriptDelta.trim()) {
          return;
        }

        queueLiveInject(transcriptDelta);
        
        // HINWEIS: Während der Live-Transkription wird KEINE Formatierung angewendet,
        // um Hin-und-Her-Springen des Textes zu vermeiden (Whisper arbeitet in Chunks
        // und kann sich wiederholen). Die Formatierung wird erst nach Aufnahmeende
        // in stopRecording() angewendet.
        
        if (mode === 'befund') {
          // Im Befund-Modus: Parse Steuerbefehle und verteile auf Felder
          // Hier nur grob nach Feldwechsel-Kommandos schauen, ohne Formatierung
          const parsed = parseFieldCommands(transcriptDelta);
          
          if (parsed.lastField) {
            setActiveField(parsed.lastField);
            
            // Verteile Text auf die entsprechenden Felder
            if (parsed.methodik !== null) {
              lastMethodikRef.current = parsed.methodik;
              setMethodik(combineTextForField('methodik', methodik, parsed.methodik));
            }
            if (parsed.befund !== null) {
              setTranscript(combineTextForField('befund', transcript, parsed.befund));
            }
            if (parsed.beurteilung !== null) {
              lastBeurteilungRef.current = parsed.beurteilung;
              setBeurteilung(combineTextForField('beurteilung', beurteilung, parsed.beurteilung));
            }
          } else {
            // Kein Steuerbefehl - Text geht ins aktive Feld
            switch (activeField) {
              case 'methodik':
                lastMethodikRef.current = transcriptDelta;
                setMethodik(combineTextForField('methodik', methodik, transcriptDelta));
                break;
              case 'beurteilung':
                lastBeurteilungRef.current = transcriptDelta;
                setBeurteilung(combineTextForField('beurteilung', beurteilung, transcriptDelta));
                break;
              case 'befund':
              default:
                setTranscript(combineTextForField('befund', transcript, transcriptDelta));
                break;
            }
          }
        } else {
          // Im Arztbrief-Modus: Normales Verhalten
          const fullText = combineTextForField('transcript', transcript, transcriptDelta);
          setTranscript(fullText);
        }
      }
    } finally {
      setTranscribing(false);
    }
  }, [transcribeChunk, mode, activeField, parseFieldCommands, combineTextForField, methodik, beurteilung, transcript, queueLiveInject]);

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
      Object.values(manualCorrectionTimersRef.current).forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
    };
  }, []);

  // Funktion zum Zurücksetzen aller Felder (New-Button) - hier oben für Hotkey-Unterstützung
  const handleReset = useCallback(() => {
    vadSessionIdRef.current += 1;
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
    // VAD-State zurücksetzen
    setCommittedUtterances([]);
    committedUtterancesRef.current = [];
    setTentativeText('');
    vadPromptContextRef.current = '';
    vadSeqCounterRef.current = 0;
    vadNextCommitSeqRef.current = 0;
    vadInFlightCountRef.current = 0;
    vadPendingResultsRef.current.clear();
    setVadFailedUtterances([]);
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

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [startRecording, stopRecording, handleReset]);

  useEffect(() => {
    const handleHidMediaControl = (event: Event) => {
      const detail = (event as CustomEvent<HidMediaControlEventDetail>).detail;
      if (!detail || detail.phase !== 'keydown' || detail.action !== 'record') {
        return;
      }

      if (recordingRef.current) {
        void stopRecording();
      } else {
        void startRecording();
      }
    };

    window.addEventListener(HID_MEDIA_CONTROL_EVENT, handleHidMediaControl as EventListener);
    return () => window.removeEventListener(HID_MEDIA_CONTROL_EVENT, handleHidMediaControl as EventListener);
  }, [startRecording, stopRecording]);

  // Schnelle LLM-Fachwort-Korrektur
  // Schnelle LLM-Fachwort-Korrektur (mit Halluzinations-Filter auf Server-Seite)
  const quickCorrectWithLLM = useCallback(async (text: string): Promise<string> => {
    try {
      // Fachwörter aus Textbausteinen extrahieren
      const referenceTerms = templates
        .map(t => t.content)
        .join(' ')
        .split(/\s+/)
        .filter(word => word.length > 3)
        .filter((word, index, self) => self.indexOf(word) === index); // Unique
      
      // Wörterbuch-Korrekturen formatieren
      const dictionaryCorrections = dictionaryEntries
        .slice(0, 100) // Max 100 Einträge (reduziert für weniger Halluzinationen)
        .map(entry => ({ wrong: entry.wrong, correct: entry.correct }));
      
      const response = await fetch('/api/quick-correct', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({ 
          text,
          referenceTerms: referenceTerms.slice(0, 100), // Max 100 (reduziert)
          dictionaryCorrections
        })
      });
      
      if (!response.ok) {
        console.warn('[QuickCorrect] API error:', response.status);
        return text;
      }
      
      const data = await response.json();
      
      // Server hat Halluzination gefiltert
      if (data.filtered) {
        console.log('[QuickCorrect] Server filtered hallucination');
        return text;
      }
      
      if (data.changed) {
        console.log('[QuickCorrect] LLM corrected:', text, '→', data.corrected);
      }
      return data.corrected || text;
    } catch (error) {
      console.warn('[QuickCorrect] Error:', error);
      return text;
    }
  }, [templates, dictionaryEntries, getAuthHeader, getDbTokenHeader]);

  // Ref um zu tracken ob der letzte Text mit Punkt endete (für Groß-/Kleinschreibung)
  const fastWhisperEndsWithPeriodRef = useRef<boolean>(true); // Start mit true = erster Buchstabe groß

  // Fast Whisper WebSocket Transkription Handler
  // Diktat-Modus: Kein automatisches Satzende, "Punkt" als Sprachbefehl
  const handleFastWhisperTranscript = useCallback(async (text: string, isFinal: boolean) => {
    if (!text) return;
    
    // Partials ignorieren - nur finale Sätze anzeigen
    if (!isFinal) {
      return;
    }
    
    console.log('[FastWhisper] FINAL:', text);
    
    // Diktat-Logik: Sprachbefehle erkennen und Satzenden verarbeiten
    let processedText = text.trim();
    let endsWithPeriod = false;
    
    // Prüfe ob der Text NUR "Punkt" ist (als separater Sprachbefehl)
    const isOnlyPunkt = /^punkt[.!?]?$/i.test(processedText);
    
    if (isOnlyPunkt) {
      // "Punkt" wurde als eigener Satz diktiert - füge Punkt zum vorherigen Text hinzu
      console.log('[FastWhisper] Separater Punkt-Befehl erkannt');
      
      const getFinalRef = () => {
        if (mode === 'befund') {
          switch (activeField) {
            case 'methodik': return fastWhisperFinalMethodikRef;
            case 'beurteilung': return fastWhisperFinalBeurteilungRef;
            default: return fastWhisperFinalTextRef;
          }
        }
        return fastWhisperFinalTextRef;
      };
      
      const getExistingRef = () => {
        if (mode === 'befund') {
          switch (activeField) {
            case 'methodik': return existingMethodikRef;
            case 'beurteilung': return existingBeurteilungRef;
            default: return existingTextRef;
          }
        }
        return existingTextRef;
      };
      
      const setText = (value: string) => {
        if (mode === 'befund') {
          switch (activeField) {
            case 'methodik': setMethodik(value); break;
            case 'beurteilung': setBeurteilung(value); break;
            default: setTranscript(value); break;
          }
        } else {
          setTranscript(value);
        }
      };
      
      const finalRef = getFinalRef();
      const existingRef = getExistingRef();
      
      // Punkt an den letzten Text anhängen (ohne Leerzeichen)
      if (finalRef.current) {
        finalRef.current = finalRef.current.replace(/\s*$/, '') + '.';
      }
      
      // Nächster Satz beginnt groß
      fastWhisperEndsWithPeriodRef.current = true;
      
      // Anzeige aktualisieren
      const targetField: TextInsertionTarget = mode === 'befund'
        ? (activeField === 'methodik' ? 'methodik' : activeField === 'beurteilung' ? 'beurteilung' : 'befund')
        : 'transcript';
      const fullText = [existingRef.current, finalRef.current].filter(p => p.trim()).join(' ');
      replaceTextAtEndOrInsertDelta(targetField, fullText, '.');
      return; // Fertig, kein weiterer Text zu verarbeiten
    }
    
    // Ersetze "Punkt" überall im Text durch echten Punkt
    // Verschiedene Muster die der Server senden kann:
    // 1. "Text, Punkt, weiter" → ", Punkt," zwischen Kommas
    // 2. "Text Punkt. Weiter" → " Punkt." mit automatischem Punkt
    // 3. "Text Punkt Weiter" → " Punkt " vor Großbuchstabe
    // 4. "Text Punkt" → am Ende
    
    // Ersetze alle Varianten von "Punkt" als Sprachbefehl
    // Pattern: Punkt umgeben von Satzzeichen, Leerzeichen, oder am Ende
    const punktPatterns = [
      // ", Punkt," oder ", Punkt " → "."
      { pattern: /,\s*punkt\s*,?\s*/gi, replacement: '. ' },
      // " Punkt." oder " Punkt. " → "."
      { pattern: /\s+punkt\s*\.\s*/gi, replacement: '. ' },
      // " Punkt " gefolgt von Großbuchstabe → ". "
      { pattern: /\s+punkt\s+(?=[A-ZÄÖÜ])/gi, replacement: '. ' },
      // " Punkt" am Ende → "."
      { pattern: /\s+punkt\s*$/i, replacement: '.' },
    ];
    
    for (const { pattern, replacement } of punktPatterns) {
      if (pattern.test(processedText)) {
        processedText = processedText.replace(pattern, replacement);
        console.log('[FastWhisper] Punkt-Befehl erkannt und ersetzt');
      }
    }
    
    // Bereinige doppelte Leerzeichen und Punkte
    processedText = processedText.replace(/\s+/g, ' ').replace(/\.+/g, '.').trim();
    
    // Prüfe ob "Punkt" explizit diktiert wurde (dann bleibt der Punkt)
    const hadExplicitPunkt = /punkt/i.test(text);
    
    // Entferne automatische Satzzeichen am Ende (wenn KEIN expliziter Punkt-Befehl)
    // Der Server fügt bei Pausen automatisch Punkte ein, die wollen wir nicht
    if (!hadExplicitPunkt) {
      processedText = processedText.replace(/[.!?]+\s*$/, '').trim();
    }
    
    // Prüfe ob der Text mit Punkt endet
    endsWithPeriod = /\.\s*$/.test(processedText);
    
    // Groß-/Kleinschreibung basierend auf vorherigem Satzende
    if (!fastWhisperEndsWithPeriodRef.current && processedText.length > 0) {
      // Vorheriger Text endete ohne Punkt → klein schreiben (außer Eigennamen/Nomen)
      // Wir machen nur den ersten Buchstaben klein, da Nomen im Deutschen groß bleiben sollten
      // Das LLM kann das später korrigieren wenn nötig
      const firstChar = processedText[0];
      // Nur Kleinschreibung wenn es ein typischer Satzanfang ist (Artikel, Pronomen, etc.)
      const lowercaseWords = ['der', 'die', 'das', 'ein', 'eine', 'es', 'er', 'sie', 'wir', 'ich', 'und', 'oder', 'aber', 'sowie', 'als', 'wenn', 'da', 'dort', 'hier', 'nach', 'bei', 'mit', 'ohne', 'für', 'zu', 'im', 'am', 'an', 'auf', 'in'];
      const firstWord = processedText.split(/\s+/)[0].toLowerCase();
      if (lowercaseWords.includes(firstWord)) {
        processedText = firstChar.toLowerCase() + processedText.slice(1);
      }
    }
    
    // Update des Refs für den nächsten Satz
    fastWhisperEndsWithPeriodRef.current = endsWithPeriod;

    // Online-Steuerbefehle auch im WebSocket-Pfad kontextbezogen anwenden.
    processedText = applyOnlineDictationControlWords(processedText);
    
    // Wörterbuch-Ersetzungen anwenden
    let correctedText = applyDictionaryToText(processedText);
    if (correctedText !== processedText) {
      console.log('[FastWhisper] Dictionary corrected:', processedText, '->', correctedText);
    }
    
    // Schnelle LLM-Fachwort-Korrektur (async, nicht blockierend für UX)
    // OHNE Referenz-Begriffe um Halluzinationen zu vermeiden
    const llmCorrectedPromise = quickCorrectWithLLM(correctedText);
    
    // Finaler Satz: Zum akkumulierten Text hinzufügen
    const getFinalRef = () => {
      if (mode === 'befund') {
        switch (activeField) {
          case 'methodik': return fastWhisperFinalMethodikRef;
          case 'beurteilung': return fastWhisperFinalBeurteilungRef;
          default: return fastWhisperFinalTextRef;
        }
      }
      return fastWhisperFinalTextRef;
    };
    
    const getExistingRef = () => {
      if (mode === 'befund') {
        switch (activeField) {
          case 'methodik': return existingMethodikRef;
          case 'beurteilung': return existingBeurteilungRef;
          default: return existingTextRef;
        }
      }
      return existingTextRef;
    };
    
    const finalRef = getFinalRef();
    const existingRef = getExistingRef();
    const previousFinalText = finalRef.current;
    
    // Text akkumulieren und danach Löschbefehle auf den Gesamtkontext anwenden.
    finalRef.current = applyOnlineUtteranceToText(finalRef.current, correctedText);
    
    // Anzeige aktualisieren
    const updateDisplay = () => {
      const targetField: TextInsertionTarget = mode === 'befund'
        ? (activeField === 'methodik' ? 'methodik' : activeField === 'beurteilung' ? 'beurteilung' : 'befund')
        : 'transcript';
      const fullText = [existingRef.current, finalRef.current].filter(p => p.trim()).join(' ');
      const incomingDelta = getIncrementalTranscript(previousFinalText, finalRef.current);
      replaceTextAtEndOrInsertDelta(targetField, fullText, incomingDelta);
    };
    
    updateDisplay();
    
    // LLM-Korrektur im Hintergrund abwarten und dann ersetzen
    const llmCorrected = await llmCorrectedPromise;
    if (llmCorrected !== correctedText) {
      // Ersetze NUR das letzte Vorkommen von correctedText im finalRef
      // (split/join war fehlerhaft wenn correctedText mehrfach vorkommt → Duplikation)
      const current = finalRef.current;
      const lastIdx = current.lastIndexOf(correctedText);
      if (lastIdx !== -1) {
        finalRef.current = current.slice(0, lastIdx) + llmCorrected + current.slice(lastIdx + correctedText.length);
      }
      updateDisplay();
    }
  }, [mode, activeField, applyDictionaryToText, quickCorrectWithLLM, replaceTextAtEndOrInsertDelta]);

  async function startRecording() {
    setError(null);
    recordingStartedAtRef.current = Date.now();
    // Bestehenden Text behalten
    existingTextRef.current = transcript;
    lastTranscriptRef.current = "";
    allChunksRef.current = [];
    
    // Für Befund-Modus: Auch die anderen Felder speichern
    if (mode === 'befund') {
      existingMethodikRef.current = methodik;
      existingBeurteilungRef.current = beurteilung;
      lastMethodikRef.current = "";
      lastBeurteilungRef.current = "";
    }

    // Fast Whisper WebSocket Modus
    if (runtimeConfig?.transcriptionProvider === 'fast_whisper' && runtimeConfig.fastWhisperWsUrl) {
      // Finale Text-Refs zurücksetzen für neue Session
      fastWhisperFinalTextRef.current = "";
      fastWhisperFinalMethodikRef.current = "";
      fastWhisperFinalBeurteilungRef.current = "";
      
      // Stable-Words-Refs zurücksetzen für Wort-für-Wort Anzeige
      fastWhisperStableWordsRef.current = "";
      fastWhisperStableMethodikRef.current = "";
      fastWhisperStableBeurteilungRef.current = "";
      fastWhisperLastPartialRef.current = "";
      fastWhisperPartialCountRef.current = 0;
      
      // Diktat-Modus: Erster Buchstabe groß (wie Satzanfang)
      fastWhisperEndsWithPeriodRef.current = true;
      
      let wsUrl = runtimeConfig.fastWhisperWsUrl;
      
      // HTTPS-Seiten erfordern wss:// (WebSocket Secure)
      // Automatisch konvertieren wenn nötig
      if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
        if (wsUrl.startsWith('ws://')) {
          wsUrl = wsUrl.replace('ws://', 'wss://');
          console.log('[FastWhisper] Converted to secure WebSocket:', wsUrl);
        }
      }
      
      console.log('[FastWhisper] Starting WebSocket recording to', wsUrl);
      
      try {
        // WebSocket verbinden
        const ws = new WebSocket(wsUrl);
        fastWhisperWsRef.current = ws;
        
        ws.onopen = async () => {
          console.log('[FastWhisper] WebSocket connected');
          
          // Initial Prompt aus Wörterbuch senden (Einträge mit useInPrompt=true)
          const promptWords = dictionaryEntries
            .filter(e => e.useInPrompt && e.correct)
            .map(e => e.correct);
          
          if (promptWords.length > 0) {
            const initialPrompt = promptWords.join(', ');
            console.log('[FastWhisper] Sending initial_prompt with', promptWords.length, 'words');
            ws.send(JSON.stringify({ type: 'set_prompt', text: initialPrompt }));
          }
          
          try {
            // Mikrofon-Stream holen
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
              }
            });
            fastWhisperStreamRef.current = stream;
            
            // AudioContext für Resampling und Audio-Level
            const audioContext = new AudioContext({ sampleRate: 16000 });
            fastWhisperAudioContextRef.current = audioContext;
            
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;
            
            // Audio Level Monitor
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const updateLevel = () => {
              if (!analyserRef.current || !fastWhisperWsRef.current) return;
              analyserRef.current.getByteFrequencyData(dataArray);
              const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
              setAudioLevel(Math.min(100, (average / 128) * 100));
              animationFrameRef.current = requestAnimationFrame(updateLevel);
            };
            updateLevel();
            
            // ScriptProcessorNode für Audio-Chunks
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            fastWhisperProcessorRef.current = processor;
            
            processor.onaudioprocess = (e) => {
              if (!fastWhisperWsRef.current || fastWhisperWsRef.current.readyState !== WebSocket.OPEN) return;
              
              const inputData = e.inputBuffer.getChannelData(0);
              
              // Konvertiere Float32Array zu Int16Array für RealtimeSTT
              const int16Data = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              
              // Sende als Binary
              fastWhisperWsRef.current.send(int16Data.buffer);
            };
            
            source.connect(processor);
            processor.connect(audioContext.destination);
            
            setRecording(true);
          } catch (micError: any) {
            console.error('[FastWhisper] Microphone error:', micError);
            setError('Mikrofon-Zugriff fehlgeschlagen: ' + micError.message);
            ws.close();
          }
        };
        
        ws.onmessage = (event) => {
          try {
            // RealtimeSTT sendet verschiedene Formate
            let text: string = '';
            let isFinal: boolean = false;
            
            if (typeof event.data === 'string') {
              if (event.data.startsWith('{')) {
                const data = JSON.parse(event.data);
                text = data.text || data.transcript || '';
                // Verschiedene Flags für "final" je nach Server-Implementierung
                isFinal = data.is_final || data.final || data.type === 'final' || data.message_type === 'FinalTranscript' || false;
              } else {
                // Plain text wird als final behandelt
                text = event.data;
                isFinal = true;
              }
            }
            
            if (text && text.trim()) {
              handleFastWhisperTranscript(text.trim(), isFinal);
            }
          } catch (e) {
            console.warn('[FastWhisper] Parse error:', e);
          }
        };
        
        ws.onerror = (event) => {
          console.error('[FastWhisper] WebSocket error:', event);
          // Bei selbst-signierten Zertifikaten muss das Zertifikat erst im Browser akzeptiert werden
          const serverUrl = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
          setSslCertWarning({ show: true, serverUrl });
          setError(`Verbindung fehlgeschlagen - SSL-Zertifikat muss akzeptiert werden (siehe Hinweis oben)`);
        };
        
        ws.onclose = () => {
          console.log('[FastWhisper] WebSocket closed');
        };
        
      } catch (wsError: any) {
        console.error('[FastWhisper] Connection error:', wsError);
        const serverUrl = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
        setSslCertWarning({ show: true, serverUrl });
        setError('Fast Whisper Verbindung fehlgeschlagen - SSL-Zertifikat prüfen');
      }
      
      return;
    }
    
    // Voxtral Local Realtime WebSocket Modus
    if (
      runtimeConfig?.transcriptionProvider === 'voxtral_local' &&
      runtimeConfig.voxtralLocalOnlineMode !== 'chunk' &&
      runtimeConfig.voxtralLocalWsUrl
    ) {
      // Finale Text-Refs zurücksetzen für neue Session
      fastWhisperFinalTextRef.current = "";
      fastWhisperFinalMethodikRef.current = "";
      fastWhisperFinalBeurteilungRef.current = "";
      
      // Stable-Words-Refs zurücksetzen
      fastWhisperStableWordsRef.current = "";
      fastWhisperStableMethodikRef.current = "";
      fastWhisperStableBeurteilungRef.current = "";
      fastWhisperLastPartialRef.current = "";
      fastWhisperPartialCountRef.current = 0;
      
      // Diktat-Modus: Erster Buchstabe groß
      fastWhisperEndsWithPeriodRef.current = true;
      
      const wsUrl = runtimeConfig.voxtralLocalWsUrl;
      console.log('[Voxtral] Starting Realtime WebSocket recording to', wsUrl);
      
      try {
        const ws = new WebSocket(wsUrl);
        voxtralWsRef.current = ws;
        
        ws.onopen = async () => {
          console.log('[Voxtral] WebSocket connected');
          
          // Session konfigurieren
          const sessionConfig: any = {
            type: 'session.update',
            session: {
              input_audio_format: 'pcm16',
              input_audio_sample_rate: 16000,
            },
          };
          
          // Context Bias aus Wörterbuch (Einträge mit useInPrompt=true)
          const promptWords = dictionaryEntries
            .filter(e => e.useInPrompt && e.correct)
            .map(e => e.correct);
          
          if (promptWords.length > 0) {
            sessionConfig.session.context_bias = promptWords;
            console.log('[Voxtral] Sending context_bias with', promptWords.length, 'words');
          }
          
          ws.send(JSON.stringify(sessionConfig));
          
          try {
            // Mikrofon-Stream holen
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
              }
            });
            voxtralStreamRef.current = stream;
            
            // AudioContext für Resampling und Audio-Level
            const audioContext = new AudioContext({ sampleRate: 16000 });
            voxtralAudioContextRef.current = audioContext;
            
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;
            
            // Audio Level Monitor
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const updateLevel = () => {
              if (!analyserRef.current || !voxtralWsRef.current) return;
              analyserRef.current.getByteFrequencyData(dataArray);
              const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
              setAudioLevel(Math.min(100, (average / 128) * 100));
              animationFrameRef.current = requestAnimationFrame(updateLevel);
            };
            updateLevel();
            
            // ScriptProcessorNode für Audio-Chunks
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            voxtralProcessorRef.current = processor;
            
            processor.onaudioprocess = (e) => {
              if (!voxtralWsRef.current || voxtralWsRef.current.readyState !== WebSocket.OPEN) return;
              
              const inputData = e.inputBuffer.getChannelData(0);
              
              // Konvertiere Float32Array zu Int16Array (PCM16)
              const int16Data = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              
              // Base64-encode für Voxtral Realtime API
              const uint8 = new Uint8Array(int16Data.buffer);
              let binary = '';
              for (let i = 0; i < uint8.length; i++) {
                binary += String.fromCharCode(uint8[i]);
              }
              const base64Audio = btoa(binary);
              
              // Sende als JSON mit input_audio_buffer.append
              voxtralWsRef.current.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: base64Audio,
              }));
            };
            
            source.connect(processor);
            processor.connect(audioContext.destination);
            
            setRecording(true);
          } catch (micError: any) {
            console.error('[Voxtral] Microphone error:', micError);
            setError('Mikrofon-Zugriff fehlgeschlagen: ' + micError.message);
            ws.close();
          }
        };
        
        ws.onmessage = (event) => {
          try {
            if (typeof event.data !== 'string') return;
            const data = JSON.parse(event.data);
            
            if (data.type === 'transcription.delta') {
              // Partielle Transkription
              const text = data.delta?.text || data.text || '';
              if (text.trim()) {
                handleFastWhisperTranscript(text.trim(), false);
              }
            } else if (data.type === 'transcription.done') {
              // Finale Transkription
              const text = data.text || data.result?.text || '';
              if (text.trim()) {
                handleFastWhisperTranscript(text.trim(), true);
              }
            } else if (data.type === 'error') {
              console.error('[Voxtral] Server error:', data.error || data.message);
              setError('Voxtral Fehler: ' + (data.error?.message || data.message || 'Unbekannt'));
            } else if (data.type === 'session.created' || data.type === 'session.updated') {
              console.log('[Voxtral]', data.type);
            }
          } catch (e) {
            console.warn('[Voxtral] Parse error:', e);
          }
        };
        
        ws.onerror = (event) => {
          console.error('[Voxtral] WebSocket error:', event);
          setError('Voxtral Local Verbindung fehlgeschlagen - Server erreichbar?');
        };
        
        ws.onclose = () => {
          console.log('[Voxtral] WebSocket closed');
        };
        
      } catch (wsError: any) {
        console.error('[Voxtral] Connection error:', wsError);
        setError('Voxtral Local Verbindung fehlgeschlagen: ' + wsError.message);
      }
      
      return;
    }
    
    // Standard MediaRecorder Modus (für andere Provider)
    // VAD-Modus: Nutze Silero VAD für Utterance-basiertes Chunking 
    // (statt alle 2s den wachsenden Buffer komplett neu zu transkribieren)
    const useVadMode = runtimeConfig?.transcriptionProvider === 'voxtral_local' 
      || runtimeConfig?.transcriptionProvider === 'whisperx'
      || runtimeConfig?.transcriptionProvider === 'mistral';
    
    if (useVadMode) {
      // VAD-Modus: Kein MediaRecorder, VAD übernimmt Mikrofon und liefert Utterances
      vadSessionIdRef.current += 1;
      // Im Befund-Modus startet der Kontext-Buffer mit dem Inhalt des aktuell
      // aktiven Feldes (methodik / befund / beurteilung), damit Online-Steuerwörter
      // sich auf den richtigen Text beziehen und der Delta-Vergleich pro Utterance
      // gegen das richtige Feld läuft. Das eigentliche Einfügen erfolgt
      // ohnehin an der aktuellen Cursor-Position des aktiven Feldes.
      const startingFieldText = mode === 'befund'
        ? (activeField === 'methodik' ? methodik : activeField === 'beurteilung' ? beurteilung : transcript)
        : transcript;
      const existingVADText = startingFieldText.trim();
      committedUtterancesRef.current = existingVADText ? [existingVADText] : [];
      setCommittedUtterances(existingVADText ? [existingVADText] : []);
      setTentativeText('');
      vadPromptContextRef.current = getVadPromptContext(existingVADText);
      // Sequenz-State für neue Session zurücksetzen (verhindert Verschlucken / falsche Reihenfolge)
      vadSeqCounterRef.current = 0;
      vadNextCommitSeqRef.current = 0;
      vadInFlightCountRef.current = 0;
      vadPendingResultsRef.current.clear();
      setVadFailedUtterances([]);

      try {
        await vad.start();
        setRecording(true);
      } catch (err: any) {
        console.error('[VAD] Start error:', err);
        setError('VAD Mikrofon-Zugriff fehlgeschlagen: ' + err.message);
      }
      return;
    }

    // Fallback: Klassischer MediaRecorder + setInterval (z.B. für ElevenLabs)
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
    // Fast Whisper WebSocket Modus stoppen
    if (runtimeConfig?.transcriptionProvider === 'fast_whisper') {
      console.log('[FastWhisper] Stopping WebSocket recording');
      
      // Stream stoppen
      if (fastWhisperStreamRef.current) {
        fastWhisperStreamRef.current.getTracks().forEach(track => track.stop());
        fastWhisperStreamRef.current = null;
      }
      
      // Processor trennen
      if (fastWhisperProcessorRef.current) {
        fastWhisperProcessorRef.current.disconnect();
        fastWhisperProcessorRef.current = null;
      }
      
      // AudioContext schließen
      if (fastWhisperAudioContextRef.current) {
        fastWhisperAudioContextRef.current.close();
        fastWhisperAudioContextRef.current = null;
      }
      
      // WebSocket schließen
      if (fastWhisperWsRef.current) {
        fastWhisperWsRef.current.close();
        fastWhisperWsRef.current = null;
      }
      
      // Animation Frame stoppen
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      setAudioLevel(0);
      setRecording(false);
      recordingStartedAtRef.current = null;
      
      // Bei Fast Whisper: Direkt Korrektur anbieten (kein finaler Transkriptions-Chunk nötig)
      setPendingCorrection(true);
      return;
    }
    
    // Voxtral Local Realtime WebSocket stoppen
    if (
      runtimeConfig?.transcriptionProvider === 'voxtral_local' &&
      runtimeConfig.voxtralLocalOnlineMode !== 'chunk' &&
      voxtralWsRef.current
    ) {
      console.log('[Voxtral] Stopping Realtime WebSocket recording');
      
      // Signal zum Beenden senden (commit mit final flag)
      if (voxtralWsRef.current.readyState === WebSocket.OPEN) {
        voxtralWsRef.current.send(JSON.stringify({
          type: 'input_audio_buffer.commit',
        }));
      }
      
      // Stream stoppen
      if (voxtralStreamRef.current) {
        voxtralStreamRef.current.getTracks().forEach(track => track.stop());
        voxtralStreamRef.current = null;
      }
      
      // Processor trennen
      if (voxtralProcessorRef.current) {
        voxtralProcessorRef.current.disconnect();
        voxtralProcessorRef.current = null;
      }
      
      // AudioContext schließen
      if (voxtralAudioContextRef.current) {
        voxtralAudioContextRef.current.close();
        voxtralAudioContextRef.current = null;
      }
      
      // WebSocket schließen (kurz warten für letzte Antwort)
      setTimeout(() => {
        if (voxtralWsRef.current) {
          voxtralWsRef.current.close();
          voxtralWsRef.current = null;
        }
      }, 500);
      
      // Animation Frame stoppen
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      setAudioLevel(0);
      setRecording(false);
      recordingStartedAtRef.current = null;
      setPendingCorrection(true);
      return;
    }
    
    // Standard Modus: Stoppe die Intervalle
    // VAD-Modus stoppen (wenn aktiv)
    if (vad.isListening) {
      console.log('[VAD] Stopping VAD recording');
      await vad.stop();
      setAudioLevel(0);
      setRecording(false);
      setTentativeText('');
      recordingStartedAtRef.current = null;
      setPendingCorrection(true);
      return;
    }

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
        const audioDurationSeconds = recordingStartedAtRef.current
          ? Math.max(0, (Date.now() - recordingStartedAtRef.current) / 1000)
          : undefined;
        recordingStartedAtRef.current = null;
        const sessionTranscript = await transcribeChunk(blob, false, audioDurationSeconds);
        if (sessionTranscript) {
          // Formatierung auf den Text anwenden (um Steuerwörter sofort zu ersetzen)
          const formattedTranscript = applyFormattingControlWords(sessionTranscript);
          
          // TEMPLATE-MODUS: Textbaustein mit diktierten Änderungen kombinieren
          if (templateMode && selectedTemplate) {
            await applySelectedTemplate(formattedTranscript);
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
                  currentMethodik = combineTextForField('methodik', existingMethodikRef.current, parsed.methodik);
                }
                if (parsed.befund !== null) {
                  currentBefund = combineTextForField('befund', existingTextRef.current, parsed.befund);
                }
                if (parsed.beurteilung !== null) {
                  currentBeurteilung = combineTextForField('beurteilung', existingBeurteilungRef.current, parsed.beurteilung);
                }
                // Rohe Version
                if (rawParsed.methodik !== null) {
                  rawMethodik = combineTextForField('methodik', existingMethodikRef.current, rawParsed.methodik);
                }
                if (rawParsed.befund !== null) {
                  rawBefund = combineTextForField('befund', existingTextRef.current, rawParsed.befund);
                }
                if (rawParsed.beurteilung !== null) {
                  rawBeurteilung = combineTextForField('beurteilung', existingBeurteilungRef.current, rawParsed.beurteilung);
                }
              } else {
              // Kein Steuerbefehl - Text geht ins aktive Feld
              switch (activeField) {
                case 'methodik':
                  currentMethodik = combineTextForField('methodik', existingMethodikRef.current, formattedTranscript);
                  rawMethodik = combineTextForField('methodik', existingMethodikRef.current, sessionTranscript);
                  break;
                case 'beurteilung':
                  currentBeurteilung = combineTextForField('beurteilung', existingBeurteilungRef.current, formattedTranscript);
                  rawBeurteilung = combineTextForField('beurteilung', existingBeurteilungRef.current, sessionTranscript);
                  break;
                case 'befund':
                default:
                  currentBefund = combineTextForField('befund', existingTextRef.current, formattedTranscript);
                  rawBefund = combineTextForField('befund', existingTextRef.current, sessionTranscript);
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
            const fullText = combineTextForField('transcript', existingTextRef.current, formattedTranscript);
            const rawFullText = combineTextForField('transcript', existingTextRef.current, sessionTranscript);
            
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

  async function handleInjectText(text: string, feedbackKey: string) {
    try {
      const result = await injectToActiveWindow({ text, charDelayMs: 2 });
      if (!result.ok) {
        throw new Error(result.error || 'Text konnte nicht in die Ziel-App eingefügt werden');
      }

      setInjectFeedback(feedbackKey);
      setTimeout(() => setInjectFeedback(null), 2000);

      if (isClipboardFallback(result)) {
        setError('Schreibdienst-Injector nicht erreichbar – Text wurde in die Zwischenablage kopiert. Ziel-App fokussieren und Strg+V drücken.');
      } else {
        setError(null);
      }
    } catch (err: any) {
      setError(err.message || 'Fehler beim Einfügen in die Ziel-App');
    }
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
        <button
          className={`btn text-sm py-2 ${liveInjectEnabled ? 'btn-success' : 'btn-outline'}`}
          onClick={() => setLiveInjectEnabled((enabled) => !enabled)}
          title="Während der Aufnahme neue Wörter direkt in das aktuell aktive Windows-Fenster schreiben"
        >
          {liveInjectEnabled ? '⌨️ Live Ziel-App an' : '⌨️ Live Ziel-App'}
        </button>
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
    <div className="space-y-3 min-h-[calc(100vh-120px)]" onContextMenu={handleContextMenu}>
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
            
            {/* Textbaustein-Auswahl */}
            {availableTemplates.length > 0 && (
              <div className="flex items-center gap-1">
                <select 
                  className={`select text-sm py-1.5 max-w-[10rem] truncate ${templateMode ? 'border-orange-400 ring-1 ring-orange-300' : ''}`}
                  value={selectedTemplate?.id || ''}
                  onChange={(e) => {
                    const id = parseInt(e.target.value);
                    const template = availableTemplates.find(t => t.id === id);
                    setSelectedTemplate(template || null);
                    setTemplateMode(!!template);
                  }}
                  title={mode === 'befund'
                    ? 'Textbaustein für das aktive Feld auswählen - diktieren Sie nur die Änderungen'
                    : 'Textbaustein für den Arztbrief auswählen - diktieren Sie nur die Änderungen'}
                  disabled={loadingTemplates}
                >
                  <option value="">{loadingTemplates ? 'Lade Bausteine...' : '📝 Baustein...'}</option>
                  {availableTemplates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name.length > 20 ? t.name.substring(0, 20) + '…' : t.name}
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

      {/* SSL-Zertifikat Warnung für Fast Whisper */}
      {sslCertWarning?.show && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg p-4 shadow-md">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🔐</span>
            <div className="flex-1">
              <h3 className="font-semibold text-amber-800 dark:text-amber-200 mb-1">
                SSL-Zertifikat muss akzeptiert werden
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
                Der Fast Whisper Server verwendet ein selbst-signiertes Zertifikat. 
                Bevor die Echtzeit-Transkription funktioniert, musst du das Zertifikat im Browser akzeptieren.
              </p>
              <div className="flex items-center gap-3">
                <a
                  href={sslCertWarning.serverUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary text-sm py-1.5 px-4"
                >
                  🔗 Zertifikat akzeptieren
                </a>
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  → Klicke &quot;Erweitert&quot; → &quot;Weiter zu ...&quot; → dann diese Seite neu laden
                </span>
              </div>
              <button 
                onClick={() => setSslCertWarning(null)}
                className="mt-2 text-xs text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200 underline"
              >
                Hinweis ausblenden
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Textbaustein-Hinweis wenn aktiv */}
      {templateMode && selectedTemplate && !recording && (
        <div className="text-sm bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 px-3 py-2 rounded-lg">
          {(() => {
            const hasTemplateChanges = getTextForBefundField(selectedTemplate.field).trim().length > 0;

            return (
              <>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-orange-600 dark:text-orange-400 font-medium">📝 Baustein: {selectedTemplate.name}</span>
              <span className="text-xs px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded">
                {selectedTemplate.field}
              </span>
            </div>
            <button
              onClick={() => { void applySelectedTemplate(); }}
              disabled={correcting || busy}
              className="px-2 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors"
              title={hasTemplateChanges ? 'Diktierte Änderungen in den Textbaustein einarbeiten und übernehmen' : 'Textbaustein ohne Änderungen einfügen'}
            >
              {hasTemplateChanges ? 'Änderungen einfügen' : 'Einfügen'}
            </button>
          </div>
          <p className="text-xs text-orange-700 dark:text-orange-300 line-clamp-2">
            {selectedTemplate.content.substring(0, 150)}...
          </p>
          <p className="text-xs text-orange-600 dark:text-orange-400 mt-1 italic">
            💡 Diktieren Sie nur die Änderungen. {hasTemplateChanges ? 'Mit "Änderungen einfügen" werden diese per LLM in den Baustein eingebaut.' : 'Mit "Einfügen" wird der Baustein unverändert übernommen.'}
          </p>
              </>
            );
          })()}
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
                    <button
                      className="text-xs text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={() => handleInjectText(methodik, 'methodik')}
                      disabled={!methodik}
                      title="In Ziel-App einfügen"
                    >
                      {injectFeedback === 'methodik' ? '✓' : '⌨️'}
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
                <div className="relative">
                  <textarea
                    ref={methodikTextareaRef}
                    className={`textarea font-mono text-sm min-h-20 ${activeField === 'methodik' && recording ? 'ring-2 ring-green-500' : ''} ${isProcessing ? 'opacity-60 cursor-not-allowed' : ''}`}
                    value={methodik}
                    onChange={(e) => handleManualTextChange('methodik', e.target.value, setMethodik, e.currentTarget)}
                    onFocus={(e) => { setActiveField('methodik'); setFocusedTextField('methodik'); syncTextSelection('methodik', e.currentTarget); }}
                    onBlur={() => setFocusedTextField((current) => current === 'methodik' ? null : current)}
                    onSelect={(e) => syncTextSelection('methodik', e.currentTarget)}
                    onClick={(e) => syncTextSelection('methodik', e.currentTarget)}
                    onKeyUp={(e) => syncTextSelection('methodik', e.currentTarget)}
                    onMouseUp={(e) => syncTextSelection('methodik', e.currentTarget)}
                    placeholder="Methodik..."
                    rows={2}
                    readOnly={isProcessing}
                  />
                  {showPersistentCaret && focusedTextField !== 'methodik' && caretOverlays.methodik.visible && (
                    <div
                      className="pointer-events-none absolute w-0.5 rounded-full bg-blue-500/80"
                      style={{
                        top: caretOverlays.methodik.top,
                        left: caretOverlays.methodik.left,
                        height: caretOverlays.methodik.height,
                      }}
                    />
                  )}
                </div>
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
                    <button
                      className="text-xs text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={() => handleInjectText(transcript, 'befund')}
                      disabled={!transcript}
                      title="In Ziel-App einfügen"
                    >
                      {injectFeedback === 'befund' ? '✓' : '⌨️'}
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
                <div className="relative">
                  <textarea
                    ref={befundTextareaRef}
                    className={`textarea font-mono text-sm min-h-32 ${activeField === 'befund' && recording ? 'ring-2 ring-green-500' : ''} ${isProcessing ? 'opacity-60 cursor-not-allowed' : ''}`}
                    value={transcript}
                    onChange={(e) => handleManualTextChange('befund', e.target.value, setTranscript, e.currentTarget)}
                    onFocus={(e) => { setActiveField('befund'); setFocusedTextField('befund'); syncTextSelection('befund', e.currentTarget); }}
                    onBlur={() => setFocusedTextField((current) => current === 'befund' ? null : current)}
                    onSelect={(e) => syncTextSelection('befund', e.currentTarget)}
                    onClick={(e) => syncTextSelection('befund', e.currentTarget)}
                    onKeyUp={(e) => syncTextSelection('befund', e.currentTarget)}
                    onMouseUp={(e) => syncTextSelection('befund', e.currentTarget)}
                    placeholder="Befund..."
                    readOnly={isProcessing}
                  />
                  {showPersistentCaret && focusedTextField !== 'befund' && caretOverlays.befund.visible && (
                    <div
                      className="pointer-events-none absolute w-0.5 rounded-full bg-blue-500/80"
                      style={{
                        top: caretOverlays.befund.top,
                        left: caretOverlays.befund.left,
                        height: caretOverlays.befund.height,
                      }}
                    />
                  )}
                </div>
                {/* VAD Tentative Text: Zeigt an, dass gerade gesprochen wird */}
                {recording && vad.isListening && tentativeText && (
                  <div className="px-2 py-1 text-sm italic text-gray-400 dark:text-gray-500 border-l-2 border-green-400 bg-green-50/50 dark:bg-green-900/20 rounded-r">
                    {vad.isSpeaking ? '🎙️ Sprache erkannt...' : '⏳ Transkribiere...'}
                  </div>
                )}
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
                    <button
                      className="text-xs text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={() => handleInjectText(beurteilung, 'beurteilung')}
                      disabled={!beurteilung}
                      title="In Ziel-App einfügen"
                    >
                      {injectFeedback === 'beurteilung' ? '✓' : '⌨️'}
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
                <div className="relative">
                  <textarea
                    ref={beurteilungTextareaRef}
                    className={`textarea font-mono text-sm min-h-20 ${activeField === 'beurteilung' && recording ? 'ring-2 ring-green-500' : ''} ${isProcessing ? 'opacity-60 cursor-not-allowed' : ''}`}
                    value={beurteilung}
                    onChange={(e) => handleManualTextChange('beurteilung', e.target.value, setBeurteilung, e.currentTarget)}
                    onFocus={(e) => { setActiveField('beurteilung'); setFocusedTextField('beurteilung'); syncTextSelection('beurteilung', e.currentTarget); }}
                    onBlur={() => setFocusedTextField((current) => current === 'beurteilung' ? null : current)}
                    onSelect={(e) => syncTextSelection('beurteilung', e.currentTarget)}
                    onClick={(e) => syncTextSelection('beurteilung', e.currentTarget)}
                    onKeyUp={(e) => syncTextSelection('beurteilung', e.currentTarget)}
                    onMouseUp={(e) => syncTextSelection('beurteilung', e.currentTarget)}
                    placeholder="Zusammenfassung..."
                    rows={2}
                    readOnly={isProcessing}
                  />
                  {showPersistentCaret && focusedTextField !== 'beurteilung' && caretOverlays.beurteilung.visible && (
                    <div
                      className="pointer-events-none absolute w-0.5 rounded-full bg-blue-500/80"
                      style={{
                        top: caretOverlays.beurteilung.top,
                        left: caretOverlays.beurteilung.left,
                        height: caretOverlays.beurteilung.height,
                      }}
                    />
                  )}
                </div>
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
                <button
                  className="text-xs text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                  onClick={() => handleInjectText(transcript, 'transcript')}
                  disabled={!transcript}
                  title="In Ziel-App einfügen"
                >
                  {injectFeedback === 'transcript' ? '✓' : '⌨️'}
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
                <div className="relative">
                  <textarea
                    ref={transcriptTextareaRef}
                    className={`textarea font-mono text-sm min-h-40 w-full ${isProcessing ? 'opacity-60 cursor-not-allowed' : ''}`}
                    value={transcript}
                    onChange={(e) => handleManualTextChange('transcript', e.target.value, setTranscript, e.currentTarget)}
                    onFocus={(e) => { setFocusedTextField('transcript'); syncTextSelection('transcript', e.currentTarget); }}
                    onBlur={() => setFocusedTextField((current) => current === 'transcript' ? null : current)}
                    onSelect={(e) => syncTextSelection('transcript', e.currentTarget)}
                    onClick={(e) => syncTextSelection('transcript', e.currentTarget)}
                    onKeyUp={(e) => syncTextSelection('transcript', e.currentTarget)}
                    onMouseUp={(e) => syncTextSelection('transcript', e.currentTarget)}
                    placeholder="Text erscheint hier..."
                    readOnly={isProcessing}
                  />
                  {showPersistentCaret && focusedTextField !== 'transcript' && caretOverlays.transcript.visible && (
                    <div
                      className="pointer-events-none absolute w-0.5 rounded-full bg-blue-500/80"
                      style={{
                        top: caretOverlays.transcript.top,
                        left: caretOverlays.transcript.left,
                        height: caretOverlays.transcript.height,
                      }}
                    />
                  )}
                </div>
                {/* VAD Tentative Text: Zeigt an, dass gerade gesprochen wird */}
                {recording && vad.isListening && tentativeText && (
                  <div className="px-2 py-1 text-sm italic text-gray-400 dark:text-gray-500 border-l-2 border-green-400 bg-green-50/50 dark:bg-green-900/20 rounded-r mt-1">
                    {vad.isSpeaking ? '🎙️ Sprache erkannt...' : '⏳ Transkribiere...'}
                  </div>
                )}
                <div className="mt-2">
                  <button className="btn btn-outline text-sm py-2 w-full" onClick={handleExportDocx} disabled={!transcript}>.docx</button>
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
