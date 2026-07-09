"use client";
import { useEffect, useRef, useState, useCallback, type SetStateAction } from 'react';
import { diffWordsWithSpace } from 'diff';
import { Tabs } from '@/components/Tabs';
import { exportDocx } from '@/lib/formatMedical';
import Spinner from '@/components/Spinner';
import { useAuth } from '@/components/AuthProvider';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';
import { ChangeIndicator, ChangeWarningBanner } from '@/components/ChangeIndicator';
import { applyDeleteCommands, applyFormattingControlWords, applyAbbreviations, applyOnlineDictationControlWords, applyOnlineUtteranceToText, combineFormattedText, fixConcatenatedPunkt, preprocessTranscription, type OnlineUtteranceApplicationDebugStep } from '@/lib/textFormatting';
import { buildPhoneticIndex, applyPhoneticCorrections, applyPhoneticCorrectionsDetailed, areWordsPhoneticallySimilar, type PhoneticReplacementOperation } from '@/lib/phoneticMatch';
import { mergeWithStandardDictionary } from '@/lib/standardDictionary';
import CustomActionButtons from '@/components/CustomActionButtons';
import CustomActionsManager from '@/components/CustomActionsManager';
import ManualCorrectionSuggestion from '@/components/ManualCorrectionSuggestion';
import DiffHighlight, { DiffStats } from '@/components/DiffHighlight';
import HelpPanel from '@/components/HelpPanel';
import WordActionPopup, { type WordCorrectionInfo } from '@/components/WordActionPopup';
import UpdatePanel from '@/components/UpdatePanel';
import InjectorDownloadDialog from '@/components/InjectorDownloadDialog';
import RichTextDictationEditor, { getRichTextSelection } from '@/components/RichTextDictationEditor';
import TemplateRichTextEditor from '@/components/TemplateRichTextEditor';
import { parseSpeaKINGXml, readFileAsText, SpeaKINGMetadata } from '@/lib/audio';
import TemplatesManager from '@/components/TemplatesManager';
import BausteinPalette from '@/components/BausteinPalette';
import MultiBlockEditor from '@/components/MultiBlockEditor';
import BracketHighlight from '@/components/BracketHighlight';
import { createPortal } from 'react-dom';
import { HID_MEDIA_CONTROL_EVENT, type HidMediaControlEventDetail } from '@/lib/hidMediaControls';
import { useVadChunking } from '@/lib/useVadChunking';
import { checkInjectorAvailability, injectToActiveWindow, registerGlobalHotkeys, reportInjectorRecordingState, configureTargetWindow, setFrontendMode } from '@/lib/injectClient';
import { replaceAllInText } from '@/lib/replaceText';
import { useMicrophone } from '@/lib/MicrophoneContext';
import { normalizeRichTextRanges, remapRichTextRanges, buildRichTextHtml, type RichTextFormatRange } from '@/lib/richTextFormatting';
import {
  initializeBlocksFromText,
  createBausteinBlock,
  type EditorBlocksByField,
} from '@/lib/editorBlocks';

const DICTIONARY_CHANGED_EVENT = 'schreibdienst:dictionary-changed';
const UNRECOGNIZED_UTTERANCE_PLACEHOLDER = '[nicht verstanden]';
const LIVE_EDITOR_WIDTH_STORAGE_KEY = 'schreibdienst:live-editor-width';
const LIVE_EDITOR_WIDTH_CHANGED_EVENT = 'schreibdienst:live-editor-width-changed';
type GlobalHotkeyAction = 'toggle-recording' | 'stop-recording' | 'transfer-text' | 'cancel-recording';
type LiveEditorWidth = 'small' | 'a4' | 'full';

// Hilfsfunktion zum Kopieren in die Zwischenablage
async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

async function copyRichTextToClipboard(text: string, html: string): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    await copyToClipboard(text);
    return;
  }

  // Vollständiges HTML-Dokument, damit Word/Outlook etc. Absätze,
  // Tabs und Formatierungen korrekt übernehmen.
  const fullHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body><div style="white-space:pre-wrap">${html}</div></body></html>`;

  const item = new ClipboardItem({
    'text/plain': new Blob([text], { type: 'text/plain' }),
    'text/html': new Blob([fullHtml], { type: 'text/html' }),
  });
  await navigator.clipboard.write([item]);
}

function printRichText(text: string, html: string, title: string): void {
  if (!text) return;
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    @page { margin: 2cm; size: A4; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.5; color: #000; max-width: 16cm; margin: 0 auto; padding: 0; white-space: pre-wrap; }
    u { text-decoration: underline; }
  </style>
</head>
<body>${html}</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
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
  formatRanges?: RichTextFormatRange[];
}

interface PendingTemplateInsertChoice {
  template: Template;
}

// Runtime Config Interface
interface RuntimeConfig {
  transcriptionProvider: 'whisperx' | 'elevenlabs' | 'mistral' | 'fast_whisper' | 'voxtral_local';
  fastWhisperWsUrl?: string;
  voxtralLocalWsUrl?: string;
  voxtralLocalOnlineMode?: 'websocket' | 'chunk';
}

type TextInsertionTarget = 'transcript' | BefundField;
type DictionarySet = 'alltag' | 'medical';
type TextStateKey = 'transcript' | 'methodik' | 'beurteilung';

interface ManualWordChange {
  originalWord: string;
  newWord: string;
}

interface CaretSelection {
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
}

type RichTextFormatKey = 'bold' | 'italic' | 'underline';

type RichTextState = Record<TextStateKey, RichTextFormatRange[]>;

type RichTextToggleState = Record<TextStateKey, Record<RichTextFormatKey, boolean>>;

type AdminConsoleEntrySource = 'keyboard' | 'injector-hotkey' | 'hid' | 'pipeline';

interface AdminConsoleEntry {
  id: number;
  timestamp: string;
  source: AdminConsoleEntrySource;
  message: string;
  details: string;
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
  insertedStart: number;
  insertedEnd: number;
}

type VoiceFormattingState = Record<RichTextFormatKey, boolean>;

interface VoiceFormattingParseResult {
  text: string;
  ranges: RichTextFormatRange[];
  nextState: VoiceFormattingState;
  consumedCommand: boolean;
}

interface TextHistorySnapshot {
  transcript: string;
  methodik: string;
  beurteilung: string;
  richTextFormats: RichTextState;
}

const LIVE_EDITOR_WIDTH_OPTIONS: Array<{ value: LiveEditorWidth; label: string }> = [
  { value: 'small', label: 'Schmal' },
  { value: 'a4', label: 'A4' },
  { value: 'full', label: 'Breit' },
];

const EMPTY_MANUAL_WORD_CHANGES: Record<TextInsertionTarget, ManualWordChange | null> = {
  transcript: null,
  methodik: null,
  befund: null,
  beurteilung: null,
};

const TEXT_HISTORY_LIMIT = 50;
const ADMIN_CONSOLE_LIMIT = 200;

const KEYBOARD_HOTKEY_ACTIONS: Partial<Record<string, GlobalHotkeyAction>> = {
  F9: 'toggle-recording',
  F10: 'stop-recording',
  F11: 'transfer-text',
  Escape: 'cancel-recording',
};

const EMPTY_RICH_TEXT_RANGES: RichTextState = {
  transcript: [],
  methodik: [],
  beurteilung: [],
};

const EMPTY_RICH_TEXT_TOGGLES: RichTextToggleState = {
  transcript: { bold: false, italic: false, underline: false },
  methodik: { bold: false, italic: false, underline: false },
  beurteilung: { bold: false, italic: false, underline: false },
};

const EMPTY_VOICE_FORMATTING_STATE: VoiceFormattingState = {
  bold: false,
  italic: false,
  underline: false,
};

function extractSuggestionTokens(text: string): string[] {
  return text.match(/[A-Za-zÄÖÜäöüß0-9]+(?:[-'][A-Za-zÄÖÜäöüß0-9]+)*/g) || [];
}

function fieldToStateKey(field: TextInsertionTarget): TextStateKey {
  if (field === 'methodik') return 'methodik';
  if (field === 'beurteilung') return 'beurteilung';
  return 'transcript';
}

/** Prüft, ob der Text Online-Steuerbefehle enthält, die einen Löschvorgang auslösen. */
function hasOnlineCommand(text: string): boolean {
  if (!text) return false;
  return /lösche\s+(?:das\s+)?letzte(?:s)?\s+wort|letztes\s+wort\s+löschen|wort\s+löschen|wort\s*streichen|streiche\s+wort|lösche\s+(?:den\s+)?letzten\s+satz|letzten\s+satz\s+löschen|satz\s+löschen|lösche\s+(?:den\s+)?letzten\s+absatz|letzten\s+absatz\s+löschen/i.test(text);
}

function extractLastManualWordChange(previousText: string, nextText: string): ManualWordChange | null {
  if (!previousText || !nextText || previousText === nextText) return null;

  const parts = diffWordsWithSpace(previousText, nextText);
  let lastRemovedWord: string | null = null;
  let lastAddedWord: string | null = null;

  for (const part of parts) {
    const tokens = extractSuggestionTokens(part.value || '');
    if (tokens.length === 0) continue;

    if (part.removed) {
      lastRemovedWord = tokens[tokens.length - 1];
      continue;
    }

    if (part.added) {
      lastAddedWord = tokens[tokens.length - 1];
    }
  }

  if (!lastRemovedWord || !lastAddedWord) return null;
  if (lastRemovedWord.toLowerCase() === lastAddedWord.toLowerCase()) return null;

  // Phonetisches Gate: Nur Vorschläge, wenn die Wörter phonetisch ähnlich sind.
  // Verhindert sinnfreie Einträge wie das Matching eines gelöschten Wortes
  // mit dem unveränderten Vorwort.
  if (!areWordsPhoneticallySimilar(lastRemovedWord, lastAddedWord)) return null;

  return {
    originalWord: lastRemovedWord,
    newWord: lastAddedWord,
  };
}

function areTextHistorySnapshotsEqual(a: TextHistorySnapshot, b: TextHistorySnapshot): boolean {
  return (
    a.transcript === b.transcript
    && a.methodik === b.methodik
    && a.beurteilung === b.beurteilung
    && JSON.stringify(a.richTextFormats) === JSON.stringify(b.richTextFormats)
  );
}

function cloneRichTextState(state: RichTextState): RichTextState {
  return {
    transcript: [...state.transcript],
    methodik: [...state.methodik],
    beurteilung: [...state.beurteilung],
  };
}

function createTextHistorySnapshot(
  transcript: string,
  methodik: string,
  beurteilung: string,
  richTextFormats: RichTextState,
): TextHistorySnapshot {
  return {
    transcript,
    methodik,
    beurteilung,
    richTextFormats: cloneRichTextState(richTextFormats),
  };
}

function getDefaultSelection(text: string): CaretSelection {
  return {
    start: text.length,
    end: text.length,
    direction: 'none',
  };
}

function normalizeChunkLeadingWhitespace(text: string): string {
  return text.replace(/^[^\S\n]+/, '');
}

function trimHorizontalWhitespace(text: string): string {
  return text
    .replace(/^[^\S\n]+/, '')
    .replace(/[^\S\n]+$/, '');
}

function formatHotkeyActionLabel(action: GlobalHotkeyAction): string {
  switch (action) {
    case 'toggle-recording':
      return 'Aufnahme umschalten';
    case 'stop-recording':
      return 'Aufnahme stoppen';
    case 'transfer-text':
      return 'Text übertragen';
    case 'cancel-recording':
      return 'Aufnahme abbrechen';
  }
}

function formatAdminConsoleTimestamp(): string {
  return new Date().toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatHidConsoleDetails(detail: HidMediaControlEventDetail): string {
  const parts = [
    `Quelle: ${detail.source}`,
    `Phase: ${detail.phase}`,
    `Aktion: ${detail.action}`,
  ];

  if (detail.key) {
    parts.push(`Key: ${detail.key}`);
  }

  if (detail.code) {
    parts.push(`Code: ${detail.code}`);
  }

  if (detail.hidUsage) {
    parts.push(`Usage: ${detail.hidUsage}`);
  }

  if (detail.deviceName) {
    parts.push(`Gerät: ${detail.deviceName}`);
  }

  return parts.join(' | ');
}

function isEditableKeyboardTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const closestEditable = target.closest('input, textarea, [contenteditable="true"], [role="textbox"]');
  return closestEditable instanceof HTMLElement;
}

function formatKeyboardKeyLabel(key: string): string {
  if (key === ' ') {
    return 'Space';
  }

  return key;
}

function formatKeyboardConsoleDetails(event: KeyboardEvent): string {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const targetLabel = target?.getAttribute('aria-label')
    || target?.getAttribute('placeholder')
    || target?.getAttribute('role')
    || target?.tagName.toLowerCase()
    || 'unbekannt';

  const parts = [
    `Key: ${formatKeyboardKeyLabel(event.key)}`,
    `Code: ${event.code}`,
    `Ziel: ${targetLabel}`,
  ];

  if (event.repeat) {
    parts.push('Repeat: ja');
  }

  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    const modifiers = [
      event.ctrlKey ? 'Ctrl' : null,
      event.metaKey ? 'Meta' : null,
      event.altKey ? 'Alt' : null,
      event.shiftKey ? 'Shift' : null,
    ].filter(Boolean).join('+');
    parts.push(`Modifier: ${modifiers}`);
  }

  return parts.join(' | ');
}

const LIVE_INJECT_DUPLICATE_WINDOW_MS = 3000;

function insertTextAtSelection(existing: string, incomingText: string, selection?: CaretSelection | null): TextInsertionResult {
  // Führende horizontale Leerzeichen entfernen, aber Zeilenumbrüche bewahren
  const normalizedIncomingText = incomingText.replace(/^[^\S\n]+/, '');
  const baseSelection = selection ?? getDefaultSelection(existing);
  const start = Math.max(0, Math.min(baseSelection.start, existing.length));
  const end = Math.max(start, Math.min(baseSelection.end, existing.length));

  if (!normalizedIncomingText) {
    return {
      text: existing,
      selection: baseSelection,
      insertedStart: start,
      insertedEnd: end,
    };
  }

  const before = existing.slice(0, start);
  const after = existing.slice(end);
  const needsPrefixSeparator = before.length > 0
    && !before.endsWith('\n')
    && !before.endsWith(' ')
    && !normalizedIncomingText.startsWith('\n');
  const prefix = needsPrefixSeparator ? ' ' : '';
  const inserted = `${before}${prefix}${normalizedIncomingText}`;
  const insertedStart = before.length + prefix.length;
  const insertedEnd = insertedStart + normalizedIncomingText.length;
  const caretIndex = inserted.length;

  if (!after) {
    return {
      text: inserted,
      selection: {
        start: caretIndex,
        end: caretIndex,
        direction: 'none',
      },
      insertedStart,
      insertedEnd,
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
    insertedStart,
    insertedEnd,
  };
}

function cloneVoiceFormattingState(state: VoiceFormattingState): VoiceFormattingState {
  return {
    bold: Boolean(state.bold),
    italic: Boolean(state.italic),
    underline: Boolean(state.underline),
  };
}

function areVoiceFormattingStatesEqual(left: VoiceFormattingState, right: VoiceFormattingState): boolean {
  return left.bold === right.bold && left.italic === right.italic && left.underline === right.underline;
}

function normalizeVoiceFormattingCommand(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,;:!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectSelectionFormattingCommand(text: string): RichTextFormatKey | null {
  const normalized = normalizeVoiceFormattingCommand(text);

  if (/^auswahl\s*fett$/.test(normalized)) return 'bold';
  if (/^auswahl\s*kursiv$/.test(normalized)) return 'italic';
  if (/^auswahl\s*unterstrichen$/.test(normalized)) return 'underline';
  return null;
}

function detectRelativeFormattingCommand(text: string): { key: RichTextFormatKey; target: 'word' | 'sentence' } | null {
  const normalized = normalizeVoiceFormattingCommand(text);
  if (!normalized) {
    return null;
  }

  // Match patterns like "wortfett", "wort fett", "letztes wort kursiv", "satzunterstrichen", etc.
  // Allows optional whitespace between target word and format command for ASR concatenation errors.
  const match = normalized.match(/^(wort|letztes wort|satz|letzter satz)\s*(fett|kursiv|unterstrichen|unterstreichen)$/);
  if (!match) {
    return null;
  }

  const targetWord = match[1];
  const formatType = match[2];

  let key: RichTextFormatKey;
  if (formatType === 'fett') key = 'bold';
  else if (formatType === 'kursiv') key = 'italic';
  else key = 'underline';

  const target: 'word' | 'sentence' =
    (targetWord === 'wort' || targetWord === 'letztes wort') ? 'word' : 'sentence';

  return { key, target };
}

function getLastWordSelection(text: string): { start: number; end: number } | null {
  const wordPattern = /[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;
  const matches = Array.from(text.matchAll(wordPattern));
  const lastMatch = matches.at(-1);
  if (!lastMatch || lastMatch.index === undefined) {
    return null;
  }

  return {
    start: lastMatch.index,
    end: lastMatch.index + lastMatch[0].length,
  };
}

function getLastSentenceSelection(text: string): { start: number; end: number } | null {
  const trimmedText = text.replace(/\s+$/u, '');
  if (!trimmedText) {
    return null;
  }

  const trimmedEnd = trimmedText.length;
  let start = 0;
  for (let index = trimmedEnd - 1; index >= 0; index -= 1) {
    if (/[.!?]/.test(trimmedText[index])) {
      start = index + 1;
      break;
    }
  }

  while (start < trimmedEnd && /\s/u.test(trimmedText[start])) {
    start += 1;
  }

  if (start >= trimmedEnd) {
    return null;
  }

  return { start, end: trimmedEnd };
}

function detectInlineFormattingToggleCommand(text: string): { key: RichTextFormatKey; enabled: boolean } | null {
  const normalized = normalizeVoiceFormattingCommand(text);
  if (!normalized) {
    return null;
  }

  // Match concatenated (e.g. "fettbeginnen") or spaced (e.g. "fett beginnen") forms
  const match = normalized.match(/^(fett|kursiv|unterstrichen|unterstreichen)\s*(beginn|beginnen|beginnt|anfang|start|ende|beenden|beendet|stop|stopp)$/);
  if (!match) {
    return null;
  }

  const formatType = match[1];
  const action = match[2];

  let key: RichTextFormatKey;
  if (formatType === 'fett') key = 'bold';
  else if (formatType === 'kursiv') key = 'italic';
  else key = 'underline';

  const isBegin = ['beginn', 'beginnen', 'beginnt', 'anfang', 'start'].includes(action);
  const isEnd = ['ende', 'beenden', 'beendet', 'stop', 'stopp'].includes(action);

  if (isBegin === isEnd) {
    return null;
  }

  return { key, enabled: isBegin };
}

function normalizeInlineFormattingSpacing(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[^\S\n]+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?!\s|$)/g, '$1 ')
    .replace(/^[^\S\n]+/, '')
    .replace(/[^\S\n]+$/, '');
}

function parseInlineFormattingText(text: string, initialState: VoiceFormattingState): VoiceFormattingParseResult {
  const commandPattern = /\b(fett|kursiv|unterstrichen|unterstreichen)\s*(beginn|beginnen|beginnt|anfang|start|ende|beenden|beendet|stop|stopp)\b[.,;:!?]*/gi;
  const nextState = cloneVoiceFormattingState(initialState);
  const ranges: RichTextFormatRange[] = [];
  const outputParts: string[] = [];
  let outputLength = 0;
  let consumedCommand = false;
  let lastIndex = 0;

  const appendChunk = (rawChunk: string) => {
    if (!rawChunk) {
      return;
    }

    const chunk = outputParts.length === 0 ? rawChunk.replace(/^[^\S\n]+/, '') : rawChunk;
    if (!chunk) {
      return;
    }

    const start = outputLength;
    outputParts.push(chunk);
    outputLength += chunk.length;

    if (nextState.bold || nextState.italic || nextState.underline) {
      ranges.push({
        start,
        end: outputLength,
        bold: nextState.bold,
        italic: nextState.italic,
        underline: nextState.underline,
      });
    }
  };

  for (const match of text.matchAll(commandPattern)) {
    const matchIndex = match.index ?? 0;
    appendChunk(text.slice(lastIndex, matchIndex));

    const toggleCommand = detectInlineFormattingToggleCommand(`${match[1] ?? ''} ${match[2] ?? ''}`.trim());
    if (toggleCommand) {
      nextState[toggleCommand.key] = toggleCommand.enabled;
      consumedCommand = true;
    }

    lastIndex = matchIndex + match[0].length;
  }

  appendChunk(text.slice(lastIndex));

  const normalizedText = normalizeInlineFormattingSpacing(outputParts.join(''));
  return {
    text: normalizedText,
    ranges: normalizeRichTextRanges(ranges, normalizedText.length),
    nextState,
    consumedCommand,
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
      if (currentText.length > previousText.length) {
        let prefixLength = 0;
        const maxPrefixLength = Math.min(previousText.length, currentText.length);
        while (prefixLength < maxPrefixLength && previousText[prefixLength] === currentText[prefixLength]) {
          prefixLength += 1;
        }

        const structuralDelta = currentText.slice(prefixLength);
        if (structuralDelta && !/[\p{L}\p{N}]/u.test(structuralDelta)) {
          return structuralDelta;
        }
      }

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

function isUnstableLiveInjectText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return !/\n/.test(text);
  }
  if (trimmed.includes(UNRECOGNIZED_UTTERANCE_PLACEHOLDER)) return true;
  if (/(?:…\s*){2,}|\.{3,}|(?:\.\s*){3,}/u.test(trimmed)) return true;
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return !/^[.,;:!?)]$/u.test(trimmed);
  if (/([\p{L}])\1{3,}/iu.test(trimmed.normalize('NFC'))) return true;
  return false;
}

function hiddenCaretOverlay(): CaretOverlayPosition {
  return { top: 0, left: 0, height: 0, visible: false };
}

function getSelectionBounds(selection: CaretSelection | null | undefined): { start: number; end: number } {
  if (!selection) {
    return { start: 0, end: 0 };
  }

  return {
    start: Math.min(selection.start, selection.end),
    end: Math.max(selection.start, selection.end),
  };
}

function isFormatEnabledAt(ranges: RichTextFormatRange[], offset: number, key: RichTextFormatKey): boolean {
  return ranges.some((range) => range.start <= offset && range.end > offset && Boolean(range[key]));
}

function isFormatActiveAcrossSelection(
  ranges: RichTextFormatRange[],
  start: number,
  end: number,
  key: RichTextFormatKey,
): boolean {
  if (end <= start) {
    return false;
  }

  const breakpoints = new Set<number>([start, end]);
  for (const range of ranges) {
    if (range.end <= start || range.start >= end) continue;
    breakpoints.add(Math.max(start, range.start));
    breakpoints.add(Math.min(end, range.end));
  }

  const sortedBreakpoints = Array.from(breakpoints).sort((left, right) => left - right);
  for (let index = 0; index < sortedBreakpoints.length - 1; index += 1) {
    const segmentStart = sortedBreakpoints[index];
    const segmentEnd = sortedBreakpoints[index + 1];
    if (segmentEnd <= segmentStart) continue;
    if (!isFormatEnabledAt(ranges, segmentStart, key)) {
      return false;
    }
  }

  return true;
}

function setFormatForSelection(
  ranges: RichTextFormatRange[],
  textLength: number,
  start: number,
  end: number,
  key: RichTextFormatKey,
  enabled: boolean,
): RichTextFormatRange[] {
  const normalizedStart = Math.max(0, Math.min(start, textLength));
  const normalizedEnd = Math.max(normalizedStart, Math.min(end, textLength));
  if (normalizedEnd <= normalizedStart) {
    return normalizeRichTextRanges(ranges, textLength);
  }

  const normalizedRanges = normalizeRichTextRanges(ranges, textLength);
  const breakpoints = new Set<number>([0, textLength, normalizedStart, normalizedEnd]);

  for (const range of normalizedRanges) {
    breakpoints.add(range.start);
    breakpoints.add(range.end);
  }

  const sortedBreakpoints = Array.from(breakpoints).sort((left, right) => left - right);
  const nextRanges: RichTextFormatRange[] = [];

  for (let index = 0; index < sortedBreakpoints.length - 1; index += 1) {
    const segmentStart = sortedBreakpoints[index];
    const segmentEnd = sortedBreakpoints[index + 1];
    if (segmentEnd <= segmentStart) continue;

    const segment: RichTextFormatRange = {
      start: segmentStart,
      end: segmentEnd,
      bold: isFormatEnabledAt(normalizedRanges, segmentStart, 'bold'),
      italic: isFormatEnabledAt(normalizedRanges, segmentStart, 'italic'),
      underline: isFormatEnabledAt(normalizedRanges, segmentStart, 'underline'),
    };

    if (segmentEnd > normalizedStart && segmentStart < normalizedEnd) {
      segment[key] = enabled;
    }

    nextRanges.push(segment);
  }

  return normalizeRichTextRanges(nextRanges, textLength);
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
  const { username, isAdmin, autoCorrect, defaultMode, getAuthHeader, getDbTokenHeader } = useAuth();
  const { getStream: getMicStream } = useMicrophone();
  const [recording, setRecording] = useState(false);
  const [idleAnimFrame, setIdleAnimFrame] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [dictionarySet, setDictionarySet] = useState<DictionarySet>('medical');
  // Nutzer-einstellbare Abkürzungen (re./li./mg etc.) – aus DB geladen
  const [disabledAbbreviationIds, setDisabledAbbreviationIds] = useState<Set<string>>(new Set());
  const disabledAbbreviationIdsRef = useRef(disabledAbbreviationIds);
  disabledAbbreviationIdsRef.current = disabledAbbreviationIds;
  // Flag um zu tracken ob nach Aufnahme noch keine Korrektur durchgeführt wurde
  const [pendingCorrection, setPendingCorrection] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const allChunksRef = useRef<BlobPart[]>([]);
  const transcriptionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const manualCorrectionTimersRef = useRef<Partial<Record<TextInsertionTarget, ReturnType<typeof setTimeout>>>>({});
  const machineBaselineRef = useRef<Record<TextStateKey, string>>({ transcript: '', methodik: '', beurteilung: '' });
  const pendingManualStateRef = useRef<Record<TextStateKey, boolean>>({ transcript: false, methodik: false, beurteilung: false });
  const manualSuggestDebounceRef = useRef<Partial<Record<TextInsertionTarget, ReturnType<typeof setTimeout>>>>({});
  
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
  
  // Raumgeräusch-Schwelle für VAD (0.30 = empfindlich, 0.75 = nur laute Stimme)
  const [roomNoiseThreshold, setRoomNoiseThreshold] = useState(0.42);
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
  
  const [transcript, setTranscriptState] = useState("");
  const methodikTextareaRef = useRef<HTMLDivElement | null>(null);
  const befundTextareaRef = useRef<HTMLDivElement | null>(null);
  const beurteilungTextareaRef = useRef<HTMLDivElement | null>(null);
  const transcriptTextareaRef = useRef<HTMLDivElement | null>(null);
  const [textSelections, setTextSelections] = useState<Partial<Record<TextInsertionTarget, CaretSelection>>>({});
  const textSelectionsRef = useRef<Partial<Record<TextInsertionTarget, CaretSelection>>>({});
  const [richTextFormats, setRichTextFormats] = useState<RichTextState>(EMPTY_RICH_TEXT_RANGES);
  const [richTextToggles, setRichTextToggles] = useState<RichTextToggleState>(EMPTY_RICH_TEXT_TOGGLES);
  const richTextTogglesRef = useRef<RichTextToggleState>(EMPTY_RICH_TEXT_TOGGLES);
  richTextTogglesRef.current = richTextToggles;
  const textValueRefs = useRef<Record<TextStateKey, string>>({ transcript: '', methodik: '', beurteilung: '' });
  const skipAutoRichTextSyncRef = useRef<Partial<Record<TextStateKey, boolean>>>({});
  const [focusedTextField, setFocusedTextField] = useState<TextInsertionTarget | null>(null);
  const [caretOverlays, setCaretOverlays] = useState<Record<TextInsertionTarget, CaretOverlayPosition>>({
    transcript: hiddenCaretOverlay(),
    methodik: hiddenCaretOverlay(),
    befund: hiddenCaretOverlay(),
    beurteilung: hiddenCaretOverlay(),
  });
  const [mode, setMode] = useState<'arztbrief' | 'befund'>('befund');
  const IDLE_BASE = '၊،၊،၊،၊၊၊၊၊၊';
  const REC_BASE = '၊||၊|။|||||။|';
  const IDLE_ANIM_FRAMES = Array.from({ length: 13 }, (_, i) =>
    '•' + IDLE_BASE.slice(0, 12 - i) + '|' + IDLE_BASE.slice(12 - i) + '•'
  );
  const REC_DOUBLED = REC_BASE + REC_BASE;
  const REC_ANIM_FRAMES = Array.from({ length: 13 }, (_, i) =>
    '•' + REC_DOUBLED.substring(i, i + 13) + '•'
  );
  const [recordingAnimFrame, setRecordingAnimFrame] = useState(0);

  const [liveEditorWidth, setLiveEditorWidth] = useState<LiveEditorWidth>('small');
  const modeRef = useRef<'arztbrief' | 'befund'>('befund');
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveInjectEnabled, setLiveInjectEnabled] = useState(false);
  const [liveInjectStatus, setLiveInjectStatus] = useState<string | null>(null);
  const liveInjectEnabledRef = useRef(false);
  const liveInjectQueueRef = useRef<Promise<void>>(Promise.resolve());
  const liveInjectFailureCountRef = useRef(0);
  const lastLiveInjectQueuedRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const [injectorCheckInProgress, setInjectorCheckInProgress] = useState(false);
  const [targetWindowPattern, setTargetWindowPattern] = useState<string>('');
  const targetWindowPatternLoadedRef = useRef(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [adminConsoleOpen, setAdminConsoleOpen] = useState(false);
  const [adminConsoleEntries, setAdminConsoleEntries] = useState<AdminConsoleEntry[]>([]);
  const adminConsoleEntryIdRef = useRef(0);
  const [adminConsoleTab, setAdminConsoleTab] = useState<'pipeline' | 'prompt-logs'>('pipeline');
  const [llmPromptLogs, setLlmPromptLogs] = useState<any[]>([]);
  const [llmPromptLogsLoading, setLlmPromptLogsLoading] = useState(false);
  const [expandedPromptLogIds, setExpandedPromptLogIds] = useState<Set<number>>(new Set());
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const [methodik, setMethodikState] = useState("");
  const [beurteilung, setBeurteilungState] = useState("");

  // EditorBlock-Modell: parallele Abstraktion über die Feld-States.
  // Wird schrittweise die direkte Nutzung von transcript/methodik/beurteilung ersetzen.
  const [editorBlocksByField, setEditorBlocksByField] = useState<EditorBlocksByField>(() =>
    initializeBlocksFromText(
      { methodik: '', befund: '', beurteilung: '' },
      { methodik: [], befund: [], beurteilung: [] },
    ),
  );
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [showMultiBausteinMode, setShowMultiBausteinMode] = useState(false);
  const templateSelectRef = useRef<HTMLSelectElement | null>(null);

  // Aktuelles aktives Feld für Befund-Modus
  const [activeField, setActiveField] = useState<BefundField>('befund');
  // Spiegel von activeField als Ref, damit asynchrone VAD-Commits (Voxtral online)
  // den aktuell aktiven Feld-Wert sehen, ohne dass der useCallback-Closure neu
  // erzeugt werden muss.
  const activeFieldRef = useRef<BefundField>('befund');
  useEffect(() => { activeFieldRef.current = activeField; }, [activeField]);
  useEffect(() => { textValueRefs.current.transcript = transcript; }, [transcript]);
  useEffect(() => { textValueRefs.current.methodik = methodik; }, [methodik]);
  useEffect(() => { textValueRefs.current.beurteilung = beurteilung; }, [beurteilung]);

  // Sync: EditorBlock-Modell bei Änderung der Feld-States aktuell halten.
  // Ändert sich der Text eines Feldes, wird der erste Freitext-Block aktualisiert.
  // Existiert noch kein Block für das Feld, wird einer angelegt.
  useEffect(() => {
    setEditorBlocksByField((prev) => {
      const field: BefundField = 'befund';
      const blocks = prev[field];
      if (blocks.length === 1 && blocks[0].type === 'freitext') {
        return { ...prev, [field]: [{ ...blocks[0], currentText: transcript }] };
      }
      return prev;
    });
  }, [transcript]);
  useEffect(() => {
    setEditorBlocksByField((prev) => {
      const field: BefundField = 'methodik';
      const blocks = prev[field];
      if (blocks.length === 1 && blocks[0].type === 'freitext') {
        return { ...prev, [field]: [{ ...blocks[0], currentText: methodik }] };
      }
      return prev;
    });
  }, [methodik]);
  useEffect(() => {
    setEditorBlocksByField((prev) => {
      const field: BefundField = 'beurteilung';
      const blocks = prev[field];
      if (blocks.length === 1 && blocks[0].type === 'freitext') {
        return { ...prev, [field]: [{ ...blocks[0], currentText: beurteilung }] };
      }
      return prev;
    });
  }, [beurteilung]);

  const markRichTextHandledForNextTextChange = useCallback((stateKey: TextStateKey) => {
    skipAutoRichTextSyncRef.current[stateKey] = true;
  }, []);

  const applyTextFieldUpdate = useCallback((
    stateKey: TextStateKey,
    value: SetStateAction<string>,
    setState: (nextValue: string) => void,
  ) => {
    const currentText = textValueRefs.current[stateKey];
    const nextText = typeof value === 'function'
      ? (value as (currentValue: string) => string)(currentText)
      : value;
    const richTextAlreadyHandled = Boolean(skipAutoRichTextSyncRef.current[stateKey]);

    if (nextText === currentText) {
      skipAutoRichTextSyncRef.current[stateKey] = false;
      return;
    }

    if (!richTextAlreadyHandled) {
      setRichTextFormats((current) => ({
        ...current,
        [stateKey]: remapRichTextRanges(currentText, nextText, current[stateKey]),
      }));
    }

    skipAutoRichTextSyncRef.current[stateKey] = false;
    textValueRefs.current[stateKey] = nextText;
    setState(nextText);
  }, []);

  const setTranscript = useCallback((value: SetStateAction<string>) => {
    applyTextFieldUpdate('transcript', value, setTranscriptState);
  }, [applyTextFieldUpdate]);

  const setMethodik = useCallback((value: SetStateAction<string>) => {
    applyTextFieldUpdate('methodik', value, setMethodikState);
  }, [applyTextFieldUpdate]);

  const setBeurteilung = useCallback((value: SetStateAction<string>) => {
    applyTextFieldUpdate('beurteilung', value, setBeurteilungState);
  }, [applyTextFieldUpdate]);
  // Refs für existierenden Text pro Feld
  const existingMethodikRef = useRef<string>("");
  const existingBeurteilungRef = useRef<string>("");
  const lastMethodikRef = useRef<string>("");
  const lastBeurteilungRef = useRef<string>("");
  const textHistoryPastRef = useRef<TextHistorySnapshot[]>([]);
  const textHistoryFutureRef = useRef<TextHistorySnapshot[]>([]);
  const currentTextHistorySnapshotRef = useRef<TextHistorySnapshot>(
    createTextHistorySnapshot('', '', '', EMPTY_RICH_TEXT_RANGES)
  );
  const restoringTextHistoryRef = useRef(false);
  const [textHistoryAvailability, setTextHistoryAvailability] = useState({ canUndo: false, canRedo: false });

  const updateTextHistoryAvailability = useCallback(() => {
    setTextHistoryAvailability({
      canUndo: textHistoryPastRef.current.length > 0,
      canRedo: textHistoryFutureRef.current.length > 0,
    });
  }, []);

  const appendAdminConsoleEntry = useCallback((source: AdminConsoleEntrySource, message: string, details: string) => {
    if (!isAdmin) {
      return;
    }

    const nextEntry: AdminConsoleEntry = {
      id: adminConsoleEntryIdRef.current += 1,
      timestamp: formatAdminConsoleTimestamp(),
      source,
      message,
      details,
    };

    setAdminConsoleEntries((current) => [nextEntry, ...current].slice(0, ADMIN_CONSOLE_LIMIT));
  }, [isAdmin]);

  const applyTextHistorySnapshot = useCallback((snapshot: TextHistorySnapshot) => {
    textValueRefs.current = {
      transcript: snapshot.transcript,
      methodik: snapshot.methodik,
      beurteilung: snapshot.beurteilung,
    };
    setTranscriptState(snapshot.transcript);
    setMethodikState(snapshot.methodik);
    setBeurteilungState(snapshot.beurteilung);
    setRichTextFormats(cloneRichTextState(snapshot.richTextFormats));
  }, []);

  useEffect(() => {
    const nextSnapshot = createTextHistorySnapshot(transcript, methodik, beurteilung, richTextFormats);
    const currentSnapshot = currentTextHistorySnapshotRef.current;

    if (areTextHistorySnapshotsEqual(currentSnapshot, nextSnapshot)) {
      return;
    }

    if (restoringTextHistoryRef.current) {
      currentTextHistorySnapshotRef.current = nextSnapshot;
      restoringTextHistoryRef.current = false;
      updateTextHistoryAvailability();
      return;
    }

    textHistoryPastRef.current = [...textHistoryPastRef.current, currentSnapshot].slice(-TEXT_HISTORY_LIMIT);
    textHistoryFutureRef.current = [];
    currentTextHistorySnapshotRef.current = nextSnapshot;
    updateTextHistoryAvailability();
  }, [beurteilung, methodik, richTextFormats, transcript, updateTextHistoryAvailability]);

  const handleUndoTextHistory = useCallback(() => {
    if (isProcessing) {
      return;
    }

    const previousSnapshot = textHistoryPastRef.current[textHistoryPastRef.current.length - 1];
    if (!previousSnapshot) {
      return;
    }

    textHistoryPastRef.current = textHistoryPastRef.current.slice(0, -1);
    textHistoryFutureRef.current = [...textHistoryFutureRef.current, currentTextHistorySnapshotRef.current].slice(-TEXT_HISTORY_LIMIT);
    restoringTextHistoryRef.current = true;
    applyTextHistorySnapshot(previousSnapshot);
    updateTextHistoryAvailability();
  }, [applyTextHistorySnapshot, isProcessing, updateTextHistoryAvailability]);

  const handleRedoTextHistory = useCallback(() => {
    if (isProcessing) {
      return;
    }

    const nextSnapshot = textHistoryFutureRef.current[textHistoryFutureRef.current.length - 1];
    if (!nextSnapshot) {
      return;
    }

    textHistoryFutureRef.current = textHistoryFutureRef.current.slice(0, -1);
    textHistoryPastRef.current = [...textHistoryPastRef.current, currentTextHistorySnapshotRef.current].slice(-TEXT_HISTORY_LIMIT);
    restoringTextHistoryRef.current = true;
    applyTextHistorySnapshot(nextSnapshot);
    updateTextHistoryAvailability();
  }, [applyTextHistorySnapshot, isProcessing, updateTextHistoryAvailability]);

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
  const [showHelpPanel, setShowHelpPanel] = useState(false);
  const [showUpdatePanel, setShowUpdatePanel] = useState(false);
  // Wird angezeigt, wenn der Injector beim Aktivieren des Live-Inject-Modus
  // nicht erreichbar ist. Bietet den Download des aktuellen Installers an.
  const [showInjectorDownloadDialog, setShowInjectorDownloadDialog] = useState(false);
  const [injectorDownloadError, setInjectorDownloadError] = useState<string | null>(null);
  const [manualCorrectionSuggestions, setManualCorrectionSuggestions] = useState<Record<TextInsertionTarget, ManualWordChange | null>>(EMPTY_MANUAL_WORD_CHANGES);

  // Custom Actions Manager
  const [showCustomActionsManager, setShowCustomActionsManager] = useState(false);

  // Tracking der Wörterbuch-/Phonetik-Korrekturen pro Feld für das Doppelklick-Popup
  const [fieldCorrections, setFieldCorrections] = useState<Record<TextInsertionTarget, WordCorrectionInfo[]>>({
    transcript: [],
    methodik: [],
    befund: [],
    beurteilung: [],
  });
  const [wordPopup, setWordPopup] = useState<{
    word: string;
    position: { x: number; y: number };
    correction: WordCorrectionInfo | null;
    field: TextInsertionTarget;
  } | null>(null);

  const syncSelectionState = useCallback((field: TextInsertionTarget, nextSelection: CaretSelection) => {
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

  const syncTextSelection = useCallback((field: TextInsertionTarget, textarea: HTMLTextAreaElement) => {
    const nextSelection: CaretSelection = {
      start: textarea.selectionStart ?? 0,
      end: textarea.selectionEnd ?? 0,
      direction: textarea.selectionDirection ?? 'none',
    };

    syncSelectionState(field, nextSelection);
  }, [syncSelectionState]);

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

  const getRichTextStateKey = useCallback((field: TextInsertionTarget): TextStateKey => fieldToStateKey(field), []);

  const getFieldRichTextFormats = useCallback((field: TextInsertionTarget) => {
    return richTextFormats[getRichTextStateKey(field)];
  }, [getRichTextStateKey, richTextFormats]);

  const cloneRichTextRanges = useCallback((ranges: RichTextFormatRange[]) => {
    return ranges.map((range) => ({ ...range }));
  }, []);

  const getFieldRichTextToggles = useCallback((field: TextInsertionTarget) => {
    return richTextToggles[getRichTextStateKey(field)];
  }, [getRichTextStateKey, richTextToggles]);

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

  const setFieldTextWithFormats = useCallback((field: TextInsertionTarget, nextText: string, nextFormats: RichTextFormatRange[]) => {
    const stateKey = getRichTextStateKey(field);
    markRichTextHandledForNextTextChange(stateKey);
    setRichTextFormats((current) => ({
      ...current,
      [stateKey]: normalizeRichTextRanges(cloneRichTextRanges(nextFormats), nextText.length),
    }));
    setFieldText(field, nextText);
  }, [cloneRichTextRanges, getRichTextStateKey, markRichTextHandledForNextTextChange, setFieldText]);

  const getFieldTextValue = useCallback((field: TextInsertionTarget): string => {
    switch (field) {
      case 'methodik':
        return methodik;
      case 'beurteilung':
        return beurteilung;
      case 'befund':
      case 'transcript':
      default:
        return transcript;
    }
  }, [beurteilung, methodik, transcript]);

  const combineTextForField = useCallback((field: TextInsertionTarget, existing: string, newText: string) => {
    const stateKey = getRichTextStateKey(field);
    appendAdminConsoleEntry('pipeline', `combineTextForField (${field}) EINGANG`, formatPipelineDetails({ newText, existingLänge: existing.length }));
    const selectionFormattingCommand = detectSelectionFormattingCommand(newText);
    const relativeFormattingCommand = detectRelativeFormattingCommand(newText);

    if (selectionFormattingCommand) {
      const selection = getStoredSelection(field, existing);
      const { start, end } = getSelectionBounds(selection);

      if (end <= start) {
        setError('Bitte zuerst einen Textbereich markieren.');
        return existing;
      }

      setRichTextFormats((current) => ({
        ...current,
        [stateKey]: setFormatForSelection(current[stateKey], existing.length, start, end, selectionFormattingCommand, true),
      }));
      setError(null);
      return existing;
    }

    if (relativeFormattingCommand) {
      const selection = relativeFormattingCommand.target === 'word'
        ? getLastWordSelection(existing)
        : getLastSentenceSelection(existing);

      if (!selection || selection.end <= selection.start) {
        setError(relativeFormattingCommand.target === 'word' ? 'Kein Wort zum Formatieren gefunden.' : 'Kein Satz zum Formatieren gefunden.');
        return existing;
      }

      setRichTextFormats((current) => ({
        ...current,
        [stateKey]: setFormatForSelection(current[stateKey], existing.length, selection.start, selection.end, relativeFormattingCommand.key, true),
      }));
      setStoredSelection(field, { start: selection.end, end: selection.end, direction: 'none' });
      setError(null);
      return existing;
    }

    const currentVoiceFormattingState = richTextTogglesRef.current[stateKey] ?? EMPTY_VOICE_FORMATTING_STATE;
    const parsedFormatting = parseInlineFormattingText(newText, currentVoiceFormattingState);

    if (!areVoiceFormattingStatesEqual(currentVoiceFormattingState, parsedFormatting.nextState)) {
      setRichTextToggles((current) => ({
        ...current,
        [stateKey]: parsedFormatting.nextState,
      }));
    }

    // Bei Löschbefehlen („lösche letztes Wort“) wird applyOnlineUtteranceToText genutzt,
    // das den Befehl korrekt auf den vorhandenen Text anwendet anstatt ihn anzuhängen.
    if (hasOnlineCommand(parsedFormatting.text)) {
      const resultText = applyOnlineUtteranceToText(existing, parsedFormatting.text);
      appendAdminConsoleEntry('pipeline', `combineTextForField (${field}) Löschbefehl`, formatPipelineDetails({ result: resultText, resultLänge: resultText.length }));
      setStoredSelection(field, { start: resultText.length, end: resultText.length, direction: 'none' });
      setRichTextFormats((current) => ({
        ...current,
        [stateKey]: remapRichTextRanges(existing, resultText, current[stateKey]),
      }));
      markRichTextHandledForNextTextChange(stateKey);
      return resultText;
    }

    const selection = getStoredSelection(field, existing);
    const rawResult = insertTextAtSelection(existing, parsedFormatting.text, selection);
    // Sicherstellen, dass nach Doppelpunkten vor Ziffern kein Leerzeichen steht (Uhrzeit-Korrektur)
    const resultText = rawResult.text.replace(/(\d{1,2}):\s+(\d{2})/g, '$1:$2');
    const result = {
      text: resultText,
      selection: rawResult.selection,
      insertedStart: rawResult.insertedStart,
      insertedEnd: rawResult.insertedEnd,
    };
    appendAdminConsoleEntry('pipeline', `combineTextForField (${field}) AUSGANG`, formatPipelineDetails({ resultText: result.text, resultLänge: result.text.length, insertedStart: result.insertedStart, insertedEnd: result.insertedEnd }));
    setStoredSelection(field, result.selection);

    if (parsedFormatting.text) {
      setRichTextFormats((current) => {
        let nextRanges = remapRichTextRanges(existing, result.text, current[stateKey]);
        if (parsedFormatting.ranges.length > 0 && result.insertedEnd > result.insertedStart) {
          nextRanges = normalizeRichTextRanges([
            ...nextRanges,
            ...parsedFormatting.ranges.map((range) => ({
              ...range,
              start: result.insertedStart + range.start,
              end: result.insertedStart + range.end,
            })),
          ], result.text.length);
        }
        return {
          ...current,
          [stateKey]: nextRanges,
        };
      });
      markRichTextHandledForNextTextChange(stateKey);
    } else {
      setRichTextFormats((current) => ({
        ...current,
        [stateKey]: remapRichTextRanges(existing, result.text, current[stateKey]),
      }));
      markRichTextHandledForNextTextChange(stateKey);
    }
    return result.text;
  }, [getRichTextStateKey, getStoredSelection, markRichTextHandledForNextTextChange, setStoredSelection]);

  useEffect(() => {
    liveInjectEnabledRef.current = liveInjectEnabled;
    setLiveInjectStatus(liveInjectEnabled ? 'Bereit – Ziel-App wird automatisch erkannt und wieder in den Vordergrund geholt' : null);
  }, [liveInjectEnabled]);

  // Ziel-Fenster-Pattern aus localStorage laden
  useEffect(() => {
    if (targetWindowPatternLoadedRef.current) return;
    targetWindowPatternLoadedRef.current = true;
    try {
      const saved = localStorage.getItem('schreibdienst:targetWindowPattern');
      if (saved) {
        setTargetWindowPattern(saved);
      }
    } catch {
      // localStorage nicht verfügbar (z. B. SSR)
    }
  }, []);

  // Raumgeräusch-Schwelle aus localStorage laden
  const roomNoiseThresholdLoadedRef = useRef(false);
  useEffect(() => {
    if (roomNoiseThresholdLoadedRef.current) return;
    roomNoiseThresholdLoadedRef.current = true;
    try {
      const saved = localStorage.getItem('schreibdienst:vadThreshold');
      if (saved) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 0.30 && val <= 0.75) {
          setRoomNoiseThreshold(val);
        }
      }
    } catch {
      // localStorage nicht verfügbar (z. B. SSR)
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LIVE_EDITOR_WIDTH_STORAGE_KEY);
      if (saved === 'small' || saved === 'a4' || saved === 'full') {
        setLiveEditorWidth(saved);
      }
    } catch {
      // localStorage nicht verfügbar
    }
  }, []);

  // Ziel-Fenster-Pattern in localStorage speichern und an Injector senden
  useEffect(() => {
    if (!targetWindowPatternLoadedRef.current) return;
    try {
      localStorage.setItem('schreibdienst:targetWindowPattern', targetWindowPattern);
    } catch {
      // localStorage nicht verfügbar
    }

    // An nativen Host senden (fire-and-forget)
    if (targetWindowPattern.trim()) {
      configureTargetWindow({ windowTitle: targetWindowPattern.trim() }).catch(() => {});
    } else {
      configureTargetWindow({ clear: true }).catch(() => {});
    }
  }, [targetWindowPattern]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const handleToggleLiveInject = useCallback(async () => {
    if (liveInjectEnabled) {
      setLiveInjectEnabled(false);
      setLiveInjectStatus(null);
      setFrontendMode('normal').catch(() => {});
      return;
    }

    if (injectorCheckInProgress) {
      return;
    }

    setInjectorCheckInProgress(true);
    try {
      const availability = await checkInjectorAvailability();
      if (!availability.ok) {
        setLiveInjectEnabled(false);
        setLiveInjectStatus(null);
        // Statt eines flüchtigen Toasts den Download-Dialog öffnen, damit
        // der Nutzer den fehlenden Injector direkt installieren kann.
        setInjectorDownloadError(availability.error || 'Schreibdienst-Injector nicht erreichbar');
        setShowInjectorDownloadDialog(true);
        return;
      }

      setLiveInjectEnabled(true);
      // Baustein-Modus deaktivieren, da Direkt-Diktat und Baustein-Modus nicht gleichzeitig funktionieren
      setAutoIntegrateTemplateAudio(false);
      setFrontendMode('target-app').catch(() => {});
    } finally {
      setInjectorCheckInProgress(false);
    }
  }, [injectorCheckInProgress, liveInjectEnabled]);

  const queueLiveInject = useCallback((text: string) => {
    // Injektor-Konvention: Der Chunk wird IMMER ohne führendes Leerzeichen und
    // IMMER mit genau einem abschließenden Leerzeichen gesendet. Dadurch
    // landet der Cursor nach dem Leerzeichen und der naechste Chunk setzt
    // automatisch mit einem Buchstaben/Zahl an, ohne an einem vorherigen
    // Satzzeichen "anzukleben". Das gilt gleichermassen fuer VAD-Pausen-
    // Auto-Chunking wie fuer manuell angehaengte Satzzeichen ("Punkt", "!").
    let normalizedText = text.replace(/^\s+/, '');

    if (!liveInjectEnabledRef.current || !normalizedText.trim()) return;

    // Vorhandene Zeilenumbrueche am Ende erhalten (z. B. "neuer Absatz"),
    // aber alle anderen trailing-Whitespace-Zeichen verwerfen und genau ein
    // Leerzeichen anhaengen.
    const trailingNewlines = normalizedText.match(/\n+$/)?.[0] ?? '';
    const core = trailingNewlines
      ? normalizedText.slice(0, -trailingNewlines.length).replace(/\s+$/, '')
      : normalizedText.replace(/\s+$/, '');
    normalizedText = core + (trailingNewlines || ' ');

    // Doppelte Live-Injections verhindern: derselbe Chunk kann bei
    // Re-Processing (z. B. Wörterbuch-Korrekturen) in kurzer Folge mehrfach
    // auftauchen. Das hier blockiert nur kurzfristige Duplikate.
    // Bewusste Wiederholungen durch den Nutzer bleiben möglich, sobald ein
    // kleiner zeitlicher Abstand dazwischen liegt.
    const now = Date.now();
    if (
      lastLiveInjectQueuedRef.current.text === normalizedText &&
      now - lastLiveInjectQueuedRef.current.at < LIVE_INJECT_DUPLICATE_WINDOW_MS
    ) {
      console.log(`[LiveInject] duplicate chunk suppressed text="${normalizedText.substring(0, 80)}${normalizedText.length > 80 ? '…' : ''}"`);
      return;
    }
    lastLiveInjectQueuedRef.current = { text: normalizedText, at: now };

    console.log(`[LiveInject] queueLiveInject CALL text="${normalizedText.substring(0, 80)}${normalizedText.length > 80 ? '…' : ''}" len=${normalizedText.length}`);

    liveInjectQueueRef.current = liveInjectQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const shouldRestorePreviousWindow = typeof document !== 'undefined' && document.hasFocus();
        setLiveInjectStatus(shouldRestorePreviousWindow ? 'Sende an Ziel-App…' : 'Sende an aktive Ziel-App…');

        const request = {
          text: normalizedText,
          mode: 'clipboard' as const,
          restorePreviousWindow: shouldRestorePreviousWindow,
          delayMs: shouldRestorePreviousWindow ? 35 : 0,
          // Eine kleine Pause zwischen den Unicode-Events gibt langsamen
          // Ziel-Apps (KIS, alte Textverarbeitung) Zeit, jedes Zeichen
          // tatsächlich zu verarbeiten, bevor das nächste im Tastaturpuffer
          // landet. Sonst gehen bei Bursts Zeichen verloren.
          charDelayMs: 2,
          fallbackToClipboard: false,
        };

        let result = await injectToActiveWindow(request);

        // Kurzzeitige Unterbrechungen (z. B. minimierte App / Fokuswechsel)
        // werden mit einem direkten Retry abgefangen.
        if (!result.ok) {
          await new Promise((resolve) => setTimeout(resolve, 220));
          result = await injectToActiveWindow(request);
        }

        if (!result.ok) {
          liveInjectFailureCountRef.current += 1;
          setLiveInjectStatus('Live-Übertragung kurz unterbrochen – warte auf Verbindung…');
          // NICHT deaktivieren: Ziel-App-Modus bleibt aktiv und ist nur per Button ausschaltbar.
          if (liveInjectFailureCountRef.current % 5 === 1) {
            setError(result.error || 'Live-Übertragung derzeit nicht möglich (Modus bleibt aktiv).');
          }
          return;
        }

        liveInjectFailureCountRef.current = 0;
        setLiveInjectStatus(`Gesendet: ${normalizedText.trim().length} Zeichen`);
      });
  }, []);

  const replaceLivePreview = useCallback((field: TextInsertionTarget, text: string) => {
    if (mode === 'befund') {
      switch (field) {
        case 'methodik':
          setMethodik(text);
          setTranscript('');
          setBeurteilung('');
          break;
        case 'beurteilung':
          setMethodik('');
          setTranscript('');
          setBeurteilung(text);
          break;
        case 'befund':
        default:
          setMethodik('');
          setTranscript(text);
          setBeurteilung('');
          break;
      }
      return;
    }

    setTranscript(text);
  }, [mode]);

  const applyLiveChunkPreview = useCallback((field: TextInsertionTarget, text: string) => {
    replaceLivePreview(field, text.trim() ? text : '');
  }, [replaceLivePreview]);

  const replaceTextAtEndOrInsertDelta = useCallback((
    field: TextInsertionTarget,
    fullText: string,
    incomingDelta: string
  ) => {
    const stateKey = getRichTextStateKey(field);

    if (incomingDelta && incomingDelta.trim()) {
      queueLiveInject(incomingDelta);
    }

    appendAdminConsoleEntry('pipeline', `replaceTextAtEndOrInsertDelta (${field})`, formatPipelineDetails({ fullText: fullText.slice(0, 300), delta: incomingDelta, liveInject: liveInjectEnabledRef.current }));

    if (liveInjectEnabledRef.current) {
      applyLiveChunkPreview(field, incomingDelta && incomingDelta.trim() ? incomingDelta : fullText);
      return;
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

      if (fullText !== currentText) {
        appendAdminConsoleEntry('pipeline', `replaceTextAtEndOrInsertDelta (${field}) Vollersetzung`, formatPipelineDetails({ vorher: currentText.slice(0, 300), nachher: fullText.slice(0, 300) }));
        setStoredSelection(field, { start: fullText.length, end: fullText.length, direction: 'none' });
        setRichTextFormats((current) => ({
          ...current,
          [stateKey]: remapRichTextRanges(currentText, fullText, current[stateKey]),
        }));
        markRichTextHandledForNextTextChange(stateKey);
        return fullText;
      }

      return currentText;
    });
  }, [setFieldText, combineTextForField, queueLiveInject, applyLiveChunkPreview, getRichTextStateKey, markRichTextHandledForNextTextChange, setStoredSelection]);

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
      transcript: hiddenCaretOverlay(),
      methodik: hiddenCaretOverlay(),
      befund: hiddenCaretOverlay(),
      beurteilung: hiddenCaretOverlay(),
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
  const [showNewTemplateDialog, setShowNewTemplateDialog] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateContent, setNewTemplateContent] = useState('');
  const [newTemplateFormats, setNewTemplateFormats] = useState<RichTextFormatRange[]>([]);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [templateUnusedText, setTemplateUnusedText] = useState('');
  const [pendingTemplateInsertChoice, setPendingTemplateInsertChoice] = useState<PendingTemplateInsertChoice | null>(null);
  const [activeTemplateContext, setActiveTemplateContext] = useState<Template | null>(null);
  const [autoIntegrateTemplateAudio, setAutoIntegrateTemplateAudio] = useState(false);
  const [templateContradictionMode, setTemplateContradictionMode] = useState<'genau' | 'einfach' | 'aus' | 'optionen'>('genau');
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // Lade disabledAbbreviations aus der DB (für applyAbbreviations)
  useEffect(() => {
    if (!username) return;
    fetch('/api/users/settings', {
      headers: { 'Authorization': getAuthHeader(), ...getDbTokenHeader() },
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.disabledAbbreviations)) {
          setDisabledAbbreviationIds(new Set(data.disabledAbbreviations));
        }
      })
      .catch(() => {});
  }, [username, getAuthHeader, getDbTokenHeader]);
  const [showTemplatesManager, setShowTemplatesManager] = useState(false);
  const [templateManagerMode, setTemplateManagerMode] = useState<'create' | 'manage'>('create');
  // Refs für den VAD-/Online-Diktatpfad: Die VAD-Callbacks werden beim Start der
  // Aufnahme einmal eingefroren, daher muss der aktuelle Baustein-Zustand über Refs
  // gelesen werden, sonst greift der Auto-Einarbeiten-Modus nicht.
  const autoIntegrateTemplateAudioRef = useRef(autoIntegrateTemplateAudio);
  autoIntegrateTemplateAudioRef.current = autoIntegrateTemplateAudio;
  const activeTemplateContextRef = useRef(activeTemplateContext);
  activeTemplateContextRef.current = activeTemplateContext;
  const applyTemplateChangesRef = useRef<((template: Template, changesOverride?: string) => Promise<boolean>) | null>(null);
  // Sammelt im Auto-Einarbeiten-Modus den gesprochenen Text, bis die Aufnahme endet.
  const templateAudioBufferRef = useRef('');
  // Markiert, dass nach dem Leeren der VAD-Commit-Queue in den Baustein eingearbeitet werden soll.
  const pendingTemplateIntegrationRef = useRef(false);
  // Speichert die letzte /api/templates/adapt-Antwort fuer Format-Ranges.
  const adaptDataRef = useRef<Record<string, unknown> | null>(null);
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

  const applyTemplateChanges = useCallback(async (template: Template, changesOverride?: string) => {
    if (!template) {
      return false;
    }

    const changesText = (changesOverride ?? getTextForBefundField(template.field)).trim();
    setError(null);
    setCorrecting(true);

    // Basis für die Anpassung: Im Auto-Einarbeiten-Modus immer der aktuelle Feldinhalt
    // in seinem letzten Zustand, damit bereits eingearbeitete Angaben (und manuelle
    // Bearbeitungen) erhalten bleiben und die neuen Sprachbefehle nur ergänzt werden.
    // Fällt der Feldinhalt weg, dient der ursprüngliche Baustein als Basis.
    const currentFieldText = getTextForBefundField(template.field).trim();
    const baseText = (autoIntegrateTemplateAudioRef.current && currentFieldText)
      ? currentFieldText
      : template.content;

    try {
      let nextText = baseText;

      if (changesText) {
        console.log('[Template] Adapting template:', template.name);
        console.log('[Template] Changes:', changesText);

        const res = await fetch('/api/templates/adapt', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': getAuthHeader(),
            ...getDbTokenHeader(),
          },
          body: JSON.stringify({
            template: baseText,
            changes: changesText,
            field: template.field,
            username,
            contradictionMode: templateContradictionMode,
            formatRanges: template.formatRanges,
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
        adaptDataRef.current = data;
        setTemplateUnusedText((data.unusedText || '').trim());
      } else {
        setTemplateUnusedText('');
      }

      const baseFormats = autoIntegrateTemplateAudioRef.current && currentFieldText
        ? getFieldRichTextFormats(template.field)
        : (template.formatRanges ?? []);
      // Server-seitig berechnete Format-Ranges nutzen, falls vorhanden
      // (die API berechnet sie inkl. Duplikations-Erkennung).
      // Fallback: client-seitiges Standard-Remap.
      const adaptResult = adaptDataRef.current;
      const serverFormats = adaptResult?.formatRanges as RichTextFormatRange[] | undefined;
      const nextFormats = changesText
        ? serverFormats ?? remapRichTextRanges(baseText, nextText, baseFormats)
        : cloneRichTextRanges(baseFormats);

      setFieldTextWithFormats(template.field, nextText, nextFormats);
      setPendingCorrection(false);
      // Den aktiven Baustein-Kontext auf den bereits ausgefüllten Stand aktualisieren,
      // damit weitere Diktat-Runden inkrementell darauf aufbauen statt vorherige
      // Eintragungen zu überschreiben.
      const updatedContext: Template = { ...template, content: nextText, formatRanges: nextFormats };
      activeTemplateContextRef.current = updatedContext;
      setActiveTemplateContext(updatedContext);
      return true;
    } catch (err: any) {
      console.error('[Template] Apply error:', err);
      setError(err.message || 'Fehler bei Template-Anpassung');
      return false;
    } finally {
      setCorrecting(false);
    }
  }, [cloneRichTextRanges, getFieldRichTextFormats, getTextForBefundField, getAuthHeader, getDbTokenHeader, username, methodik, transcript, beurteilung, setFieldTextWithFormats, templateContradictionMode]);
  applyTemplateChangesRef.current = applyTemplateChanges;

  const applySelectedTemplate = useCallback(async (changesOverride?: string) => {
    if (!selectedTemplate) {
      return false;
    }

    try {
      return await applyTemplateChanges(selectedTemplate, changesOverride);
    } finally {
      setSelectedTemplate(null);
      setTemplateMode(false);
    }
  }, [selectedTemplate, applyTemplateChanges]);

  const insertTemplateIntoField = useCallback((template: Template, insertMode: 'append' | 'replace') => {
    const existingText = getTextForBefundField(template.field);
    let nextText = template.content;
    let nextFormats = cloneRichTextRanges(template.formatRanges ?? []);

    if (insertMode === 'append' && existingText.trim()) {
      const separator = existingText.endsWith('\n') ? '\n' : '\n\n';
      nextText = `${existingText}${separator}${template.content}`;
      nextFormats = normalizeRichTextRanges([
        ...cloneRichTextRanges(getFieldRichTextFormats(template.field)),
        ...cloneRichTextRanges(template.formatRanges ?? []).map((range) => ({
          ...range,
          start: range.start + existingText.length + separator.length,
          end: range.end + existingText.length + separator.length,
        })),
      ], nextText.length);
    }

    setFieldTextWithFormats(template.field, nextText, nextFormats);
    setStoredSelection(template.field, getDefaultSelection(nextText));
    setPendingCorrection(false);
    const updatedTemplate: Template = { ...template, content: nextText, formatRanges: nextFormats };
    activeTemplateContextRef.current = updatedTemplate;
    setActiveTemplateContext(updatedTemplate);
    setAutoIntegrateTemplateAudio(true);
    setTemplateUnusedText('');
    setPendingTemplateInsertChoice(null);
    setSelectedTemplate(null);
    setTemplateMode(false);
  }, [cloneRichTextRanges, getFieldRichTextFormats, getTextForBefundField, setFieldTextWithFormats, setStoredSelection]);

  const handleTemplateSelection = useCallback((template: Template | null) => {
    if (!template) {
      setPendingTemplateInsertChoice(null);
      setSelectedTemplate(null);
      setTemplateMode(false);
      return;
    }

    const existingText = getTextForBefundField(template.field);
    if (existingText.trim()) {
      setPendingTemplateInsertChoice({ template });
      setSelectedTemplate(null);
      setTemplateMode(false);
      return;
    }

    insertTemplateIntoField(template, 'replace');
  }, [getTextForBefundField, insertTemplateIntoField]);

  const integrateExistingTextIntoTemplate = useCallback(async (template: Template) => {
    const existingText = getTextForBefundField(template.field).trim();
    setPendingTemplateInsertChoice(null);

    if (!existingText) {
      insertTemplateIntoField(template, 'replace');
      return;
    }

    await applyTemplateChanges(template, existingText);
  }, [applyTemplateChanges, getTextForBefundField, insertTemplateIntoField]);

  /**
   * Im Multi-Baustein-Modus: Hängt einen Template-Baustein als neuen
   * EditorBlock an, statt ihn in das Feld zu mergen.
   * Nur genutzt, wenn showMultiBausteinMode aktiv ist.
   */
  const addBausteinAsNewBlock = useCallback((template: Template) => {
    const field = template.field;
    const newBlock = createBausteinBlock(
      field,
      template.id,
      template.name,
      template.content,
      template.formatRanges ?? [],
    );
    setEditorBlocksByField((prev) => ({
      ...prev,
      [field]: [...prev[field], newBlock],
    }));
    setActiveBlockId(newBlock.id);
  }, []);

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

  const handleCreateNewTemplate = useCallback(async () => {
    if (!newTemplateName.trim() || !newTemplateContent.trim()) return;
    setCreatingTemplate(true);
    try {
      const field = mode === 'befund' ? activeField : 'befund';
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader(),
        },
        body: JSON.stringify({
          name: newTemplateName.trim(),
          content: newTemplateContent.trim(),
          formatRanges: normalizeRichTextRanges(newTemplateFormats, newTemplateContent.trim().length),
          field,
        }),
      });
      const data = await response.json();
      if (data.success) {
        await fetchTemplates();
        setShowNewTemplateDialog(false);
        setNewTemplateName('');
        setNewTemplateContent('');
        setNewTemplateFormats([]);
      } else {
        setError(data.error || 'Fehler beim Anlegen des Bausteins');
      }
    } catch {
      setError('Fehler beim Anlegen des Bausteins');
    } finally {
      setCreatingTemplate(false);
    }
  }, [newTemplateName, newTemplateContent, newTemplateFormats, mode, activeField, getAuthHeader, getDbTokenHeader, fetchTemplates]);

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
  
  // Gemergte Einträge (User + Standard-Wörterbuch) – inkl. Quellinformation
  // (User vs. Standard) für die Doppelklick-Popup-Logik.
  const mergedEntriesRef = useRef<{ wrong: string; correct: string; source: 'standard' | 'private' | 'group' }[]>([]);
  
  // Phonetischen Index neu aufbauen wenn sich Wörterbuch ändert
  useEffect(() => {
    const userCount = dictionaryEntries.length;
    const merged = mergeWithStandardDictionary(dictionaryEntries, standardDictEntries.length > 0 ? standardDictEntries : undefined);
    // Quelle pro Eintrag ableiten: User-Einträge stehen vorne, Standard hinten
    const tagged = merged.map((entry, idx) => ({
      wrong: entry.wrong,
      correct: entry.correct,
      source: (idx < userCount ? 'private' : 'standard') as 'standard' | 'private' | 'group',
    }));
    mergedEntriesRef.current = tagged;
    phoneticIndexRef.current = buildPhoneticIndex(merged);
    console.log('[Phonetic] Index built with', tagged.length, 'entries (', dictionaryEntries.length, 'user +', tagged.length - dictionaryEntries.length, 'standard)');
  }, [dictionaryEntries, standardDictEntries]);

  const applyDictionaryToText = useCallback((text: string): string => {
    if (!text) return text;
    
    // Pass 0: Concatenated "punkt" words reparieren (z.B. "stehenpunkt." → "stehen. ")
    // Läuft VOR den dictionary corrections, damit der abgetrennte Stamm
    // anschließend phonetisch korrigiert werden kann ("Unazit" → "Unazid").
    if (mergedEntriesRef.current.length > 0) {
      const knownCorrectWords = new Set<string>();
      for (const e of mergedEntriesRef.current) {
        knownCorrectWords.add(e.correct.toLowerCase());
      }
      const punktResult = fixConcatenatedPunkt(text, knownCorrectWords);
      text = punktResult.text;
    } else {
      // Auch ohne Wörterbuch: Regel 1 (automatischer Punkt danach) greift
      const punktResult = fixConcatenatedPunkt(text);
      text = punktResult.text;
    }
    
    // Pass 1+2: Exaktes + Phonetisches Matching (User + Standard) –
    // werden NUR im Medical-Modus angewendet, konsistent zur Beschriftung
    // ("Alltag: alle Wörterbücher sind aus").
    if (dictionarySet === 'medical' && mergedEntriesRef.current.length > 0) {
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
      
      text = result;
    }
    
    // Pass 3: Medizinische Abkürzungen/Units (disabledIds via Benutzereinstellungen)
    text = applyAbbreviations(text, disabledAbbreviationIdsRef.current);
    
    return text;
  }, [dictionaryEntries, dictionarySet]);

  const applyDictionaryToTextWithCorrections = useCallback((text: string): { text: string; corrections: WordCorrectionInfo[] } => {
    // Im Alltag-Modus werden keine Wörterbuchkorrekturen angewendet.
    if (!text || dictionarySet !== 'medical' || mergedEntriesRef.current.length === 0) {
      return { text, corrections: [] };
    }

    // Pass 1: Exaktes Wort-Matching (User + Standard) – als Operationen mitschneiden
    let result = text;
    const exactCorrections: WordCorrectionInfo[] = [];
    for (const entry of mergedEntriesRef.current) {
      const escaped = entry.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?<![A-ZÄÖÜa-zäöüß])${escaped}(?![A-ZÄÖÜa-zäöüß])`, 'gi');
      result = result.replace(regex, (matched) => {
        if (matched !== entry.correct) {
          exactCorrections.push({
            originalWord: matched,
            correctedWord: entry.correct,
            dictionaryWrong: entry.wrong,
            dictionaryCorrect: entry.correct,
            source: entry.source,
            matchType: 'exact',
          });
        }
        return entry.correct;
      });
    }

    // Pass 2: Phonetisches Matching – Operationen mitführen
    if (!phoneticIndexRef.current) {
      return { text: result, corrections: exactCorrections };
    }
    const phoneticResult = applyPhoneticCorrectionsDetailed(result, phoneticIndexRef.current);
    const phoneticCorrections: WordCorrectionInfo[] = phoneticResult.operations
      .filter((op) => op.replacementText !== op.originalText)
      .map((op) => ({
        originalWord: op.originalText,
        correctedWord: op.replacementText,
        dictionaryWrong: op.dictionaryWrong,
        dictionaryCorrect: op.dictionaryCorrect,
        source: op.source,
        matchType: 'phonetic',
        confidence: op.confidence,
        targetUsername: op.targetUsername,
        groupId: op.groupId,
      }));
    return { text: phoneticResult.text, corrections: [...exactCorrections, ...phoneticCorrections] };
  }, [dictionaryEntries, dictionarySet]);

  // Leitet bei jeder Text- und Wörterbuchänderung die Korrekturen neu ab
  useEffect(() => {
    const methodikResult = applyDictionaryToTextWithCorrections(methodik);
    const beurteilungResult = applyDictionaryToTextWithCorrections(beurteilung);
    const transcriptResult = applyDictionaryToTextWithCorrections(transcript);
    setFieldCorrections({
      methodik: methodikResult.corrections,
      beurteilung: beurteilungResult.corrections,
      befund: transcriptResult.corrections,
      transcript: transcriptResult.corrections,
    });
  }, [methodik, beurteilung, transcript, dictionaryEntries, applyDictionaryToTextWithCorrections]);

  // Doppelklick auf ein Wort: Popup mit passenden Aktionen öffnen
  const getWordAtCursor = useCallback((textarea: HTMLTextAreaElement): { word: string; start: number; end: number } | null => {
    const text = textarea.value;
    const cursorPos = textarea.selectionStart;
    if (cursorPos === undefined || cursorPos === null) return null;

    // Finde Wortgrenzen rückwärts
    let wordStart = cursorPos;
    while (wordStart > 0 && /[A-Za-zÄÖÜäöüß0-9]/.test(text[wordStart - 1])) {
      wordStart--;
    }
    // Finde Wortgrenzen vorwärts
    let wordEnd = cursorPos;
    while (wordEnd < text.length && /[A-Za-zÄÖÜäöüß0-9]/.test(text[wordEnd])) {
      wordEnd++;
    }

    if (wordStart >= wordEnd) return null;
    const word = text.slice(wordStart, wordEnd);
    if (!word || /[\s]/.test(word)) return null;
    return { word, start: wordStart, end: wordEnd };
  }, []);

  const handleWordDoubleClick = useCallback((
    field: TextInsertionTarget,
    textarea: HTMLTextAreaElement,
    clientX: number,
    clientY: number
  ) => {
    const wordInfo = getWordAtCursor(textarea);
    if (!wordInfo) return;
    const { word } = wordInfo;
    const corrections = fieldCorrections[field] ?? [];
    // Exakte Wort-Übereinstimmung (case-insensitiv) und nicht self-mapping
    const matched = corrections.find(
      (c) => c.correctedWord.localeCompare(word, undefined, { sensitivity: 'accent' }) === 0
        && c.originalWord.localeCompare(c.correctedWord, undefined, { sensitivity: 'accent' }) !== 0
    ) ?? null;

    // Wenn keine aktive Korrektur im Tracking, trotzdem prüfen ob das Wort
    // in mergedEntriesRef vorkommt (z.B. bereits korrigierter Text).
    // Dann zeigen wir ebenfalls die Wörterbuch-Aktionen (löschen/schwächen).
    if (!matched) {
      const dictEntry = mergedEntriesRef.current.find(
        (e) => e.correct.localeCompare(word, undefined, { sensitivity: 'accent' }) === 0
      );
      if (dictEntry) {
        setWordPopup({
          word,
          position: { x: clientX, y: clientY },
          correction: {
            originalWord: dictEntry.wrong,
            correctedWord: dictEntry.correct,
            dictionaryWrong: dictEntry.wrong,
            dictionaryCorrect: dictEntry.correct,
            source: dictEntry.source,
            matchType: 'exact',
          },
          field,
        });
        return;
      }
    }

    setWordPopup({ word, position: { x: clientX, y: clientY }, correction: matched, field });
  }, [fieldCorrections, getWordAtCursor]);

  const closeWordPopup = useCallback(() => {
    setWordPopup(null);
  }, []);

  const invalidateFieldCorrections = useCallback((field: TextInsertionTarget) => {
    setFieldCorrections((prev) => ({ ...prev, [field]: [] }));
  }, []);

  const prepareLiveInjectDelta = useCallback((text: string): string => {
    return normalizeChunkLeadingWhitespace(applyDictionaryToText(applyFormattingControlWords(text)));
  }, [applyDictionaryToText]);

  const queueFinalSessionLiveInject = useCallback((sessionTranscript: string) => {
    if (!sessionTranscript.trim()) return;

    const transcriptDelta = getIncrementalTranscript(lastTranscriptRef.current, sessionTranscript);
    if (!transcriptDelta.trim()) return;

    const preparedDelta = prepareLiveInjectDelta(transcriptDelta);
    if (isUnstableLiveInjectText(preparedDelta)) {
      setLiveInjectStatus('Live-Übertragung wartet auf stabiles Transkript');
      return;
    }

    lastTranscriptRef.current = sessionTranscript;
    queueLiveInject(preparedDelta);
  }, [prepareLiveInjectDelta, queueLiveInject]);

  // Mode vom defaultMode des Benutzers setzen
  useEffect(() => {
    if (defaultMode) {
      setMode(defaultMode);
    }
  }, [defaultMode]);

  // Dictionary-Set: immer mit Medical starten, Umschalten nur session-lokal.
  // Kein Laden aus der DB und kein Persistieren – vermeidet Zustandsverwirrung
  // durch veraltete DB-Werte und Browser-Caches.
  const toggleDictionarySet = useCallback(() => {
    setDictionarySet((prev) => (prev === 'medical' ? 'alltag' : 'medical'));
  }, []);

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

  // Animation der Zeichenfolge – Idle (Mikro aus): großer Strich wandert rechts→links
  // Recording: Schallmuster wandert rechts→links
  useEffect(() => {
    const timer = setInterval(() => {
      if (recording) {
        setRecordingAnimFrame(prev => (prev + 1) % 13);
      } else {
        setIdleAnimFrame(prev => (prev + 1) % 13);
      }
    }, 200);
    return () => clearInterval(timer);
  }, [recording]);

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

  // Helper: ermittelt das Zielfeld für Auto-Replace basierend auf Modus und aktivem Feld
  const resolveFormattingTargetField = useCallback((): TextInsertionTarget => {
    return modeRef.current === 'befund' ? activeFieldRef.current : 'transcript';
  }, []);

  useEffect(() => {
    const handleDictionaryChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ scope?: string; wrong?: string; correct?: string; revertFrom?: string; revertTo?: string }>;
      if (customEvent.detail?.scope === 'private') {
        fetchDictionary();
      }

      if (customEvent.detail?.scope === 'standard') {
        fetchStandardDictionary();
      }

      const wrong = customEvent.detail?.wrong?.trim();
      const correct = customEvent.detail?.correct?.trim();

      const revertFrom = customEvent.detail?.revertFrom?.trim();
      const revertTo = customEvent.detail?.revertTo?.trim();

      if (wrong && correct) {
        const targetField = resolveFormattingTargetField();
        setFieldText(targetField, (currentText) => replaceAllInText(currentText, wrong, correct));
      }

      // Nach Löschen/Abschwächen: korrigiertes Wort durch Original ersetzen
      if (revertFrom && revertTo && revertFrom !== revertTo) {
        const targetField = resolveFormattingTargetField();
        setFieldText(targetField, (currentText) => replaceAllInText(currentText, revertFrom, revertTo));
      }
    };

    window.addEventListener(DICTIONARY_CHANGED_EVENT, handleDictionaryChanged);
    return () => window.removeEventListener(DICTIONARY_CHANGED_EVENT, handleDictionaryChanged);
  }, [fetchDictionary, fetchStandardDictionary, resolveFormattingTargetField, setFieldText]);

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

  // Prompt-Logs aus dem Admin-API abrufen (nur für Admins)
  const fetchLlmPromptLogs = useCallback(async () => {
    if (!isAdmin || !adminConsoleOpen) return;
    setLlmPromptLogsLoading(true);
    try {
      const resp = await fetch('/api/admin/prompt-logs');
      if (resp.ok) {
        const data = await resp.json();
        setLlmPromptLogs(data.entries || []);
      }
    } catch {
      // silent
    } finally {
      setLlmPromptLogsLoading(false);
    }
  }, [isAdmin, adminConsoleOpen]);

  useEffect(() => {
    fetchLlmPromptLogs();
    const interval = setInterval(fetchLlmPromptLogs, 5000);
    return () => clearInterval(interval);
  }, [fetchLlmPromptLogs]);

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
    selection: CaretSelection | null,
    explicitFormats?: RichTextFormatRange[],
  ) => {
    const stateKey = fieldToStateKey(field);
    const previousText = getFieldTextValue(field);
    const previousSelection = getStoredSelection(field, previousText);
    const nextSelection = selection ?? getDefaultSelection(value);
    const replacedLength = Math.max(0, previousSelection.end - previousSelection.start);
    const insertedLength = Math.max(0, value.length - (previousText.length - replacedLength));
    const insertedStart = Math.max(0, Math.min(previousSelection.start, value.length));
    const insertedEnd = Math.max(insertedStart, Math.min(insertedStart + insertedLength, value.length));

    pendingManualStateRef.current[stateKey] = true;
    markRichTextHandledForNextTextChange(stateKey);
    setter(value);
    setPendingCorrection(true);
    syncSelectionState(field, nextSelection);
    const toggleState = richTextTogglesRef.current[stateKey];
    setRichTextFormats((current) => {
      if (explicitFormats) {
        return {
          ...current,
          [stateKey]: normalizeRichTextRanges(explicitFormats, value.length),
        };
      }

      let nextRanges = remapRichTextRanges(previousText, value, current[stateKey]);
      if (insertedEnd > insertedStart) {
        (Object.keys(toggleState) as RichTextFormatKey[]).forEach((key) => {
          if (!toggleState[key]) return;
          nextRanges = setFormatForSelection(nextRanges, value.length, insertedStart, insertedEnd, key, true);
        });
      }

      return {
        ...current,
        [stateKey]: nextRanges,
      };
    });
    logManualCorrection(field);

    const existingDebounce = manualSuggestDebounceRef.current[field];
    if (existingDebounce) clearTimeout(existingDebounce);
    manualSuggestDebounceRef.current[field] = setTimeout(() => {
      const baseline = machineBaselineRef.current[stateKey];
      const detectedChange = extractLastManualWordChange(baseline, value);
      setManualCorrectionSuggestions((current) => ({
        ...current,
        [field]: detectedChange,
      }));
      delete manualSuggestDebounceRef.current[field];
    }, 900);
  }, [getFieldTextValue, getStoredSelection, logManualCorrection, markRichTextHandledForNextTextChange, syncSelectionState]);

  const handleRichTextSelectionChange = useCallback((field: TextInsertionTarget, editor: HTMLDivElement) => {
    const nextSelection = getRichTextSelection(editor) ?? getDefaultSelection(getFieldTextValue(field));
    syncSelectionState(field, nextSelection);
  }, [getFieldTextValue, syncSelectionState]);

  const handleRichTextEditorChange = useCallback((
    field: TextInsertionTarget,
    value: string,
    setter: (nextValue: string) => void,
    editor: HTMLDivElement,
    formats?: RichTextFormatRange[],
  ) => {
    handleManualTextChange(field, value, setter, getRichTextSelection(editor), formats);
  }, [handleManualTextChange]);

  const handleRichTextWordDoubleClick = useCallback((
    field: TextInsertionTarget,
    info: { word: string; start: number; end: number; clientX: number; clientY: number },
  ) => {
    const corrections = fieldCorrections[field] ?? [];
    const matched = corrections.find(
      (correction) => correction.correctedWord.localeCompare(info.word, undefined, { sensitivity: 'accent' }) === 0
        && correction.originalWord.localeCompare(correction.correctedWord, undefined, { sensitivity: 'accent' }) !== 0
    ) ?? null;

    if (!matched) {
      const dictEntry = mergedEntriesRef.current.find(
        (entry) => entry.correct.localeCompare(info.word, undefined, { sensitivity: 'accent' }) === 0
      );
      if (dictEntry) {
        setWordPopup({
          word: info.word,
          position: { x: info.clientX, y: info.clientY },
          correction: {
            originalWord: dictEntry.wrong,
            correctedWord: dictEntry.correct,
            dictionaryWrong: dictEntry.wrong,
            dictionaryCorrect: dictEntry.correct,
            source: dictEntry.source,
            matchType: 'exact',
          },
          field,
        });
        return;
      }
    }

    setWordPopup({
      word: info.word,
      position: { x: info.clientX, y: info.clientY },
      correction: matched,
      field,
    });
  }, [fieldCorrections]);

  const handleRichTextToolbarAction = useCallback((field: TextInsertionTarget, key: RichTextFormatKey) => {
    const text = getFieldTextValue(field);
    // Live-Selection aus dem DOM holen (genauer als gespeicherter State,
    // insbesondere bei Edge Cases wie Selection ab Position 0)
    const editorRefMap: Record<TextInsertionTarget, React.RefObject<HTMLDivElement | null>> = {
      transcript: transcriptTextareaRef,
      methodik: methodikTextareaRef,
      befund: befundTextareaRef,
      beurteilung: beurteilungTextareaRef,
    };
    const liveSelection = editorRefMap[field]?.current ? getRichTextSelection(editorRefMap[field].current) : null;
    const selection = liveSelection ?? getStoredSelection(field, text);
    const { start, end } = getSelectionBounds(selection);
    const stateKey = getRichTextStateKey(field);

    if (end > start) {
      setRichTextFormats((current) => {
        const enabled = !isFormatActiveAcrossSelection(current[stateKey], start, end, key);
        return {
          ...current,
          [stateKey]: setFormatForSelection(current[stateKey], text.length, start, end, key, enabled),
        };
      });
      return;
    }

    setRichTextToggles((current) => ({
      ...current,
      [stateKey]: {
        ...current[stateKey],
        [key]: !current[stateKey][key],
      },
    }));
  }, [getFieldTextValue, getRichTextStateKey, getStoredSelection]);

  const isToolbarButtonActive = useCallback((field: TextInsertionTarget, key: RichTextFormatKey) => {
    const text = getFieldTextValue(field);
    const selection = getStoredSelection(field, text);
    const { start, end } = getSelectionBounds(selection);
    const stateKey = getRichTextStateKey(field);

    if (end > start) {
      return isFormatActiveAcrossSelection(richTextFormats[stateKey], start, end, key);
    }

    return richTextToggles[stateKey][key];
  }, [getFieldTextValue, getRichTextStateKey, getStoredSelection, richTextFormats, richTextToggles]);

  const renderRichTextToolbar = useCallback((field: TextInsertionTarget) => {
    const buttons: Array<{ key: RichTextFormatKey; label: string; className: string }> = [
      { key: 'bold', label: 'B', className: 'font-bold' },
      { key: 'italic', label: 'I', className: 'italic' },
      { key: 'underline', label: 'U', className: 'underline' },
    ];

    return (
      <div className="flex items-center gap-1">
        {buttons.map((button) => {
          const active = isToolbarButtonActive(field, button.key);
          return (
            <button
              key={button.key}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                handleRichTextToolbarAction(field, button.key);
              }}
              className={`inline-flex h-7 w-7 items-center justify-center rounded border text-xs transition ${active
                ? 'border-blue-500 bg-blue-100 text-blue-700 dark:border-blue-400 dark:bg-blue-900/40 dark:text-blue-200'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}`}
              title={button.key === 'bold' ? 'Fett' : button.key === 'italic' ? 'Kursiv' : 'Unterstrichen'}
              aria-pressed={active}
            >
              <span className={button.className}>{button.label}</span>
            </button>
          );
        })}
      </div>
    );
  }, [handleRichTextToolbarAction, isToolbarButtonActive]);

  useEffect(() => {
    const states: Record<TextStateKey, string> = { transcript, methodik, beurteilung };
    (Object.keys(states) as TextStateKey[]).forEach((key) => {
      if (pendingManualStateRef.current[key]) {
        pendingManualStateRef.current[key] = false;
        return;
      }
      machineBaselineRef.current[key] = states[key];
    });
  }, [transcript, methodik, beurteilung]);

  const acknowledgeManualCorrection = useCallback((field: TextInsertionTarget) => {
    const stateKey = fieldToStateKey(field);
    machineBaselineRef.current[stateKey] = getFieldTextValue(field);
    setManualCorrectionSuggestions((current) => ({ ...current, [field]: null }));
  }, [getFieldTextValue]);

  const transcribeChunk = useCallback(async (blob: Blob, isLive: boolean = false, audioDurationSeconds?: number): Promise<string> => {
    try {
      const fd = new FormData();
      fd.append('file', blob, 'audio.webm');
      if (username) {
        fd.append('username', username);
      }
      fd.append('dictionarySet', dictionarySet);
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
  }, [username, dictionarySet]);

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
        fd.append('dictionarySet', dictionarySet);
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
  }, [username, dictionarySet]);

  const estimateWavDurationSeconds = useCallback((blob: Blob): number => {
    const wavHeaderBytes = 44;
    const wavBytesPerSecond = 16000 * 2;
    return Math.max(0, (blob.size - wavHeaderBytes) / wavBytesPerSecond);
  }, []);

  const getVadLogPreview = useCallback((text: string): string => {
    return text.replace(/\s+/g, ' ').trim().slice(0, 120);
  }, []);

  const formatPipelineDetails = useCallback((obj: Record<string, unknown>): string => {
    return Object.entries(obj)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v.slice(0, 200)) : String(v)}`)
      .join(' | ');
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

      // Zusätzliche Text-Vorverarbeitung: Statt applyFormattingControlWords
      // (das auch delete-commands löscht) nutzen wir eine schmale Funktion,
      // die nur Absatz/Zeilen-Steuerwörter vor-übersetzt, damit Befehle wie
      // "Neuer Absatz, ..." am Chunk-Anfang nicht verloren gehen.
      // Delete-Befehle ("lösche das letzte Wort") bleiben intakt und werden
      // später von applyOnlineUtteranceToText korrekt verarbeitet.
      const cmdText = entry.text
        .replace(/[.,;:!?\s]*\bneuer\s+absatz\b[.,;:!?\s]*/gi, '\n\n')
        .replace(/[.,;:!?\s]*\bnächster\s+absatz\b[.,;:!?\s]*/gi, '\n\n')
        .replace(/[.,;:!?\s]*\babsatz\b[.,;:!?\s]*/gi, '\n\n')
        .replace(/[.,;:!?\s]*\bneue\s+zeile\b[.,;:!?\s]*/gi, '\n')
        .replace(/[.,;:!?\s]*\bnächste\s+zeile\b[.,;:!?\s]*/gi, '\n');
      const preprocessedText = cmdText;
      appendAdminConsoleEntry('pipeline', `VAD #${seq}: Rohtext`, formatPipelineDetails({ original: entry.text, preprocessed: preprocessedText }));
      appendAdminConsoleEntry('pipeline', `VAD #${seq}: Eingabe`, formatPipelineDetails({ combinedText: combinedCommittedText }));
      const debugSteps: OnlineUtteranceApplicationDebugStep[] = [];
      const nextCombinedText = applyOnlineUtteranceToText(combinedCommittedText, preprocessedText, step => {
        debugSteps.push(step);
      });
      if (nextCombinedText !== combinedCommittedText) {
        const stepsStr = debugSteps
          .map(step => `${step.kind}:${step.commandType ?? getVadLogPreview(step.input)}:${step.changed ? 'changed' : 'noop'}`)
          .join(', ');
        console.log(`[VAD] Commit utterance #${seq}: text applied (input="${getVadLogPreview(entry.text)}", steps=${stepsStr})`);
        appendAdminConsoleEntry('pipeline', `VAD #${seq}: Text verarbeitet`, formatPipelineDetails({ input: entry.text, nach: getVadLogPreview(nextCombinedText), schritte: stepsStr }));
        combinedCommittedText = nextCombinedText;
        didCommit = true;
      } else {
        const stepsStr = debugSteps
          .map(step => `${step.kind}:${step.commandType ?? getVadLogPreview(step.input)}:${step.changed ? 'changed' : 'noop'}`)
          .join(', ');
        console.warn(`[VAD] Commit utterance #${seq}: no visible text change (input="${getVadLogPreview(entry.text)}", steps=${stepsStr})`);
        appendAdminConsoleEntry('pipeline', `VAD #${seq}: KEINE Änderung`, formatPipelineDetails({ input: entry.text, schritte: stepsStr }));
      }
    }

    if (didCommit) {
      const committed = combinedCommittedText.trim() ? [combinedCommittedText] : [];
      committedUtterancesRef.current = committed;
      setCommittedUtterances(committed);
      // Prompt-Kontext: letzte 2 gelockte Sätze (max. 200 Zeichen)
      const lastTwo = committed.slice(-2).join(' ');
      vadPromptContextRef.current = lastTwo.length > 200 ? lastTwo.slice(-200) : lastTwo;

      if (autoIntegrateTemplateAudioRef.current && activeTemplateContextRef.current) {
        // Auto-Einarbeiten-Modus: Das Feld zeigt weiterhin den unveränderten Baustein.
        // Der gesprochene Text wird nur gesammelt und erst beim Stoppen der Aufnahme
        // über die LLM-Anpassung an die richtige Stelle im Baustein eingearbeitet.
        templateAudioBufferRef.current = committed[0] || '';
      } else {
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
        appendAdminConsoleEntry('pipeline', `VAD → Feld (${targetField})`, formatPipelineDetails({ delta: incomingDelta, fullTextLänge: fullText.length, previousLength: previousCommittedText.length }));
        replaceTextAtEndOrInsertDelta(targetField, fullText, incomingDelta);
      }
    }

    // Tentative nur aktualisieren/löschen, wenn keine Requests mehr in flight sind
    if (vadInFlightCountRef.current === 0 && vadPendingResultsRef.current.size === 0) {
      if (autoIntegrateTemplateAudioRef.current && activeTemplateContextRef.current) {
        // Gesprochenen Text als Vorschau anzeigen, solange noch diktiert wird.
        setTentativeText(templateAudioBufferRef.current);
      } else {
        setTentativeText('');
      }

      // Aufnahme wurde gestoppt und alle Utterances sind verarbeitet:
      // jetzt einmalig den gesammelten Text in den Baustein einarbeiten.
      if (
        pendingTemplateIntegrationRef.current &&
        autoIntegrateTemplateAudioRef.current &&
        activeTemplateContextRef.current &&
        applyTemplateChangesRef.current
      ) {
        pendingTemplateIntegrationRef.current = false;
        const spoken = templateAudioBufferRef.current.trim();
        templateAudioBufferRef.current = '';
        setTentativeText('');
        if (spoken) {
          void applyTemplateChangesRef.current(activeTemplateContextRef.current, spoken);
        }
      }
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
    vadThreshold: roomNoiseThreshold,
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
    const textBeforeFirst = trimHorizontalWhitespace(text.substring(0, matches[0].index));
    
    // Verarbeite jeden Match
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const next = matches[i + 1];
      
      // Text nach diesem Match bis zum nächsten Match (oder Ende)
      const startPos = current.index + current.length;
      const endPos = next ? next.index : text.length;
      const fieldText = trimHorizontalWhitespace(text.substring(startPos, endPos));
      
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
        if (!transcriptDelta.trim()) {
          return;
        }

        const preparedDelta = prepareLiveInjectDelta(transcriptDelta);
        appendAdminConsoleEntry('pipeline', `Live: Roh-Chunk`, formatPipelineDetails({ delta: transcriptDelta, vorbereitet: preparedDelta }));

        if (isUnstableLiveInjectText(preparedDelta)) {
          setLiveInjectStatus('Live-Übertragung wartet auf stabiles Transkript');
          return;
        }

        lastTranscriptRef.current = currentTranscript;

        queueLiveInject(preparedDelta);
        
        // Auto-Einarbeiten-Modus: Während der Aufnahme bleibt der Baustein im Feld
        // unverändert. Der gesprochene Text wird erst beim Stoppen der Aufnahme aus
        // dem vollständigen Transkript an die richtige Stelle eingearbeitet.
        if (autoIntegrateTemplateAudio && activeTemplateContext) {
          return;
        }
        
        // Live-Deltas laufen durch dieselbe Vorverarbeitung wie die Ziel-App-Übertragung:
        // Formatierungswörter, Wörterbuch und phonetische Korrektur.
        if (mode === 'befund') {
          // Im Befund-Modus: Parse Steuerbefehle und verteile auf Felder
          const parsed = parseFieldCommands(preparedDelta);
          appendAdminConsoleEntry('pipeline', `Live: parseFieldCommands`, formatPipelineDetails({ methodik: parsed.methodik, befund: parsed.befund, beurteilung: parsed.beurteilung, lastField: parsed.lastField }));
          
          if (parsed.lastField) {
            setActiveField(parsed.lastField);
            
            // Verteile Text auf die entsprechenden Felder
            if (parsed.methodik !== null) {
              lastMethodikRef.current = parsed.methodik;
              if (liveInjectEnabledRef.current) {
                applyLiveChunkPreview('methodik', parsed.methodik);
              } else {
                appendAdminConsoleEntry('pipeline', 'Live → combineTextForField (methodik)', formatPipelineDetails({ newText: parsed.methodik }));
                setMethodik(combineTextForField('methodik', methodik, parsed.methodik));
              }
            }
            if (parsed.befund !== null) {
              if (liveInjectEnabledRef.current) {
                applyLiveChunkPreview('befund', parsed.befund);
              } else {
                appendAdminConsoleEntry('pipeline', 'Live → combineTextForField (befund)', formatPipelineDetails({ newText: parsed.befund }));
                setTranscript(combineTextForField('befund', transcript, parsed.befund));
              }
            }
            if (parsed.beurteilung !== null) {
              lastBeurteilungRef.current = parsed.beurteilung;
              if (liveInjectEnabledRef.current) {
                applyLiveChunkPreview('beurteilung', parsed.beurteilung);
              } else {
                appendAdminConsoleEntry('pipeline', 'Live → combineTextForField (beurteilung)', formatPipelineDetails({ newText: parsed.beurteilung }));
                setBeurteilung(combineTextForField('beurteilung', beurteilung, parsed.beurteilung));
              }
            }
          } else {
            // Kein Steuerbefehl - Text geht ins aktive Feld
            switch (activeField) {
              case 'methodik':
                lastMethodikRef.current = preparedDelta;
                if (liveInjectEnabledRef.current) {
                  applyLiveChunkPreview('methodik', preparedDelta);
                } else {
                  appendAdminConsoleEntry('pipeline', 'Live → combineTextForField (methodik, kein Feldbefehl)', formatPipelineDetails({ delta: preparedDelta }));
                  setMethodik(combineTextForField('methodik', methodik, preparedDelta));
                }
                break;
              case 'beurteilung':
                lastBeurteilungRef.current = preparedDelta;
                if (liveInjectEnabledRef.current) {
                  applyLiveChunkPreview('beurteilung', preparedDelta);
                } else {
                  appendAdminConsoleEntry('pipeline', 'Live → combineTextForField (beurteilung, kein Feldbefehl)', formatPipelineDetails({ delta: preparedDelta }));
                  setBeurteilung(combineTextForField('beurteilung', beurteilung, preparedDelta));
                }
                break;
              case 'befund':
              default:
                if (liveInjectEnabledRef.current) {
                  applyLiveChunkPreview('befund', preparedDelta);
                } else {
                  appendAdminConsoleEntry('pipeline', 'Live → combineTextForField (befund, kein Feldbefehl)', formatPipelineDetails({ delta: preparedDelta }));
                  setTranscript(combineTextForField('befund', transcript, preparedDelta));
                }
                break;
            }
          }
        } else {
          // Im Arztbrief-Modus: Normales Verhalten
          if (liveInjectEnabledRef.current) {
            applyLiveChunkPreview('transcript', preparedDelta);
          } else {
            appendAdminConsoleEntry('pipeline', 'Live → combineTextForField (arztbrief)', formatPipelineDetails({ delta: preparedDelta }));
            const fullText = combineTextForField('transcript', transcript, preparedDelta);
            setTranscript(fullText);
          }
        }
      }
    } finally {
      setTranscribing(false);
    }
  }, [transcribeChunk, mode, activeField, parseFieldCommands, combineTextForField, methodik, beurteilung, transcript, prepareLiveInjectDelta, queueLiveInject, applyLiveChunkPreview, autoIntegrateTemplateAudio, activeTemplateContext, applyTemplateChanges]);

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
      Object.values(manualSuggestDebounceRef.current).forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
    };
  }, []);

  // Funktion zum Zurücksetzen aller Felder (New-Button) - hier oben für Hotkey-Unterstützung
  const handleReset = useCallback(() => {
    const currentSnapshot = createTextHistorySnapshot(transcript, methodik, beurteilung, richTextFormats);
    const emptySnapshot = createTextHistorySnapshot('', '', '', EMPTY_RICH_TEXT_RANGES);
    const resettingNonEmptyDocument = !areTextHistorySnapshotsEqual(currentSnapshot, emptySnapshot);

    textHistoryPastRef.current = resettingNonEmptyDocument
      ? [...textHistoryPastRef.current, currentSnapshot].slice(-TEXT_HISTORY_LIMIT)
      : textHistoryPastRef.current;
    textHistoryFutureRef.current = [];
    currentTextHistorySnapshotRef.current = resettingNonEmptyDocument ? currentSnapshot : emptySnapshot;
    restoringTextHistoryRef.current = resettingNonEmptyDocument;
    setTextHistoryAvailability({ canUndo: textHistoryPastRef.current.length > 0, canRedo: false });
    Object.values(manualSuggestDebounceRef.current).forEach((timer) => {
      if (timer) clearTimeout(timer);
    });
    manualSuggestDebounceRef.current = {};
    setManualCorrectionSuggestions(EMPTY_MANUAL_WORD_CHANGES);

    vadSessionIdRef.current += 1;
    setTranscript('');
    setMethodik('');
    setBeurteilung('');
    setRichTextFormats(cloneRichTextState(EMPTY_RICH_TEXT_RANGES));
    setRichTextToggles(EMPTY_RICH_TEXT_TOGGLES);
    setActiveField('befund');
    setError(null);
    setPreCorrectionState(null);
    setRawWhisperState(null);
    setCanRevert(false);
    setPendingCorrection(false);
    setActiveTemplateContext(null);
    setAutoIntegrateTemplateAudio(false);
    setTemplateUnusedText('');
    setPendingTemplateInsertChoice(null);
    templateAudioBufferRef.current = '';
    pendingTemplateIntegrationRef.current = false;
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
  }, [beurteilung, methodik, richTextFormats, transcript]);

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
  // - F11: Aktuellen Editor-Text an die fokussierte Ziel-App uebertragen
  // - Escape: Online-Modul auf Neu setzen
  const recordingRef = useRef(recording);
  const injectorRecordingStateRef = useRef<boolean | null>(null);

  const isFrontendVisibleForInjector = useCallback(() => {
    if (typeof document === 'undefined') {
      return true;
    }

    return !document.hidden;
  }, []);

  recordingRef.current = recording;
  const startRecordingHotkeyRef = useRef(startRecording);
  const stopRecordingHotkeyRef = useRef(stopRecording);
  const resetHotkeyRef = useRef(handleReset);
  const hotkeyTransferTextRef = useRef('');
  const transferTextHotkeyRef = useRef<() => void>(() => undefined);
  startRecordingHotkeyRef.current = startRecording;
  stopRecordingHotkeyRef.current = stopRecording;
  resetHotkeyRef.current = handleReset;
  hotkeyTransferTextRef.current = mode === 'befund'
    ? [
        methodik ? `Methodik:\n${methodik}` : '',
        transcript ? `Befund:\n${transcript}` : '',
        beurteilung ? `Beurteilung:\n${beurteilung}` : '',
      ].filter(Boolean).join('\n\n')
    : transcript;

  transferTextHotkeyRef.current = () => {
    if (liveInjectEnabledRef.current) {
      setError('F11 ist im Live-Ziel-App-Modus deaktiviert.');
      return;
    }

    const textToTransfer = hotkeyTransferTextRef.current.trim();
    if (!textToTransfer) {
      setError('Kein Text zum Uebertragen vorhanden.');
      return;
    }

    void injectToActiveWindow({
      text: textToTransfer,
      mode: 'clipboard',
      restorePreviousWindow: false,
      delayMs: 0,
      charDelayMs: 0,
      fallbackToClipboard: false,
    }).then((result) => {
      if (!result.ok) {
        setError(result.error || 'Text konnte nicht an die Ziel-App uebertragen werden');
      }
    });
  };

  const handleGlobalHotkeyAction = useCallback((action: GlobalHotkeyAction) => {
    switch (action) {
      case 'toggle-recording':
        if (recordingRef.current) {
          void stopRecordingHotkeyRef.current();
        } else {
          void startRecordingHotkeyRef.current();
        }
        break;
      case 'stop-recording':
        if (recordingRef.current) {
          void stopRecordingHotkeyRef.current();
        }
        break;
      case 'cancel-recording':
        if (recordingRef.current) {
          allChunksRef.current = [];
          void stopRecordingHotkeyRef.current().finally(() => {
            resetHotkeyRef.current();
          });
        } else {
          resetHotkeyRef.current();
        }
        break;
      case 'transfer-text':
        transferTextHotkeyRef.current();
        break;
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableKeyboardTarget(e.target)) {
        appendAdminConsoleEntry(
          'keyboard',
          `Editor-Taste ${formatKeyboardKeyLabel(e.key)}`,
          formatKeyboardConsoleDetails(e),
        );
      }

      const action = KEYBOARD_HOTKEY_ACTIONS[e.key];
      if (!action) {
        return;
      }

      e.preventDefault();
      appendAdminConsoleEntry(
        'keyboard',
        `Tastatur-Hotkey ${e.key}`,
        `Aktion: ${formatHotkeyActionLabel(action)} | Key: ${e.key} | Code: ${e.code}`,
      );
      handleGlobalHotkeyAction(action);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [appendAdminConsoleEntry, handleGlobalHotkeyAction]);

  useEffect(() => {
    registerGlobalHotkeys((action) => {
      appendAdminConsoleEntry(
        'injector-hotkey',
        `Injector-Hotkey ${action}`,
        `Aktion: ${formatHotkeyActionLabel(action as GlobalHotkeyAction)}`,
      );
      handleGlobalHotkeyAction(action as GlobalHotkeyAction);
    }).catch(() => {
      // Hotkey registration via WebSocket failed — non-fatal
    });
  }, [appendAdminConsoleEntry, handleGlobalHotkeyAction]);

  useEffect(() => {
    const previous = injectorRecordingStateRef.current;
    injectorRecordingStateRef.current = recording;

    if (previous === null && !recording) {
      return;
    }

    if (previous === recording) {
      return;
    }

    const frontendVisible = isFrontendVisibleForInjector();

    void reportInjectorRecordingState(recording, frontendVisible);
  }, [recording, isFrontendVisibleForInjector]);

  useEffect(() => {
    const reportVisibility = () => {
      if (!recordingRef.current) {
        return;
      }

      const frontendVisible = isFrontendVisibleForInjector();

      void reportInjectorRecordingState(true, frontendVisible);
    };

    window.addEventListener('focus', reportVisibility);
    window.addEventListener('blur', reportVisibility);
    window.addEventListener('pageshow', reportVisibility);
    document.addEventListener('visibilitychange', reportVisibility);

    return () => {
      window.removeEventListener('focus', reportVisibility);
      window.removeEventListener('blur', reportVisibility);
      window.removeEventListener('pageshow', reportVisibility);
      document.removeEventListener('visibilitychange', reportVisibility);
    };
  }, [isFrontendVisibleForInjector]);

  useEffect(() => {
    if (!recording) {
      return;
    }

    const heartbeat = window.setInterval(() => {
      const frontendVisible = isFrontendVisibleForInjector();
      void reportInjectorRecordingState(true, frontendVisible);
    }, 1500);

    return () => {
      window.clearInterval(heartbeat);
    };
  }, [recording, isFrontendVisibleForInjector]);

  useEffect(() => {
    const handleHidMediaControl = (event: Event) => {
      const detail = (event as CustomEvent<HidMediaControlEventDetail>).detail;
      if (detail) {
        appendAdminConsoleEntry(
          'hid',
          `HID ${detail.phase} ${detail.action}`,
          formatHidConsoleDetails(detail),
        );
      }

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
  }, [appendAdminConsoleEntry, startRecording, stopRecording]);

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
            // Mikrofon-Stream holen (mit ausgewähltem Gerät)
            const stream = await getMicStream({
              sampleRate: 16000,
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
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
            // Mikrofon-Stream holen (mit ausgewähltem Gerät)
            const stream = await getMicStream({
              sampleRate: 16000,
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
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
      // Im Auto-Einarbeiten-Modus zeigt das Feld den Baustein. Dieser darf NICHT als
      // bereits diktierter Text gezählt werden, sonst würde er als „Änderung“ an die
      // LLM-Anpassung weitergegeben. Daher startet der Kontext-Buffer hier leer und
      // sammelt ausschließlich den gesprochenen Text.
      const autoIntegrateActive = autoIntegrateTemplateAudio && !!activeTemplateContext;
      const existingVADText = autoIntegrateActive ? '' : startingFieldText.trim();
      committedUtterancesRef.current = existingVADText ? [existingVADText] : [];
      setCommittedUtterances(existingVADText ? [existingVADText] : []);
      setTentativeText('');
      templateAudioBufferRef.current = '';
      pendingTemplateIntegrationRef.current = false;
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
    const stream = await getMicStream();
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
      // Auto-Einarbeiten-Modus: nach dem Leeren der Commit-Queue (inkl. der beim Stop
      // geflushten letzten Utterance) wird der gesammelte Text in den Baustein eingearbeitet.
      if (autoIntegrateTemplateAudio && activeTemplateContext) {
        pendingTemplateIntegrationRef.current = true;
      }
      await vad.stop();
      setAudioLevel(0);
      setRecording(false);
      recordingStartedAtRef.current = null;
      // Falls beim Stop keine Utterance mehr aussteht, kann direkt eingearbeitet werden.
      if (
        pendingTemplateIntegrationRef.current &&
        autoIntegrateTemplateAudio &&
        activeTemplateContext &&
        vadInFlightCountRef.current === 0 &&
        vadPendingResultsRef.current.size === 0
      ) {
        pendingTemplateIntegrationRef.current = false;
        const spoken = templateAudioBufferRef.current.trim();
        templateAudioBufferRef.current = '';
        setTentativeText('');
        if (spoken) {
          await applyTemplateChanges(activeTemplateContext, spoken);
        }
      } else if (!pendingTemplateIntegrationRef.current) {
        setTentativeText('');
      }
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
          queueFinalSessionLiveInject(sessionTranscript);

          // Formatierung, Wörterbuch und phonetische Korrektur anwenden.
          const formattedTranscript = prepareLiveInjectDelta(sessionTranscript);
          
          // Aktiver Baustein-Kontext: gesprochenen Text direkt in den eingefügten Baustein einarbeiten
          if (autoIntegrateTemplateAudio && activeTemplateContext) {
            await applyTemplateChanges(activeTemplateContext, formattedTranscript);
          // TEMPLATE-MODUS: Textbaustein mit diktierten Änderungen kombinieren
          } else if (templateMode && selectedTemplate) {
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
          username,
          dictionarySet
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
        body: JSON.stringify({ text: transcript, username, dictionarySet }),
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
    const parts = [];
    const htmlParts = [];
    const allFormats = richTextFormats;

    if (methodik) {
      parts.push(`Methodik:\n${methodik}`);
      htmlParts.push(`<p><strong>Methodik:</strong></p><p>${buildRichTextHtml(methodik, allFormats.methodik ?? [])}</p>`);
    }
    if (transcript) {
      parts.push(`Befund:\n${transcript}`);
      htmlParts.push(`<p><strong>Befund:</strong></p><p>${buildRichTextHtml(transcript, allFormats.transcript ?? [])}</p>`);
    }
    if (beurteilung) {
      parts.push(`Beurteilung:\n${beurteilung}`);
      htmlParts.push(`<p><strong>Beurteilung:</strong></p><p>${buildRichTextHtml(beurteilung, allFormats.beurteilung ?? [])}</p>`);
    }

    copyRichTextToClipboard(
      parts.filter(Boolean).join('\n\n'),
      htmlParts.filter(Boolean).join('')
    );
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
    copyRichTextToClipboard(transcript, buildRichTextHtml(transcript, richTextFormats.transcript ?? []));
    showToast('✅ Kopiert!');
  }

  async function handleExportDocx() {
    await exportDocx(transcript, mode);
  }

  const Aufnahme = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/40">
        <div>
          <div className="text-xs font-medium text-gray-700 dark:text-gray-200">Textfeld-Breite</div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Nur fuer den Live-Modus</div>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          {LIVE_EDITOR_WIDTH_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                liveEditorWidth === option.value
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
              onClick={() => {
                setLiveEditorWidth(option.value);
                try {
                  localStorage.setItem(LIVE_EDITOR_WIDTH_STORAGE_KEY, option.value);
                } catch {}
                window.dispatchEvent(new Event(LIVE_EDITOR_WIDTH_CHANGED_EVENT));
              }}
              aria-pressed={liveEditorWidth === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {recording ? (
          <div className="flex items-center gap-3 flex-1">
            <span className="inline-flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
              <span className="pulse-dot" />
              {transcribing && <span className="opacity-70">(transkribiert...)</span>}
              {correcting && <span className="opacity-70">(korrigiert...)</span>}
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
          <span className="inline-flex min-w-[7rem] items-center justify-center text-xs text-gray-500 dark:text-gray-400">Bereit</span>
        )}
      </div>
      
      {/* Raumgeräusch-Schwelle */}
      <div className="flex items-center gap-3 text-xs">
        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap select-none" title="Höhere Werte blenden leise Hintergrundgeräusche und Nebengespräche aus">
          🎚️ Raumgeräusch
        </span>
        <input
          type="range"
          min="0.30"
          max="0.75"
          step="0.01"
          value={roomNoiseThreshold}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            setRoomNoiseThreshold(val);
            try { localStorage.setItem('schreibdienst:vadThreshold', String(val)); } catch {}
          }}
          className="flex-1 h-1.5 accent-blue-600 cursor-pointer"
          title="Je höher, desto lauter muss Sprache sein, um erkannt zu werden"
        />
        <span className="text-gray-400 w-10 text-right tabular-nums">{roomNoiseThreshold.toFixed(2)}</span>
      </div>
      
      {/* Hinweis zu Sprachbefehlen */}
      {recording && (
        <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/30 p-2 rounded">
          💡 <strong>Sprachbefehle:</strong> "Punkt", "Komma", "neuer Absatz", "lösche den letzten Satz", "lösche das letzte Wort", "Wort fett", "Satz kursiv", "Auswahl fett", "fett beginnen", "fett ende"
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

      {/* Neuen Baustein anlegen Dialog */}
      {showNewTemplateDialog && (
        <div id="inline-template-dialog" className="border border-orange-200 dark:border-orange-800 rounded-lg p-4 bg-orange-50 dark:bg-orange-900/30 flex flex-col">
          <h4 className="font-semibold text-orange-900 dark:text-orange-100 mb-3 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
            Neuen Textbaustein anlegen
          </h4>
          <div id="inline-template-dialog-body" className="flex flex-col flex-1 min-h-0 gap-3">
            <div id="inline-template-dialog-name-group" className="flex-shrink-0">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
              <input
                type="text"
                className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:border-orange-400 focus:ring-1 focus:ring-orange-300 focus:outline-none"
                placeholder="z. B. MRT Schädel"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                autoFocus
              />
            </div>
            <div id="inline-template-dialog-content-group" className="flex flex-col flex-1 min-h-0">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Inhalt</label>
              <TemplateRichTextEditor
                value={newTemplateContent}
                formats={newTemplateFormats}
                onChange={(value, nextFormats) => {
                  setNewTemplateContent(value);
                  setNewTemplateFormats(nextFormats);
                }}
                placeholder="Textbaustein-Inhalt..."
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:border-orange-400 focus:ring-1 focus:ring-orange-300 focus:outline-none h-full min-h-0"
                disabled={creatingTemplate}
              />
            </div>
            <div id="inline-template-dialog-actions" className="flex items-center gap-2 flex-shrink-0">
              <button
                className="btn btn-primary text-sm"
                onClick={handleCreateNewTemplate}
                disabled={creatingTemplate || !newTemplateName.trim() || !newTemplateContent.trim()}
              >
                {creatingTemplate ? <Spinner size={14} /> : 'Baustein anlegen'}
              </button>
              <button
                className="btn btn-secondary text-sm"
                onClick={() => {
                  setShowNewTemplateDialog(false);
                  setNewTemplateName('');
                  setNewTemplateContent('');
                  setNewTemplateFormats([]);
                }}
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Ref für den Mikrofon-Button
  const recordButtonRef = useRef<HTMLButtonElement>(null);
  const hasCorrectionText = mode === 'befund'
    ? Boolean(methodik.trim() || transcript.trim() || beurteilung.trim())
    : Boolean(transcript.trim());
  const correctionButtonDisabled = correcting || busy || !hasCorrectionText;

  // Rechtsklick-Handler: Löst "Neu" aus (alle Felder löschen) - nur auf nicht-interaktiven Elementen
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    
    // Prüfe ob das Ziel oder ein Elternelement ein interaktives Element ist
    const interactiveSelectors = 'button, a, input, textarea, select, [role="button"], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
    const isInteractive = target.closest(interactiveSelectors);
    
    // Prüfe ob ein Textfeld fokussiert ist (blinkender Cursor)
    // Erkennt sowohl native <textarea>/<input> als auch contentEditable-Divs (z.B. Lexical-Editor)
    const activeElement = document.activeElement;
    const isEditing = activeElement?.tagName === 'TEXTAREA' 
      || activeElement?.tagName === 'INPUT' 
      || (activeElement instanceof HTMLElement && activeElement.isContentEditable);
    
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
    </div>
  );

  const helpPanelWidth = liveEditorWidth === 'small'
    ? 'max(0px, calc((100vw - min(42rem, 100vw)) / 2 - 3rem))'
    : 'min(42rem, calc(100vw - 4.5rem))';

  const templateEditorWidthClass = liveEditorWidth === 'full'
    ? '' // keine Breitenbegrenzung – wie die Diktat-Felder im Live-Modus
    : liveEditorWidth === 'a4'
      ? 'max-w-5xl'
      : 'max-w-2xl';

  return (
    <div className="space-y-3 min-h-[calc(100vh-120px)]" onContextMenu={handleContextMenu}>
      {/* Kompakte Steuerleiste */}
      <div className="card relative">
        <span className="absolute top-1 right-2 text-[10px] text-gray-300 dark:text-gray-600 select-none">Schreibdienst Dashboard</span>
        <div className="card-body py-3 space-y-2">
          {/* Erste Zeile: Record+Bereit+Live-Ü | Medizinische Fachwörter/Alltagssprache | Undo Redo New */}
          <div className="flex items-stretch gap-3">
            {/* Links: Record + Bereit + Live-Übertragung */}
            <div className="flex-1 flex items-center justify-start gap-2">
              <div className="flex flex-col items-center gap-1">
                {RecordButton}
              </div>
              <span className="inline-flex items-center justify-center w-[9ch] text-[10px] text-gray-400 dark:text-gray-500 select-none">
                {recording ? REC_ANIM_FRAMES[recordingAnimFrame] : IDLE_ANIM_FRAMES[idleAnimFrame]}
              </span>
              <button
                className={`btn h-9 min-w-[80px] px-1.5 text-[11px] font-medium relative overflow-hidden ${liveInjectEnabled ? 'btn-success' : 'btn-outline'} ${autoIntegrateTemplateAudio ? 'opacity-50 cursor-not-allowed' : ''}`}
                onClick={() => {
                  void handleToggleLiveInject();
                }}
                title={autoIntegrateTemplateAudio
                  ? 'Direkt-Diktat nicht verfügbar – bitte zuerst den Baustein-Modus deaktivieren'
                  : liveInjectEnabled
                    ? 'Live-Übertragung an Ziel-App ist aktiv'
                    : 'Live-Übertragung an Ziel-App aktivieren'}
                aria-label={autoIntegrateTemplateAudio
                  ? 'Direkt-Diktat nicht verfügbar – Baustein-Modus ist aktiv'
                  : liveInjectEnabled
                    ? 'Live-Übertragung an Ziel-App deaktivieren'
                    : 'Live-Übertragung an Ziel-App aktivieren'}
                aria-pressed={liveInjectEnabled}
                disabled={injectorCheckInProgress || autoIntegrateTemplateAudio}
              >
                <span className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${liveInjectEnabled ? 'opacity-0' : 'opacity-100'}`}>Hier ↓</span>
                <span className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${liveInjectEnabled ? 'opacity-100' : 'opacity-0'}`}>Ziel App →</span>
              </button>
            </div>

            {/* Mitte: Medizinische Fachwörter / Alltagssprache + Textbreite */}
            <div className="flex-1 flex items-center justify-center gap-3">
              <select
                className="h-9 rounded-md border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 cursor-pointer"
                value={liveEditorWidth}
                onChange={(e) => {
                  const value = e.target.value as LiveEditorWidth;
                  setLiveEditorWidth(value);
                  try {
                    localStorage.setItem(LIVE_EDITOR_WIDTH_STORAGE_KEY, value);
                  } catch {}
                  window.dispatchEvent(new Event(LIVE_EDITOR_WIDTH_CHANGED_EVENT));
                }}
                aria-label="Textbreite"
              >
                {LIVE_EDITOR_WIDTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                className={`inline-flex h-9 min-w-[11rem] items-center justify-center gap-1.5 px-3 text-xs font-medium rounded-md border transition-colors ${
                  dictionarySet === 'medical'
                    ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
                onClick={toggleDictionarySet}
                title={
                  dictionarySet === 'medical'
                    ? 'Medizinische Fachwörter: alle phonetischen Wörterbücher (Standard, Abteilung, persönlich) sind aktiv. Klicken zum Umschalten auf Alltagssprache.'
                    : 'Alltagssprache: alle Wörterbücher sind aus. Klicken zum Umschalten auf Medizinische Fachwörter.'
                }
                aria-pressed={dictionarySet === 'medical'}
                aria-label={dictionarySet === 'medical' ? 'Wörterbuch-Modus: Medizinische Fachwörter (an)' : 'Wörterbuch-Modus: Alltagssprache (aus)'}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    dictionarySet === 'medical' ? 'bg-white' : 'bg-gray-400'
                  }`}
                  aria-hidden="true"
                />
                {dictionarySet === 'medical' ? 'Medizinisch' : 'Alltagssprache'}
              </button>
            </div>

            {/* Rechts: Undo, Redo, New */}
            <div className="flex-1 flex items-center justify-end">
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-outline h-9 w-9 p-0"
                  onClick={handleUndoTextHistory}
                  title="Letzte Textänderung rückgängig machen"
                  aria-label="Letzte Textänderung rückgängig machen"
                  disabled={!textHistoryAvailability.canUndo || isProcessing}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 14 4 9l5-5" />
                    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
                  </svg>
                </button>
                <button
                  className="btn btn-outline h-9 w-9 p-0"
                  onClick={handleRedoTextHistory}
                  title="Rückgängig gemachte Textänderung wiederherstellen"
                  aria-label="Rückgängig gemachte Textänderung wiederherstellen"
                  disabled={!textHistoryAvailability.canRedo || isProcessing}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m15 14 5-5-5-5" />
                    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
                  </svg>
                </button>
                <button
                  className="btn btn-outline h-9 w-9 p-0 border-red-200 text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-red-900/40 dark:text-red-400 dark:hover:border-red-800 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                  onClick={handleReset}
                  title="Alle Felder löschen"
                  aria-label="Alle Felder löschen"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Zweite Zeile: Raumlautstärke, Korrigieren, Bausteine — links, mitte, rechts */}
          <div className="flex items-stretch gap-3">
            {/* Links: Raumlautstärke */}
            <div className="flex-1 flex items-center justify-start">
              {(!recording || !runtimeConfig || runtimeConfig.transcriptionProvider === 'voxtral_local' || runtimeConfig.transcriptionProvider === 'whisperx' || runtimeConfig.transcriptionProvider === 'mistral') && (
                <div className="flex h-9 flex-col items-center justify-center gap-0 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500 select-none" title="Je höher, desto lauter muss Sprache sein um erkannt zu werden">🎚️</span>
                    <input
                      type="range"
                      min="0.30"
                      max="0.75"
                      step="0.01"
                      value={roomNoiseThreshold}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setRoomNoiseThreshold(val);
                        try { localStorage.setItem('schreibdienst:vadThreshold', String(val)); } catch {}
                      }}
                      className="w-16 h-1 accent-blue-600 cursor-pointer"
                      title={`VAD-Empfindlichkeit: ${roomNoiseThreshold.toFixed(2)}`}
                    />
                    <span className="text-gray-400 w-8 tabular-nums">{roomNoiseThreshold.toFixed(2)}</span>
                  </div>
                  <span className="text-[10px] text-gray-400 leading-none">Raumlautstärke</span>
                </div>
              )}
            </div>

            {/* Mitte: Korrigieren + Revert/Diff/Neu korrigieren */}
            <div className="flex-1 flex items-center justify-center gap-2 flex-wrap">
              {canRevert && preCorrectionState && (
                <>
                  <button
                    className="btn btn-outline h-9 text-sm px-3 text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-600 dark:hover:bg-amber-900/20"
                    onClick={handleRevert}
                    title="Korrektur rückgängig machen - zeigt den Originaltext"
                    disabled={correcting}
                  >
                    ↩ Revert
                  </button>
                  <button
                    className={`btn h-9 text-sm px-3 ${showDiffView ? 'btn-primary' : 'btn-outline'}`}
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
                    className="btn btn-outline h-9 text-sm px-3 text-purple-600 border-purple-300 hover:bg-purple-50 dark:text-purple-400 dark:border-purple-600 dark:hover:bg-purple-900/20"
                    onClick={handleReCorrect}
                    title="Korrektur erneut durchführen"
                    disabled={correcting}
                  >
                    {correcting ? <Spinner size={14} /> : '🔄 Neu korrigieren'}
                  </button>
                  <label
                    className="flex h-9 items-center gap-1.5 text-xs cursor-pointer select-none px-2 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
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
              <button
                className={`btn h-9 text-sm px-3 ${pendingCorrection && !correctionButtonDisabled ? 'btn-primary animate-pulse' : 'btn-outline'}`}
                onClick={mode === 'befund' ? handleFormatBefund : handleManualCorrect}
                title={hasCorrectionText ? 'KI-Korrektur durchführen' : 'Text eingeben, um die KI-Korrektur zu aktivieren'}
                disabled={correctionButtonDisabled}
              >
                {correcting ? <Spinner size={14} /> : '🤖 Korrigieren'}
              </button>
            </div>

            {/* Rechts: Bausteine — breit genug zum Lesen */}
            <div className="flex-1 flex items-center justify-end">
              <div className="flex items-center gap-1">
                <select
                  ref={templateSelectRef}
                  className={`select h-9 text-sm w-44 ${templateMode ? 'border-orange-400 ring-1 ring-orange-300' : ''}`}
                  value={selectedTemplate?.id || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__new__') {
                      setTemplateManagerMode('create');
                      setShowTemplatesManager(true);
                      return;
                    }
                    if (val === '__manage__') {
                      setTemplateManagerMode('manage');
                      setShowTemplatesManager(true);
                      return;
                    }
                    if (val === '__multi__') {
                      setShowMultiBausteinMode((prev) => !prev);
                      return;
                    }
                    const id = parseInt(val);
                    const template = availableTemplates.find(t => t.id === id);
                    handleTemplateSelection(template || null);
                  }}
                  title={mode === 'befund'
                    ? 'Textbaustein für das aktive Feld auswählen - diktieren Sie nur die Änderungen'
                    : 'Textbaustein für den Arztbrief auswählen - diktieren Sie nur die Änderungen'}
                  disabled={loadingTemplates}
                >
                  <option value="">{loadingTemplates ? 'Lade Bausteine...' : '📝 Bausteine'}</option>
                  <option value="__manage__" className="font-medium text-orange-600 dark:text-orange-400">📂 Meine Bausteine</option>
                  <option value="__new__" className="border-t border-gray-300 dark:border-gray-600 font-medium text-blue-600 dark:text-blue-400">➕ Neuen Baustein anlegen</option>
                  <option value="__multi__" className={`font-medium ${showMultiBausteinMode ? 'text-green-600 dark:text-green-400' : 'text-purple-600 dark:text-purple-400'}`}>
                    {showMultiBausteinMode ? '✓ Mit mehreren Bausteinen arbeiten' : '⊞ Mit mehreren Bausteinen arbeiten'}
                  </option>
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
            </div>
          </div>

          {/* Live-Inject Ziel-Fenster (nur sichtbar wenn aktiv) */}
          {liveInjectEnabled && (
            <div className="flex items-center gap-2 flex-wrap">
              {liveInjectStatus ? (
                <div className="text-[11px] text-gray-500 dark:text-gray-400" title={liveInjectStatus}>
                  {liveInjectStatus}
                </div>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  className="text-[11px] px-2 py-0.5 w-36 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 placeholder-gray-400 dark:placeholder-gray-500 focus:border-purple-400 focus:ring-1 focus:ring-purple-300 dark:focus:border-purple-500 dark:focus:ring-purple-700 focus:outline-none"
                  placeholder="Ziel-Fenster-Titel…"
                  value={targetWindowPattern}
                  onChange={(e) => setTargetWindowPattern(e.target.value)}
                  title="Teil des Fenstertitels der Ziel-App (z. B. 'Radiologie'). Der Injector findet das Fenster auch nach Fokusverlust wieder."
                />
                {targetWindowPattern && (
                  <button
                    className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1"
                    onClick={() => setTargetWindowPattern('')}
                    title="Fenster-Suche zurücksetzen"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}
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
            <BracketHighlight text={selectedTemplate.content.substring(0, 150) + '...'} />
          </p>
          <p className="text-xs text-orange-600 dark:text-orange-400 mt-1 italic">
            💡 Diktieren Sie nur die Änderungen. {hasTemplateChanges ? 'Mit "Änderungen einfügen" werden diese per LLM in den Baustein eingebaut.' : 'Mit "Einfügen" wird der Baustein unverändert übernommen.'}
          </p>
              </>
            );
          })()}
        </div>
      )}

      {activeTemplateContext && !recording && (
        <div className="text-sm bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 rounded-lg">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-emerald-700 dark:text-emerald-300 font-medium">🧩 Aktiver Baustein: {activeTemplateContext.name}</span>
              <span className="text-xs px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded">
                {activeTemplateContext.field}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={`btn text-sm py-1.5 px-3 ${autoIntegrateTemplateAudio ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setAutoIntegrateTemplateAudio((current) => !current)}
                title="Gesprochenen Text automatisch in den aktiven Baustein einarbeiten"
                aria-pressed={autoIntegrateTemplateAudio}
              >
                {autoIntegrateTemplateAudio ? '✓ Audio automatisch in Baustein einarbeiten' : '☐ Audio automatisch in Baustein einarbeiten'}
              </button>
              <button
                className="btn btn-outline text-sm py-1.5 px-3"
                onClick={() => {
                  setActiveTemplateContext(null);
                  setAutoIntegrateTemplateAudio(false);
                  setTemplateUnusedText('');
                }}
                title="Baustein-Kontext beenden"
              >
                ✕
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300 italic">
            {autoIntegrateTemplateAudio
              ? 'Neue Audio-Transkripte werden direkt in diesen Baustein eingearbeitet.'
              : 'Neue Audio-Transkripte werden normal am Cursor oder am Feldende eingefügt.'}
          </p>
          <div className="mt-2 flex items-center gap-4 flex-wrap">
            {/* Widersprüche erkennen */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium whitespace-nowrap">Widersprüche:</span>
              <div className="flex rounded border border-emerald-300 dark:border-emerald-700 overflow-hidden">
                {(['aus', 'einfach', 'genau', 'optionen'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`px-2 py-0.5 text-[11px] transition-colors ${
                      templateContradictionMode === mode
                        ? 'bg-emerald-600 text-white'
                        : 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-800/40'
                    }`}
                    onClick={() => setTemplateContradictionMode(mode)}
                    title={
                      mode === 'genau' ? 'Ausführliche Widerspruchsprüfung inkl. Beispiele'
                      : mode === 'einfach' ? 'Verkürzte Widerspruchsprüfung'
                      : mode === 'optionen' ? 'Aus [Optionen] im Baustein-Text auswählen'
                      : 'Keine Widerspruchsprüfung'
                    }
                  >
                    {mode === 'aus' ? 'Aus' : mode === 'einfach' ? 'Einfach' : mode === 'genau' ? 'Genau' : 'Optionen'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingTemplateInsertChoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Baustein einfügen</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Im Zielfeld ist bereits Text vorhanden. Wie soll der Baustein <strong>{pendingTemplateInsertChoice.template.name}</strong> eingefügt werden?
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                className="btn btn-outline text-sm py-1.5 px-3"
                onClick={() => setPendingTemplateInsertChoice(null)}
                disabled={correcting || busy}
              >
                Abbrechen
              </button>
              <button
                className="btn btn-outline text-sm py-1.5 px-3"
                onClick={() => insertTemplateIntoField(pendingTemplateInsertChoice.template, 'replace')}
                disabled={correcting || busy}
              >
                Ersetzen
              </button>
              <button
                className="btn btn-outline text-sm py-1.5 px-3"
                onClick={() => { void integrateExistingTextIntoTemplate(pendingTemplateInsertChoice.template); }}
                disabled={correcting || busy}
                title="Vorhandenen Text per LLM in die Baustein-Vorlage einarbeiten"
              >
                In Vorlage einbauen
              </button>
              <button
                className="btn btn-primary text-sm py-1.5 px-3"
                onClick={() => insertTemplateIntoField(pendingTemplateInsertChoice.template, 'append')}
                disabled={correcting || busy}
              >
                Anhängen
              </button>
            </div>
          </div>
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

      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] pointer-events-none">
          <div className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white shadow-xl whitespace-nowrap">
            {toastMessage}
          </div>
        </div>
      )}

      {/* Processing Status — Aufnahme-Live-Indikator (inline) */}
      {recording && (
        <div className="bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 border rounded-lg px-4 py-3 flex items-center gap-3">
          <Spinner size={18} className="text-green-600 dark:text-green-400" />
          <div className="flex-1">
            <span className="text-sm font-medium text-green-700 dark:text-green-300">
              {processingStatus}
            </span>
            <p className="text-xs mt-0.5 text-green-600 dark:text-green-400">
              Sprechen Sie in das Mikrofon.
            </p>
          </div>
          <div className="flex gap-1">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
            <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
            <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
          </div>
        </div>
      )}

      {/* Processing Status — Verarbeitungs-Popup (bei Korrektur/Transkription) */}
      {!recording && isProcessing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            <div className="flex flex-col items-center gap-4">
              <Spinner size={32} className="text-blue-600 dark:text-blue-400" />
              <div className="text-center">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {processingStatus}
                </p>
                <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">
                  Bitte warten Sie, bis die Verarbeitung abgeschlossen ist.
                </p>
              </div>
              <div className="flex gap-1.5">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Befund-Modus: Drei separate Felder */}
      {mode === 'befund' ? (
        <div className="space-y-3">
          {/* Methodik-Feld mit Action-Buttons */}
          <div className="card">
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
                    {renderRichTextToolbar('methodik')}
                    <button 
                      className="text-base text-gray-500 hover:text-gray-700 px-3 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" 
                      onClick={() => { copyRichTextToClipboard(methodik, buildRichTextHtml(methodik, getFieldRichTextFormats('methodik'))); showToast('✅ Kopiert!'); }}
                      disabled={!methodik}
                      title="Kopieren"
                    >
                      📋
                    </button>
                    <button 
                      className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" 
                      onClick={() => printRichText(methodik, buildRichTextHtml(methodik, getFieldRichTextFormats('methodik')), 'Methodik')}
                      disabled={!methodik}
                      title="Drucken"
                    >
                      🖨️
                    </button>
                    <CustomActionButtons
                      currentField="methodik"
                      getText={() => methodik}
                      getAllTexts={() => ({ methodik, befund: transcript, beurteilung })}
                      onResult={(result) => setMethodik(result)}
                      disabled={isProcessing}
                      onManageClick={() => setShowCustomActionsManager(true)}
                      layout="horizontal"
                    />
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
                  <MultiBlockEditor
                    blocks={editorBlocksByField.methodik}
                    activeBlockId={activeBlockId}
                    editorRef={methodikTextareaRef}
                    fieldFormats={getFieldRichTextFormats('methodik')}
                    selection={textSelections.methodik ?? null}
                    className={`textarea font-mono text-sm min-h-20 ${activeField === 'methodik' && recording ? 'ring-2 ring-green-500' : ''} ${isProcessing ? 'opacity-60 cursor-not-allowed' : ''}`}
                    isProcessing={isProcessing}
                    recording={recording}
                    focused={focusedTextField === 'methodik'}
                    showPersistentCaret={showPersistentCaret}
                    caretPosition={caretOverlays.methodik}
                    placeholder="Methodik..."
                    onBlockActivate={(blockId) => setActiveBlockId(blockId)}
                    onChange={(value, editor) => handleRichTextEditorChange('methodik', value, setMethodik, editor)}
                    onFocus={(editor) => { setActiveField('methodik'); setFocusedTextField('methodik'); handleRichTextSelectionChange('methodik', editor); }}
                    onBlur={() => setFocusedTextField((current) => current === 'methodik' ? null : current)}
                    onSelectionChange={(editor) => handleRichTextSelectionChange('methodik', editor)}
                    onWordDoubleClick={(info) => handleRichTextWordDoubleClick('methodik', info)}
                  />
                {manualCorrectionSuggestions.methodik && (
                  <ManualCorrectionSuggestion
                    originalWord={manualCorrectionSuggestions.methodik.originalWord}
                    newWord={manualCorrectionSuggestions.methodik.newWord}
                    targetUsername={username || undefined}
                    onConfirm={() => acknowledgeManualCorrection('methodik')}
                    onCancel={() => acknowledgeManualCorrection('methodik')}
                  />
                )}
              </div>
          </div>

          {/* Befund-Feld (Hauptfeld) mit Action-Buttons */}
          <div className="card">
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
                    {renderRichTextToolbar('befund')}
                    <button 
                      className="text-base text-gray-500 hover:text-gray-700 px-3 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" 
                      onClick={() => { copyRichTextToClipboard(transcript, buildRichTextHtml(transcript, getFieldRichTextFormats('befund'))); showToast('✅ Kopiert!'); }}
                      disabled={!transcript}
                      title="Kopieren"
                    >
                      📋
                    </button>
                    <button 
                      className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" 
                      onClick={() => printRichText(transcript, buildRichTextHtml(transcript, getFieldRichTextFormats('befund')), 'Befund')}
                      disabled={!transcript}
                      title="Drucken"
                    >
                      🖨️
                    </button>
                    <CustomActionButtons
                      currentField="befund"
                      getText={() => transcript}
                      getAllTexts={() => ({ methodik, befund: transcript, beurteilung })}
                      onResult={(result) => setTranscript(result)}
                      disabled={isProcessing}
                      onManageClick={() => setShowCustomActionsManager(true)}
                      layout="horizontal"
                    />
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
                  <MultiBlockEditor
                    blocks={editorBlocksByField.befund}
                    activeBlockId={activeBlockId}
                    editorRef={befundTextareaRef}
                    fieldFormats={getFieldRichTextFormats('befund')}
                    selection={textSelections.befund ?? null}
                    className={`textarea font-mono text-sm min-h-32 ${activeField === 'befund' && recording ? 'ring-2 ring-green-500' : ''} ${isProcessing ? 'opacity-60 cursor-not-allowed' : ''}`}
                    isProcessing={isProcessing}
                    recording={recording}
                    focused={focusedTextField === 'befund'}
                    showPersistentCaret={showPersistentCaret}
                    caretPosition={caretOverlays.befund}
                    placeholder="Befund..."
                    onBlockActivate={(blockId) => setActiveBlockId(blockId)}
                    onChange={(value, editor) => handleRichTextEditorChange('befund', value, setTranscript, editor)}
                    onFocus={(editor) => { setActiveField('befund'); setFocusedTextField('befund'); handleRichTextSelectionChange('befund', editor); }}
                    onBlur={() => setFocusedTextField((current) => current === 'befund' ? null : current)}
                    onSelectionChange={(editor) => handleRichTextSelectionChange('befund', editor)}
                    onWordDoubleClick={(info) => handleRichTextWordDoubleClick('befund', info)}
                  />
                {manualCorrectionSuggestions.befund && (
                  <ManualCorrectionSuggestion
                    originalWord={manualCorrectionSuggestions.befund.originalWord}
                    newWord={manualCorrectionSuggestions.befund.newWord}
                    targetUsername={username || undefined}
                    onConfirm={() => acknowledgeManualCorrection('befund')}
                    onCancel={() => acknowledgeManualCorrection('befund')}
                  />
                )}
                {/* VAD Tentative Text: Zeigt an, dass gerade gesprochen wird */}
                {recording && vad.isListening && tentativeText && (
                  <div className="px-2 py-1 text-sm italic text-gray-400 dark:text-gray-500 border-l-2 border-green-400 bg-green-50/50 dark:bg-green-900/20 rounded-r">
                    {vad.isSpeaking ? '🎙️ Sprache erkannt...' : '⏳ Transkribiere...'}
                  </div>
                )}
              </div>
          </div>

          {/* Warnbanner bei signifikanten Änderungen */}
          {changeScore !== null && changeScore > 35 && !isProcessing && (
            <ChangeWarningBanner score={changeScore} />
          )}

          {/* Beurteilung-Feld mit Action-Buttons */}
          <div className="card">
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
                    {renderRichTextToolbar('beurteilung')}
                    <button 
                      className="text-base text-gray-500 hover:text-gray-700 px-3 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" 
                      onClick={() => { copyRichTextToClipboard(beurteilung, buildRichTextHtml(beurteilung, getFieldRichTextFormats('beurteilung'))); showToast('✅ Kopiert!'); }}
                      disabled={!beurteilung}
                      title="Kopieren"
                    >
                      📋
                    </button>
                    <button 
                      className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" 
                      onClick={() => printRichText(beurteilung, buildRichTextHtml(beurteilung, getFieldRichTextFormats('beurteilung')), 'Zusammenfassung')}
                      disabled={!beurteilung}
                      title="Drucken"
                    >
                      🖨️
                    </button>
                    <CustomActionButtons
                      currentField="beurteilung"
                      getText={() => beurteilung}
                      getAllTexts={() => ({ methodik, befund: transcript, beurteilung })}
                      onResult={(result) => setBeurteilung(result)}
                      disabled={isProcessing}
                      onManageClick={() => setShowCustomActionsManager(true)}
                      layout="horizontal"
                    />
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
                  <MultiBlockEditor
                    blocks={editorBlocksByField.beurteilung}
                    activeBlockId={activeBlockId}
                    editorRef={beurteilungTextareaRef}
                    fieldFormats={getFieldRichTextFormats('beurteilung')}
                    selection={textSelections.beurteilung ?? null}
                    className={`textarea font-mono text-sm min-h-20 ${activeField === 'beurteilung' && recording ? 'ring-2 ring-green-500' : ''} ${isProcessing ? 'opacity-60 cursor-not-allowed' : ''}`}
                    isProcessing={isProcessing}
                    recording={recording}
                    focused={focusedTextField === 'beurteilung'}
                    showPersistentCaret={showPersistentCaret}
                    caretPosition={caretOverlays.beurteilung}
                    placeholder="Zusammenfassung..."
                    onBlockActivate={(blockId) => setActiveBlockId(blockId)}
                    onChange={(value, editor) => handleRichTextEditorChange('beurteilung', value, setBeurteilung, editor)}
                    onFocus={(editor) => { setActiveField('beurteilung'); setFocusedTextField('beurteilung'); handleRichTextSelectionChange('beurteilung', editor); }}
                    onBlur={() => setFocusedTextField((current) => current === 'beurteilung' ? null : current)}
                    onSelectionChange={(editor) => handleRichTextSelectionChange('beurteilung', editor)}
                    onWordDoubleClick={(info) => handleRichTextWordDoubleClick('beurteilung', info)}
                  />
                {manualCorrectionSuggestions.beurteilung && (
                  <ManualCorrectionSuggestion
                    originalWord={manualCorrectionSuggestions.beurteilung.originalWord}
                    newWord={manualCorrectionSuggestions.beurteilung.newWord}
                    targetUsername={username || undefined}
                    onConfirm={() => acknowledgeManualCorrection('beurteilung')}
                    onCancel={() => acknowledgeManualCorrection('beurteilung')}
                  />
                )}
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

        {templateUnusedText && (templateMode || activeTemplateContext) && mode === 'befund' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
            <label className="mb-1 block text-xs font-medium text-amber-800 dark:text-amber-200">
              Nicht verwendete Textteile
            </label>
            <textarea
              className="textarea min-h-24 w-full resize-y border-amber-200 bg-white/80 text-sm text-amber-900 dark:border-amber-700 dark:bg-gray-900/60 dark:text-amber-100"
              value={templateUnusedText}
              readOnly
            />
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
              Diese Inhalte konnten nicht sinnvoll in die aktive Baustein-Vorlage eingebaut werden.
            </p>
          </div>
        )}
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
                {renderRichTextToolbar('transcript')}
                <button 
                  className="text-base text-gray-500 hover:text-gray-700 px-3 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" 
                  onClick={handleCopy}
                  disabled={!transcript}
                  title="Kopieren"
                >
                  📋
                </button>
                <button 
                  className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" 
                  onClick={() => printRichText(transcript, buildRichTextHtml(transcript, getFieldRichTextFormats('transcript')), 'Arztbrief')}
                  disabled={!transcript}
                  title="Drucken"
                >
                  🖨️
                </button>
                <CustomActionButtons
                  currentField="transcript"
                  getText={() => transcript}
                  onResult={(result) => setTranscript(result)}
                  disabled={isProcessing}
                  onManageClick={() => setShowCustomActionsManager(true)}
                  layout="horizontal"
                />
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
            
            <div>
              <div>
                <div className="relative">
                  <RichTextDictationEditor
                    editorRef={transcriptTextareaRef}
                    value={transcript}
                    formats={getFieldRichTextFormats('transcript')}
                    selection={textSelections.transcript ?? null}
                    className={`textarea font-mono text-sm min-h-40 w-full ${isProcessing ? 'opacity-60 cursor-not-allowed' : ''}`}
                    onChange={(value, editor) => handleRichTextEditorChange('transcript', value, setTranscript, editor)}
                    onFocus={(editor) => { setFocusedTextField('transcript'); handleRichTextSelectionChange('transcript', editor); }}
                    onBlur={() => setFocusedTextField((current) => current === 'transcript' ? null : current)}
                    onSelectionChange={(editor) => handleRichTextSelectionChange('transcript', editor)}
                    onWordDoubleClick={(info) => handleRichTextWordDoubleClick('transcript', info)}
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
                {templateUnusedText && (templateMode || activeTemplateContext) && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                    <label className="mb-1 block text-xs font-medium text-amber-800 dark:text-amber-200">
                      Nicht verwendete Textteile
                    </label>
                    <textarea
                      className="textarea min-h-24 w-full resize-y border-amber-200 bg-white/80 text-sm text-amber-900 dark:border-amber-700 dark:bg-gray-900/60 dark:text-amber-100"
                      value={templateUnusedText}
                      readOnly
                    />
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                      Diese Inhalte konnten nicht sinnvoll in die aktive Baustein-Vorlage eingebaut werden.
                    </p>
                  </div>
                )}
                {manualCorrectionSuggestions.transcript && (
                  <ManualCorrectionSuggestion
                    originalWord={manualCorrectionSuggestions.transcript.originalWord}
                    newWord={manualCorrectionSuggestions.transcript.newWord}
                    targetUsername={username || undefined}
                    onConfirm={() => acknowledgeManualCorrection('transcript')}
                    onCancel={() => acknowledgeManualCorrection('transcript')}
                  />
                )}
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
            </div>
          </div>
        </div>
      )}

      {/* Seitliches Panel: Mit mehreren Bausteinen arbeiten */}
      {showMultiBausteinMode && (
        <div className={`
          fixed left-0 top-[18vh] z-40 hidden md:flex items-start
          ${liveEditorWidth === 'full' ? 'left-0' : 'left-0'}
        `}>
          <div className="flex items-start">
            <BausteinPalette
              templates={availableTemplates.map((t) => ({ id: t.id, name: t.name, content: t.content }))}
              onAddBaustein={(tpl) => {
                const full = availableTemplates.find((t) => t.id === tpl.id);
                if (full) addBausteinAsNewBlock(full);
              }}
              onClose={() => setShowMultiBausteinMode(false)}
            />
          </div>
        </div>
      )}

      {/* Seitliches Panel: Hilfe */}
      <div className="pointer-events-none fixed right-0 top-[18vh] z-40 hidden md:flex items-start">
        <aside
          className={`overflow-y-auto rounded-l-xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 shadow-2xl backdrop-blur-sm transition-all duration-300 ${
            showHelpPanel
              ? 'mr-2 translate-x-0 opacity-100 pointer-events-auto'
              : 'mr-0 translate-x-full opacity-0 pointer-events-none'
          }`}
          style={{
            width: helpPanelWidth,
            maxWidth: helpPanelWidth,
            maxHeight: '82vh',
          }}
          aria-hidden={!showHelpPanel}
        >
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Hilfe</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Sprachbefehle, Hotkeys und Bedienung</p>
            </div>
            <button
              type="button"
              className="btn btn-outline text-sm py-1.5 px-3 shrink-0"
              onClick={() => setShowHelpPanel(false)}
            >
              Schliessen
            </button>
          </div>
          <div className="px-4 py-3">
            <HelpPanel />
          </div>
        </aside>

        <button
          className="pointer-events-auto mt-[4.25rem] h-16 w-10 rounded-l-xl border border-r-0 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          onClick={() => {
            setShowHelpPanel((current) => {
              const next = !current;
              if (next) {
                setShowUpdatePanel(false);
              }
              return next;
            });
          }}
          title={showHelpPanel ? 'Hilfe schliessen' : 'Hilfe oeffnen'}
          aria-label={showHelpPanel ? 'Hilfe schliessen' : 'Hilfe oeffnen'}
          aria-expanded={showHelpPanel}
        >
          <span className="block text-[11px] leading-tight">Hilfe</span>
          <span className="block text-base leading-none mt-0.5">←</span>
        </button>
      </div>

      {/* Seitliches Panel: Updates */}
      <div className="pointer-events-none fixed right-0 top-[18vh] z-40 hidden md:flex items-start">
        <aside
          className={`overflow-y-auto rounded-l-xl border border-blue-200 dark:border-blue-900/60 bg-white/95 dark:bg-gray-900/95 shadow-2xl backdrop-blur-sm transition-all duration-300 ${
            showUpdatePanel
              ? 'mr-2 translate-x-0 opacity-100 pointer-events-auto'
              : 'mr-0 translate-x-full opacity-0 pointer-events-none'
          }`}
          style={{
            width: 'min(42rem, calc(100vw - 4.5rem))',
            maxWidth: 'calc(100vw - 4.5rem)',
            maxHeight: '82vh',
          }}
          aria-hidden={!showUpdatePanel}
        >
          <div className="px-4 py-3 border-b border-blue-200 dark:border-blue-900/60 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Updates</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Versionshinweise und neue Versionen</p>
            </div>
            <button
              type="button"
              className="btn btn-outline text-sm py-1.5 px-3 shrink-0"
              onClick={() => setShowUpdatePanel(false)}
            >
              Schliessen
            </button>
          </div>
          <div className="px-4 py-3">
            <UpdatePanel
              isOpen={showUpdatePanel}
              onRequestOpen={() => {
                setShowHelpPanel(false);
                setShowUpdatePanel(true);
              }}
              onAutoHide={() => setShowUpdatePanel(false)}
            />
          </div>
        </aside>

        <button
          className="pointer-events-auto h-16 w-10 rounded-l-xl border border-r-0 border-blue-200 dark:border-blue-900/60 bg-white dark:bg-gray-800 shadow-lg text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-gray-700"
          onClick={() => {
            setShowUpdatePanel((current) => {
              const next = !current;
              if (next) {
                setShowHelpPanel(false);
              }
              return next;
            });
          }}
          title={showUpdatePanel ? 'Updates schliessen' : 'Updates oeffnen'}
          aria-label={showUpdatePanel ? 'Updates schliessen' : 'Updates oeffnen'}
          aria-expanded={showUpdatePanel}
        >
          <span className="block text-[11px] leading-tight">Update</span>
          <span className="block text-base leading-none mt-0.5">{showUpdatePanel ? '→' : '←'}</span>
        </button>
      </div>

      {/* Custom Actions Manager Modal */}
      {showCustomActionsManager && (
        <CustomActionsManager onClose={() => setShowCustomActionsManager(false)} />
      )}

      {/* Templates-Manager Modal — Breite folgt liveEditorWidth */}
      {showTemplatesManager && mounted && createPortal(
        <div id="templates-manager-overlay" className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
          <div id="templates-manager-modal" className={`bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full my-8 flex flex-col h-[80vh] max-h-[calc(100vh-4rem)] min-h-[300px] resize-y overflow-auto ${templateEditorWidthClass}`}>
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
              <h2 className="font-semibold flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                {templateManagerMode === 'manage' ? 'Meine Textbausteine verwalten' : 'Neuen Textbaustein anlegen'}
              </h2>
              <button
                onClick={() => setShowTemplatesManager(false)}
                className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                title="Schließen"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18"/>
                  <path d="M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div id="templates-manager-body" className="p-4 overflow-y-auto flex flex-col flex-1 min-h-0">
              <TemplatesManager mode={templateManagerMode} />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Popup für Doppelklick auf ein Wort */}
      {wordPopup && (
        <WordActionPopup
          word={wordPopup.word}
          position={wordPopup.position}
          correction={wordPopup.correction}
          targetUsername={wordPopup.correction?.targetUsername || username || undefined}
          groupId={wordPopup.correction?.groupId}
          onClose={() => {
            const field = wordPopup.field;
            closeWordPopup();
            invalidateFieldCorrections(field);
          }}
        />
      )}

      {/* Download-Dialog für fehlenden Injector */}
      <InjectorDownloadDialog
        open={showInjectorDownloadDialog}
        errorMessage={injectorDownloadError}
        onClose={() => {
          setShowInjectorDownloadDialog(false);
          setInjectorDownloadError(null);
        }}
        onRetry={() => {
          void handleToggleLiveInject();
        }}
      />

      {isAdmin && (
        <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none flex justify-center px-3 pb-3">
          <div className="pointer-events-auto w-full max-w-6xl overflow-hidden rounded-xl border border-gray-200 bg-white/95 shadow-2xl backdrop-blur-sm dark:border-gray-700 dark:bg-gray-900/95">
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Admin-Konsole</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {adminConsoleTab === 'pipeline'
                    ? 'Pipeline-Ereignisse, Tastatur-Hotkeys, HID-Befehle'
                    : 'LLM-Prompt-Logs (letzte 100)'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Tab-Umschalter */}
                <div className="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
                  <button
                    type="button"
                    className={`px-2 py-1 text-xs ${adminConsoleTab === 'pipeline' ? 'bg-blue-600 text-white' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                    onClick={() => setAdminConsoleTab('pipeline')}
                  >
                    Pipeline
                  </button>
                  <button
                    type="button"
                    className={`px-2 py-1 text-xs ${adminConsoleTab === 'prompt-logs' ? 'bg-blue-600 text-white' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                    onClick={() => setAdminConsoleTab('prompt-logs')}
                  >
                    Prompt-Logs
                  </button>
                </div>
                {adminConsoleTab === 'pipeline' && (
                  <>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{adminConsoleEntries.length} Einträge</span>
                    <button
                      type="button"
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                      onClick={() => setAdminConsoleEntries([])}
                    >
                      Leeren
                    </button>
                  </>
                )}
                {adminConsoleTab === 'prompt-logs' && (
                  <>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{llmPromptLogs.length} Einträge</span>
                    <button
                      type="button"
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                      onClick={async () => {
                        await fetch('/api/admin/prompt-logs', { method: 'DELETE' });
                        setLlmPromptLogs([]);
                      }}
                    >
                      Leeren
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                  onClick={() => setAdminConsoleOpen((current) => !current)}
                  aria-expanded={adminConsoleOpen}
                >
                  {adminConsoleOpen ? 'Einklappen' : 'Ausklappen'}
                </button>
              </div>
            </div>
            {adminConsoleOpen && adminConsoleTab === 'pipeline' && (
              <div className="max-h-64 overflow-y-auto bg-gray-950 px-4 py-3 font-mono text-xs text-gray-100">
                {adminConsoleEntries.length === 0 ? (
                  <div className="text-gray-400">Noch keine registrierten Tastatur- oder HID-Ereignisse.</div>
                ) : (
                  <div className="space-y-2">
                    {adminConsoleEntries.map((entry) => (
                      <div key={entry.id} className="rounded border border-gray-800 bg-gray-900/80 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2 text-gray-300">
                          <span className="text-cyan-300">[{entry.timestamp}]</span>
                          <span className="uppercase tracking-wide text-amber-300">{entry.source}</span>
                          <span>{entry.message}</span>
                        </div>
                        <div className="mt-1 break-all text-gray-400">{entry.details}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {adminConsoleOpen && adminConsoleTab === 'prompt-logs' && (
              <div className="max-h-96 overflow-y-auto bg-gray-950 px-4 py-3 font-mono text-xs text-gray-100">
                {llmPromptLogs.length === 0 ? (
                  <div className="text-gray-400">
                    {llmPromptLogsLoading ? 'Lade Prompt-Logs...' : 'Noch keine LLM-Prompts geloggt. Starte eine Korrektur oder Diktat.'}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {llmPromptLogs.map((entry: any) => {
                      const isExpanded = expandedPromptLogIds.has(entry.id);
                      const createdAt = entry.timestamp
                        ? new Date(entry.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : '--';
                      return (
                        <div
                          key={entry.id}
                          className="rounded border border-gray-800 bg-gray-900/80 px-3 py-2 cursor-pointer"
                          onClick={() => {
                            setExpandedPromptLogIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(entry.id)) next.delete(entry.id);
                              else next.add(entry.id);
                              return next;
                            });
                          }}
                        >
                          {/* Kopfzeile */}
                          <div className="flex flex-wrap items-center gap-2 text-gray-300">
                            <span className="text-cyan-300">[{createdAt}]</span>
                            <span className={`px-1 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              entry.status === 'success' ? 'bg-green-900/60 text-green-300'
                                : entry.status === 'error' ? 'bg-red-900/60 text-red-300'
                                : 'bg-yellow-900/60 text-yellow-300'
                            }`}>
                              {entry.status || 'pending'}
                            </span>
                            <span className="text-fuchsia-300">{entry.endpoint}</span>
                            <span className="text-amber-300">{entry.provider}</span>
                            <span className="text-gray-400">/</span>
                            <span className="text-gray-400">{entry.model}</span>
                            {entry.durationMs > 0 && (
                              <span className="text-gray-400">({(entry.durationMs / 1000).toFixed(1)}s)</span>
                            )}
                            <span className="text-gray-500 ml-auto">{entry.username}</span>
                          </div>

                          {/* Detail-Infos (aufgeklappt) */}
                          {isExpanded && (
                            <div className="mt-2 space-y-2 border-t border-gray-800 pt-2">
                              {/* Error */}
                              {entry.errorMessage && (
                                <div className="rounded bg-red-900/30 px-2 py-1 text-red-300">
                                  ⚠ {entry.errorMessage}
                                </div>
                              )}

                              {/* System Prompt */}
                              <div>
                                <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">System Prompt ({entry.systemPrompt?.length || 0} Zeichen)</div>
                                <div className="rounded bg-gray-800/60 px-2 py-1 text-gray-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto text-[11px]"
                                  onClick={(e) => e.stopPropagation()}>
                                  {entry.systemPrompt || '(leer)'}
                                </div>
                              </div>

                              {/* User Message */}
                              <div>
                                <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">User Message ({entry.userMessage?.length || 0} Zeichen)</div>
                                <div className="rounded bg-gray-800/60 px-2 py-1 text-gray-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto text-[11px]"
                                  onClick={(e) => e.stopPropagation()}>
                                  {entry.userMessage || '(leer)'}
                                </div>
                              </div>

                              {/* Response Preview */}
                              {entry.responsePreview && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">Antwort (Auszug, {entry.responsePreview.length} Zeichen)</div>
                                  <div className="rounded bg-gray-800/60 px-2 py-1 text-emerald-300 whitespace-pre-wrap break-all max-h-32 overflow-y-auto text-[11px]"
                                    onClick={(e) => e.stopPropagation()}>
                                    {entry.responsePreview}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Nicht aufgeklappt: Zeige Preview */}
                          {!isExpanded && (entry.userMessage || entry.systemPrompt) && (
                            <div className="mt-1 text-gray-500 truncate text-[11px]">
                              {entry.userMessage
                                ? entry.userMessage.substring(0, 150).replace(/\n/g, ' ')
                                : entry.systemPrompt.substring(0, 150).replace(/\n/g, ' ')}
                              {(entry.userMessage?.length > 150 || entry.systemPrompt?.length > 150) && '…'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
