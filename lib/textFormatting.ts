/**
 * Programmatic text formatting for dictation control words.
 * Applied BEFORE LLM correction for consistent, deterministic results.
 */

import { buildPhoneticIndex, applyPhoneticCorrectionsDetailed } from './phoneticMatch';
import { applyDictionaryReplacementCase } from './replacementCase';
import { CONTROL_WORD_REPLACEMENTS } from '../formattings/control-words';
import { DELETE_PATTERNS } from '../formattings/delete-patterns';
import { NUMBER_WORDS } from '../formattings/number-words';
import { ONLINE_COMMAND_PATTERNS, OnlineCommandMatch, OnlineCommandType } from '../formattings/online-commands';
import { ABBREVIATIONS } from '../formattings/abbreviations';

// Dictionary entry interface (compatible with dictionaryDb.ts)
export interface DictionaryEntry {
  wrong: string;
  correct: string;
  addedAt?: string;
  useInPrompt?: boolean;  // Wort wird im Whisper initial_prompt verwendet
  matchStem?: boolean;    // Wortstamm-Matching aktivieren
  phoneticMinSimilarity?: number;
  scope?: 'private' | 'group';
  groupId?: number;
  groupName?: string;
}

export interface DictionaryCorrectionOperation {
  originalText: string;
  replacementText: string;
  dictionaryWrong: string;
  dictionaryCorrect: string;
  source: 'standard' | 'private' | 'group';
  matchType: 'exact' | 'stem' | 'phonetic';
  confidence?: number;
  similarity?: number;
  minSimilarity?: number;
  targetUsername?: string;
  groupId?: number;
  groupName?: string;
}

export interface PreprocessTranscriptionResult {
  text: string;
  operations: DictionaryCorrectionOperation[];
}

export interface PreprocessTranscriptionOptions {
  targetUsername?: string;
  dictionarySet?: 'alltag' | 'medical';
}

type DictionarySource = 'standard' | 'private' | 'group';

type AnnotatedDictionaryEntry = DictionaryEntry & {
  source: DictionarySource;
  targetUsername?: string;
};

export function applyDictionaryCorrections(text: string, entries: DictionaryEntry[], standardEntries?: { wrong: string; correct: string; phoneticMinSimilarity?: number }[]): string {
  return applyDictionaryCorrectionsDetailed(text, entries, standardEntries).text;
}

export function applyDictionaryCorrectionsDetailed(
  text: string,
  entries: DictionaryEntry[],
  standardEntries?: { wrong: string; correct: string; phoneticMinSimilarity?: number }[],
  options?: PreprocessTranscriptionOptions
): PreprocessTranscriptionResult {
  if (!text) {
    return { text, operations: [] };
  }

  const annotatedUserEntries: AnnotatedDictionaryEntry[] = (entries ?? []).map((entry) => ({
    ...entry,
    source: entry.scope === 'group' ? 'group' : 'private',
    targetUsername: entry.scope === 'group' ? undefined : options?.targetUsername,
  }));
  const annotatedStandardEntries: AnnotatedDictionaryEntry[] = (standardEntries ?? []).map((entry) => ({
    ...entry,
    source: 'standard',
  }));

  // Merge mit Standard-Wörterbuch (aus DB wenn vorhanden, sonst hardcodiert)
  // Typisiert lokal, damit source/targetUsername der annotierten Einträge erhalten bleiben.
  const userWrongWords = new Set(annotatedUserEntries.map((entry) => entry.wrong.toLowerCase()));
  const mergedEntries: AnnotatedDictionaryEntry[] = [
    ...annotatedUserEntries,
    ...annotatedStandardEntries.filter((entry) => !userWrongWords.has(entry.wrong.toLowerCase())),
  ];
  let result = text;
  let replacementCount = 0;
  let stemReplacementCount = 0;
  const operations: DictionaryCorrectionOperation[] = [];

  // Sort entries by length of wrong word (longest first) to avoid partial replacements
  const sortedEntries = [...mergedEntries].sort((a, b) => b.wrong.length - a.wrong.length);

  for (const entry of sortedEntries) {
    if (!entry.wrong || !entry.correct) continue;
    
    // Escape special regex characters in the wrong word
    const escapedWrong = entry.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedCorrect = entry.correct;
    
    if ('matchStem' in entry && entry.matchStem) {
      // STEM MATCHING: Also match when wrong word appears as prefix in compound words
      // Match: "Schole" in "Scholezystitis", "Scholedochus", "Scholestase"
      // Pattern: word boundary at start, then the wrong word, followed by more letters
      
      // First: Match standalone words (exact match)
      const standaloneRegex = new RegExp(`(?<![A-ZÄÖÜa-zäöüß])${escapedWrong}(?![A-ZÄÖÜa-zäöüß])`, 'gi');
      result = result.replace(standaloneRegex, (match) => {
        const replacement = applyDictionaryReplacementCase(match, escapedCorrect);
        if (replacement === match) return match;
        replacementCount++;
        operations.push({
          originalText: match,
          replacementText: replacement,
          dictionaryWrong: entry.wrong,
          dictionaryCorrect: entry.correct,
          source: entry.source,
          matchType: 'exact',
          targetUsername: entry.targetUsername,
          groupId: entry.groupId,
          groupName: entry.groupName,
        });
        return replacement;
      });
      
      // Second: Match as prefix in compound words (wrong word followed by more letters)
      // This matches "Scholezystitis" and replaces "Schole" with "Chole" -> "Cholezystitis"
      const stemRegex = new RegExp(`(?<![A-ZÄÖÜa-zäöüß])${escapedWrong}([A-ZÄÖÜa-zäöüß]+)`, 'gi');
      result = result.replace(stemRegex, (match, suffix) => {
        // Preserve case of the original stem
        const correctedStem = applyDictionaryReplacementCase(match.slice(0, entry.wrong.length), escapedCorrect);
        const replacement = correctedStem + suffix;
        if (replacement === match) return match;
        stemReplacementCount++;
        operations.push({
          originalText: match,
          replacementText: replacement,
          dictionaryWrong: entry.wrong,
          dictionaryCorrect: entry.correct,
          source: entry.source,
          matchType: 'stem',
          targetUsername: entry.targetUsername,
          groupId: entry.groupId,
          groupName: entry.groupName,
        });
        return replacement;
      });
    } else {
      // Standard word boundary matching (no stem matching)
      const regex = new RegExp(`(?<![A-ZÄÖÜa-zäöüß])${escapedWrong}(?![A-ZÄÖÜa-zäöüß])`, 'gi');
      
      result = result.replace(regex, (match) => {
        const replacement = applyDictionaryReplacementCase(match, escapedCorrect);
        if (replacement === match) return match;
        replacementCount++;
        operations.push({
          originalText: match,
          replacementText: replacement,
          dictionaryWrong: entry.wrong,
          dictionaryCorrect: entry.correct,
          source: entry.source,
          matchType: 'exact',
          targetUsername: entry.targetUsername,
          groupId: entry.groupId,
          groupName: entry.groupName,
        });
        return replacement;
      });
    }
  }

  if (replacementCount > 0 || stemReplacementCount > 0) {
    console.log(`[Dictionary] Applied ${replacementCount} direct + ${stemReplacementCount} stem corrections`);
  }

  // Pass 2: Phonetisches Matching für Wörter die das exakte Matching verpasst hat
  const phoneticIndex = buildPhoneticIndex(mergedEntries);
  if (phoneticIndex.allEntries.length > 0) {
    const phoneticResult = applyPhoneticCorrectionsDetailed(result, phoneticIndex);
    result = phoneticResult.text;
    operations.push(...phoneticResult.operations);
  }

  return { text: result, operations };
}


/**
 * Apply formatting control words programmatically.
 * This should be called BEFORE sending text to LLM for correction.
 * 
 * @param text - Raw transcription text with spoken control words
 * @returns Text with control words replaced by actual formatting
 */
/**
 * Result of control word application with statistics
 */
export interface ControlWordResult {
  text: string;
  stats: {
    paragraphs: number;  // "neuer Absatz", "Absatz"
    lineBreaks: number;  // "neue Zeile"
    bulletPoints: number; // "Anstrich", "nächster Anstrich"
    punctuation: number; // "Punkt", "Komma", "Doppelpunkt" etc.
    brackets: number;    // "Klammer auf/zu"
    deletions: number;   // "lösche das letzte Wort" etc.
    enumerations: number; // "Punkt eins", "Nächster Punkt" etc.
    total: number;
  };
}

/**
 * Online-Modus: aggressivere Steuerwort-Ersetzung für bereits segmentierte Utterances.
 * In VAD-/Realtime-Pfaden sind einzelne Utterances deutlich eher echte Befehle als Fließtext,
 * deshalb werden hier auch Punkt/Komma/Bindestrich programmgesteuert umgesetzt.
 */
export function applyOnlineDictationControlWords(text: string): string {
  if (!text) return text;

  let result = applyFormattingControlWords(text);

  const liveOnlyReplacements: Array<{ pattern: RegExp; replacement: string }> = [
    { pattern: /\b(komma|beistrich)\b/gi, replacement: ',' },
    { pattern: /\bbindestrich\b/gi, replacement: '-' },
    { pattern: /\bpunkt\b/gi, replacement: '.' },
  ];

  for (const { pattern, replacement } of liveOnlyReplacements) {
    result = result.replace(pattern, replacement);
  }

  // Cleanup: Entferne überflüssige Kommas, die nach Doppelpunkt, Semikolon, Frage- oder
  // Ausrufezeichen stehen (z.B. "Doppelpunkt Komma" → ":,", bereinigt zu ":").
  result = result.replace(/([:;?!])\s*,/g, '$1');

  return cleanupFormattingPreserveEdgeBreaks(result);
}

/**
 * Wendet Löschbefehle auf einen bereits kombinierten Text an.
 * Dadurch funktionieren Befehle wie "lösche den letzten Satz" auch dann,
 * wenn der zu löschende Inhalt in einer vorherigen Utterance liegt.
 */
export function applyDeleteCommands(text: string): string {
  if (!text) return text;
  return cleanupFormatting(handleDeleteCommands(text));
}

function isStandaloneDeleteCommand(text: string): boolean {
  if (!text) return false;

  const normalized = text
    .toLowerCase()
    .replace(/[.,;:!?-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const standaloneDeletePatterns = [
    /^lösche\s*(?:das\s*)?letzte(?:s)?\s*wort$/,
    /^letztes\s*wort\s*löschen$/,
    /^wort\s*löschen$/,
    /^wort\s*streichen$/,
    /^streiche\s*wort$/,
    /^lösche\s*(?:den\s*)?letzten\s*satz$/,
    /^letzten\s*satz\s*löschen$/,
    /^satz\s*löschen$/,
    /^lösche\s*(?:den\s*)?letzten\s*absatz$/,
    /^letzten\s*absatz\s*löschen$/,
  ];

  return standaloneDeletePatterns.some((pattern) => pattern.test(normalized));
}

// OnlineCommandType, ONLINE_COMMAND_PATTERNS importiert aus formattings/online-commands.ts

function findNextOnlineCommand(text: string, startIndex: number): OnlineCommandMatch | null {
  let bestMatch: OnlineCommandMatch | null = null;

  for (const { type, pattern } of ONLINE_COMMAND_PATTERNS) {
    const slice = text.slice(startIndex);
    const match = slice.match(pattern);
    if (!match || match.index === undefined) continue;

    const absoluteIndex = startIndex + match.index;
    const candidate: OnlineCommandMatch = {
      type,
      index: absoluteIndex,
      length: match[0].length,
    };

    if (!bestMatch || absoluteIndex < bestMatch.index) {
      bestMatch = candidate;
      continue;
    }

    if (bestMatch && absoluteIndex === bestMatch.index && candidate.length > bestMatch.length) {
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

function appendOnlineText(currentText: string, textSegment: string): string {
  if (!textSegment.trim()) return currentText;
  const normalizedSegment = /\n$/.test(currentText) ? textSegment.replace(/^\s+/, '') : textSegment;
  const formattedSegment = applyOnlineDictationControlWords(normalizedSegment);
  if (!formattedSegment.trim()) return currentText;
  return combineFormattedText(currentText, formattedSegment);
}

function applyOnlineCommand(currentText: string, type: OnlineCommandType): string {
  switch (type) {
    case 'deleteWord':
      return deleteLastWordFromText(currentText);
    case 'deleteSentence':
      return deleteLastSentenceFromText(currentText);
    case 'deleteParagraph':
      return deleteLastParagraphFromText(currentText);
    case 'lineBreak':
      return `${currentText.replace(/[^\S\n]*$/, '')}\n`;
    case 'paragraphBreak':
      return `${currentText.replace(/[^\S\n]*$/, '')}\n\n`;
    case 'bulletPoint':
      return `${currentText.replace(/[^\S\n]*$/, '')}\n- `;
    case 'comma':
      return cleanupFormatting(`${currentText.replace(/[^\S\n]*$/, '')},`);
    case 'period':
      return cleanupFormatting(`${currentText.replace(/[^\S\n]*$/, '')}.`);
    case 'dash':
      return cleanupFormattingPreserveTrailingBreaks(`${currentText}${currentText ? ' ' : ''}-`);
    default:
      return currentText;
  }
}

function cleanupFormattingPreserveTrailingBreaks(text: string): string {
  if (!text) return text;

  const trailingBreaks = text.match(/\n+$/)?.[0] ?? '';
  const cleaned = cleanupFormatting(text);
  if (!trailingBreaks) return cleaned;
  return `${cleaned}${trailingBreaks}`;
}

function cleanupFormattingPreserveEdgeBreaks(text: string): string {
  if (!text) return text;

  const leadingBreaks = text.match(/^\n+/)?.[0] ?? '';
  const trailingBreaks = text.match(/\n+$/)?.[0] ?? '';
  const cleaned = cleanupFormatting(text);
  const normalizedLeadingBreaks = leadingBreaks.replace(/\n{3,}/g, '\n\n');
  const normalizedTrailingBreaks = trailingBreaks.replace(/\n{3,}/g, '\n\n');

  if (!cleaned) {
    const edgeBreaks = `${normalizedLeadingBreaks}${normalizedTrailingBreaks}`.replace(/\n{3,}/g, '\n\n');
    return edgeBreaks;
  }

  return `${normalizedLeadingBreaks}${cleaned}${normalizedTrailingBreaks}`;
}

function deleteLastWordFromText(text: string): string {
  return cleanupFormatting(text.replace(/\s*\S+\s*$/, ''));
}

function deleteLastSentenceFromText(text: string): string {
  const withoutLastSentence = text.replace(/\s*[^.!?]*[.!?]\s*$/, '');
  if (withoutLastSentence !== text) {
    return cleanupFormatting(withoutLastSentence);
  }
  return cleanupFormatting(text.replace(/[^\n]*$/, ''));
}

function deleteLastParagraphFromText(text: string): string {
  const lastParagraphBreak = text.lastIndexOf('\n\n');
  if (lastParagraphBreak > 0) {
    return cleanupFormatting(text.substring(0, lastParagraphBreak));
  }
  return '';
}

function applyStandaloneDeleteCommand(currentText: string, commandText: string): string {
  const normalized = commandText
    .toLowerCase()
    .replace(/[.,;:!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/wort\s*streichen|streiche\s*wort|wort\s*löschen|lösche\s*(?:das\s*)?letzte(?:s)?\s*wort|letztes\s*wort\s*löschen/.test(normalized)) {
    return deleteLastWordFromText(currentText);
  }
  if (/lösche\s*(?:den\s*)?letzten\s*satz|letzten\s*satz\s*löschen|satz\s*löschen/.test(normalized)) {
    return deleteLastSentenceFromText(currentText);
  }
  if (/lösche\s*(?:den\s*)?letzten\s*absatz|letzten\s*absatz\s*löschen/.test(normalized)) {
    return deleteLastParagraphFromText(currentText);
  }

  return cleanupFormatting(currentText);
}

/**
 * Wendet eine einzelne Online-Utterance auf den bereits aufgebauten Text an.
 * Reine Löschbefehle werden NICHT angehängt, sondern direkt auf den vorhandenen
 * Text angewendet. Dadurch löscht "lösche den letzten Satz" zuverlässig den
 * vorherigen Satz statt den aktuellen Befehls-Chunk.
 */
export interface OnlineUtteranceApplicationDebugStep {
  kind: 'append' | 'command';
  input: string;
  changed: boolean;
  commandType?: OnlineCommandType;
}

export function applyOnlineUtteranceToText(
  currentText: string,
  utteranceText: string,
  onDebugStep?: (step: OnlineUtteranceApplicationDebugStep) => void
): string {
  if (!utteranceText.trim()) {
    if (/\n/.test(utteranceText)) {
      const trailingBreaks = (utteranceText.match(/\n+/g) || []).join('').replace(/\n{3,}/g, '\n\n');
      if (trailingBreaks) {
        return cleanupFormattingPreserveEdgeBreaks(`${currentText.replace(/[^\S\n]*$/, '')}${trailingBreaks}`);
      }
    }

    return cleanupFormatting(currentText);
  }

  let result = currentText;
  let cursor = 0;

  while (cursor < utteranceText.length) {
    const nextCommand = findNextOnlineCommand(utteranceText, cursor);
    if (!nextCommand) {
      const input = utteranceText.slice(cursor);
      const before = result;
      result = appendOnlineText(result, input);
      onDebugStep?.({
        kind: 'append',
        input,
        changed: result !== before,
      });
      break;
    }

    if (nextCommand.index > cursor) {
      const input = utteranceText.slice(cursor, nextCommand.index);
      const before = result;
      result = appendOnlineText(result, input);
      onDebugStep?.({
        kind: 'append',
        input,
        changed: result !== before,
      });
    }

    const commandText = utteranceText.slice(nextCommand.index, nextCommand.index + nextCommand.length);
    const before = result;
    result = applyOnlineCommand(result, nextCommand.type);
    onDebugStep?.({
      kind: 'command',
      input: commandText,
      commandType: nextCommand.type,
      changed: result !== before,
    });
    cursor = nextCommand.index + nextCommand.length;
  }

  return cleanupFormattingPreserveEdgeBreaks(result);
}

/**
 * Kombiniert zwei bereits formatierte Textstücke und bereinigt Leerzeichen/
 * Satzzeichen an der Fuge. Das verhindert Artefakte wie "Text ," oder "Text \n\n".
 */
export function combineFormattedText(existingText: string, incomingText: string): string {
  if (!existingText) return cleanupFormattingPreserveEdgeBreaks(incomingText);
  if (!incomingText) return cleanupFormattingPreserveEdgeBreaks(existingText);
  const separator = existingText.endsWith(' ') || existingText.endsWith('\n') ? '' : ' ';
  return cleanupFormattingPreserveEdgeBreaks(`${existingText}${separator}${incomingText}`);
}

function makeId(...parts: string[]): string {
  return parts[0].toLowerCase().replace(/\s+/g, '-').replace(/[^a-zäöüß0-9-]/g, '');
}

/**
 * Apply formatting control words programmatically.
 * @param disabledIds - Optional set of rule IDs to skip (from user preferences)
 */
export function applyFormattingControlWords(text: string, disabledIds?: Set<string>): string {
  const result = applyFormattingControlWordsWithStats(text, disabledIds);
  return result.text;
}

/**
 * Apply formatting control words and return statistics about what was applied.
 * Use this version when you need to log/display the results.
 */
export function applyFormattingControlWordsWithStats(text: string, disabledIds?: Set<string>): ControlWordResult {
  if (!text) return { text, stats: { paragraphs: 0, lineBreaks: 0, bulletPoints: 0, punctuation: 0, brackets: 0, deletions: 0, enumerations: 0, total: 0 } };
  
  let result = text;
  const stats = { paragraphs: 0, lineBreaks: 0, bulletPoints: 0, punctuation: 0, brackets: 0, deletions: 0, enumerations: 0, total: 0 };
  
  // Step 0: Handle enumeration commands first (before other replacements)
  const enumResult = handleEnumerationCommands(result);
  result = enumResult.text;
  stats.enumerations = enumResult.count;
  stats.total += enumResult.count;
  
  // Step 1: Apply simple replacements and count
  for (const entry of CONTROL_WORD_REPLACEMENTS) {
    // Skip disabled rules
    if (disabledIds?.has(makeId(...entry.commands))) continue;
    const { pattern, replacement } = entry;
    const matches = result.match(pattern);
    if (matches) {
      const count = matches.length;
      stats.total += count;
      
      // Categorize the match
      const patternStr = pattern.source.toLowerCase();
      if (patternStr.includes('anstrich')) {
        stats.bulletPoints += count;
      } else if (patternStr.includes('absatz') || patternStr.includes('zeile') || patternStr.includes('eingerückt') || patternStr.includes('einrücken') || patternStr.includes('rücke')) {
        if (patternStr.includes('zeile')) {
          stats.lineBreaks += count;
        } else if (patternStr.includes('absatz')) {
          stats.paragraphs += count;
        } else {
          stats.lineBreaks += count; // eingerückt/rücke ein/einrücken zählen als Zeilenumbruch
        }
      } else if (patternStr.includes('klammer')) {
        stats.brackets += count;
      } else {
        stats.punctuation += count;
      }
    }
    // Handle both string and function replacements
    if (typeof replacement === 'function') {
      result = result.replace(pattern, replacement as (...args: string[]) => string);
    } else {
      result = result.replace(pattern, replacement);
    }
  }
  
  // Step 2: Handle delete commands
  const beforeDelete = result;
  result = handleDeleteCommands(result);
  if (beforeDelete !== result) {
    stats.deletions++;
    stats.total++;
  }
  
  // Step 2.5: Bedingte "nächstes"-Ersetzung
  // "nächstes" alleinstehend → Bullet NUR wenn vorher eine der Langformen im
  // Originaltext vorkam ("nächstes darunter", "nächstes eingerückt" usw.).
  // In diesem Kontext ist es eine Verkürzung des Aufzählungsbefehls.
  // Ohne vorherige Langform ist "nächstes" ein normales Wort → nicht ersetzen.
  const hadMultiWordNaechstes = /nächstes\s+(?:darunter|eingerückt)/i.test(text);
  if (hadMultiWordNaechstes) {
    const beforeNaechstes = result;
    result = result.replace(/[.,;\s]*\bnächstes\b[.,;\s]*/gi, '\n- ');
    if (result !== beforeNaechstes) {
      const naechstesCount = (beforeNaechstes.match(/\bnächstes\b/gi) || []).length;
      stats.bulletPoints += naechstesCount;
      stats.total += naechstesCount;
    }
  }
  
  // Step 3: Clean up formatting
  result = cleanupFormattingPreserveEdgeBreaks(result);
  
  // Log if any control words were applied
  if (stats.total > 0) {
    const details: string[] = [];
    if (stats.paragraphs > 0) details.push(`${stats.paragraphs}x Absatz`);
    if (stats.lineBreaks > 0) details.push(`${stats.lineBreaks}x Zeile`);
    if (stats.bulletPoints > 0) details.push(`${stats.bulletPoints}x Anstrich`);
    if (stats.punctuation > 0) details.push(`${stats.punctuation}x Satzzeichen`);
    if (stats.brackets > 0) details.push(`${stats.brackets}x Klammer`);
    if (stats.deletions > 0) details.push(`${stats.deletions}x Löschung`);
    if (stats.enumerations > 0) details.push(`${stats.enumerations}x Aufzählung`);
    console.log(`[ControlWords] ${stats.total} Steuerbefehle erkannt: ${details.join(', ')}`);
  }
  
  return { text: result, stats };
}

/**
 * Wendet medizinische Abkürzungen deterministisch an (z.B. "Milligramm" → "mg").
 * @param disabledIds - Optional deaktivierte Abkürzungs-IDs (aus Benutzereinstellungen)
 */
export function applyAbbreviations(text: string, disabledIds?: Set<string>): string {
  if (!text) return text;
  let result = text;
  for (const entry of ABBREVIATIONS) {
    if (disabledIds?.has(entry.id)) continue;
    result = result.replace(entry.pattern, entry.replacement);
  }
  return result;
}

/**
 * Handle enumeration/list commands
 * Patterns:
 * - "Aufzählung beginnen/starten" (optional start marker, removed)
 * - "Punkt eins/zwei/drei..." → "1./2./3. ..."
 * - "Nächster Punkt" → next number in sequence
 * - "Aufzählung beenden" (end marker, removed)
 */
function handleEnumerationCommands(text: string): { text: string; count: number } {
  if (!text) return { text, count: 0 };
  
  let result = text;
  let count = 0;
  
  // Step 1: Remove optional start markers
  const startPatterns = [
    /\baufzählung\s*beginnen\b[.,;:\s]*/gi,
    /\baufzählung\s*starten\b[.,;:\s]*/gi,
    /\bliste\s*beginnen\b[.,;:\s]*/gi,
    /\bliste\s*starten\b[.,;:\s]*/gi,
  ];
  
  for (const pattern of startPatterns) {
    if (pattern.test(result)) {
      result = result.replace(pattern, '\n');
      count++;
    }
  }
  
  // Step 2: Remove end markers
  const endPatterns = [
    /\baufzählung\s*beenden\b[.,;:\s]*/gi,
    /\baufzählung\s*ende\b[.,;:\s]*/gi,
    /\bliste\s*beenden\b[.,;:\s]*/gi,
    /\bliste\s*ende\b[.,;:\s]*/gi,
  ];
  
  for (const pattern of endPatterns) {
    if (pattern.test(result)) {
      result = result.replace(pattern, '\n');
      count++;
    }
  }
  
  // Step 3: Process all enumeration commands sequentially from left to right
  // This ensures "Nächster Punkt" correctly follows previous numbered items
  
  // Build combined pattern to find all enumeration commands
  const numberWordPattern = Object.keys(NUMBER_WORDS).join('|');
  
  // Pattern for "Punkt [number word]" or "Punkt [digit]" or "Nächster Punkt" etc.
  // Using 'gi' flags for global case-insensitive matching
  const allEnumPatterns = new RegExp(
    `\\bpunkt\\s*(${numberWordPattern}|\\d+)\\b[.,;:\\s]*` +
    `|\\bnächster\\s*punkt\\b[.,;:\\s]*` +
    `|\\bnächster\\s*listenpunkt\\b[.,;:\\s]*` +
    `|\\bweiterer\\s*punkt\\b[.,;:\\s]*` +
    `|\\berstens\\b[.,;:\\s]*` +
    `|\\bzweitens\\b[.,;:\\s]*` +
    `|\\bdrittens\\b[.,;:\\s]*` +
    `|\\bviertens\\b[.,;:\\s]*` +
    `|\\bfünftens\\b[.,;:\\s]*` +
    `|\\bsechstens\\b[.,;:\\s]*` +
    `|\\bsiebentens\\b[.,;:\\s]*` +
    `|\\bsiebtens\\b[.,;:\\s]*` +
    `|\\bachtens\\b[.,;:\\s]*` +
    `|\\bneuntens\\b[.,;:\\s]*` +
    `|\\bzehntens\\b[.,;:\\s]*`,
    'gi'
  );
  
  // Ordinal word to number mapping
  const ordinalToNumber: Record<string, number> = {
    'erstens': 1, 'zweitens': 2, 'drittens': 3, 'viertens': 4, 'fünftens': 5,
    'sechstens': 6, 'siebentens': 7, 'siebtens': 7, 'achtens': 8, 'neuntens': 9, 'zehntens': 10,
  };
  
  let currentNumber = 0;
  
  result = result.replace(allEnumPatterns, (match) => {
    const matchLower = match.toLowerCase().trim();
    count++;
    
    // Check if it's "Punkt [number]"
    // Use \w+ instead of \S+ to avoid capturing trailing punctuation like commas
    const punktMatch = match.match(/\bpunkt\s*(\w+)/i);
    if (punktMatch) {
      const numPart = punktMatch[1].toLowerCase();
      // Try as number word
      if (NUMBER_WORDS[numPart]) {
        currentNumber = NUMBER_WORDS[numPart];
        return `\n${currentNumber}. `;
      }
      // Try as digit
      const digit = parseInt(numPart, 10);
      if (!isNaN(digit)) {
        currentNumber = digit;
        return `\n${currentNumber}. `;
      }
    }
    
    // Check if it's an ordinal (erstens, zweitens, etc.)
    for (const [ordinal, num] of Object.entries(ordinalToNumber)) {
      if (matchLower.startsWith(ordinal)) {
        currentNumber = num;
        return `\n${currentNumber}. `;
      }
    }
    
    // Check if it's "Nächster Punkt" or similar
    if (/nächster\s+punkt|nächster\s+listenpunkt|weiterer\s+punkt/i.test(match)) {
      currentNumber++;
      return `\n${currentNumber}. `;
    }
    
    // Fallback - shouldn't happen
    return match;
  });
  
  return { text: result, count };
}

/**
 * Handle "delete last word/sentence/paragraph" commands
 */
function handleDeleteCommands(text: string): string {
  let result = text;
  
  for (const { pattern, type } of DELETE_PATTERNS) {
    let match;
    // Reset the regex for each iteration
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(result)) !== null) {
      const deletePosition = match.index;
      const deleteCommand = match[0];
      const textBefore = result.substring(0, deletePosition);
      const textAfter = result.substring(deletePosition + deleteCommand.length);
      
      let newTextBefore: string;
      
      switch (type) {
        case 'word':
          // Delete the last word before the command
          newTextBefore = textBefore.replace(/\s*\S+\s*$/, '');
          break;
        case 'sentence':
          // Delete the last sentence (ending with . ! ?)
          newTextBefore = textBefore.replace(/[^.!?]*[.!?]\s*$/, '');
          // If no sentence found, try to find any text after last paragraph break
          if (newTextBefore === textBefore) {
            newTextBefore = textBefore.replace(/[^\n]*$/, '');
          }
          break;
        case 'paragraph':
          // Delete the last paragraph (text after last double newline or from start)
          const lastParagraphBreak = textBefore.lastIndexOf('\n\n');
          if (lastParagraphBreak > 0) {
            newTextBefore = textBefore.substring(0, lastParagraphBreak);
          } else {
            // No paragraph break found, delete everything
            newTextBefore = '';
          }
          break;
        default:
          newTextBefore = textBefore;
      }
      
      result = newTextBefore + textAfter;
      // Reset regex to search from beginning after modification
      regex.lastIndex = 0;
    }
  }
  
  return result;
}

/**
 * Clean up formatting artifacts
 */
function cleanupFormatting(text: string): string {
  return text
    // Remove multiple spaces (but keep newlines)
    .replace(/[^\S\n]+/g, ' ')
    // Remove space before punctuation
    .replace(/[^\S\n]+([.,;:!?)])/g, '$1')
    // Remove space after colon before digits (Uhrzeit-Korrektur: "10: 15" → "10:15")
    .replace(/: +(?=\d)/g, ':')
    // Add space after punctuation if missing (but not before newline or opening bracket)
    .replace(/([.,;:!?])(?=[A-ZÄÖÜa-zäöüß])/g, '$1 ')
    // Remove space after opening parenthesis
    .replace(/\(\s+/g, '(')
    // Remove space before closing parenthesis
    .replace(/\s+\)/g, ')')
    // Add space after closing parenthesis if followed by letter
    .replace(/\)(?=[A-ZÄÖÜa-zäöüß])/g, ') ')
    // Remove comma before opening parenthesis: ", (" → " ("
    .replace(/,\s*\(/g, ' (')
    // Remove comma after closing parenthesis if followed by comma: "), " → ") " - no double comma
    .replace(/\),\s*,/g, '),')
    // Max 2 newlines (one empty line)
    .replace(/\n{3,}/g, '\n\n')
    // Remove trailing whitespace from lines
    .replace(/[^\S\n]+$/gm, '')
    // Trim overall
    .trim();
}

/**
 * Remove filler words like "ähm", "äh", "hm" from text
 */
export function removeFillerWords(text: string): string {
  if (!text) return text;
  
  return text
    // Common German filler words (standalone)
    .replace(/\b(ähm|äh|hm+|mhm+|öhm|eh|ehm)\b\s*/gi, '')
    // Clean up any double spaces created
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Erkennt und repariert Wörter bei denen der gesprochene Befehl "Punkt"
 * versehentlich mit dem vorherigen Wort zusammengezogen wurde.
 *
 * Beispiele:
 *   "stehenpunkt."  → "stehen. "
 *   "Unazitpunkt."  → "Unazit. "  (später korrigiert phonetisches Matching "Unazit"→"Unazid")
 *   "Diespunkt ist" → "Dies. ist" (wenn "Dies" im Wörterbuch)
 *
 * Zwei Erkennungsregeln:
 *   1. Das Wort wird von einem automatischen Punkt gefolgt → hohe Sicherheit, immer trennen.
 *   2. Der Wortstamm (ohne "punkt") ist ein bekannter Wörterbuch-Eintrag → trennen.
 *
 * @param text - Rohtext aus der Transkription
 * @param knownCorrectWords - Set von bekannten korrekten Schreibweisen aus dem Wörterbuch
 * @returns Bereinigter Text und ausgeführte Operationen
 */
export function fixConcatenatedPunkt(
  text: string,
  knownCorrectWords?: Set<string>
): { text: string; operations: DictionaryCorrectionOperation[] } {
  if (!text) return { text, operations: [] };

  const operations: DictionaryCorrectionOperation[] = [];

  // Bekannte Wörter die legitimerweise auf "punkt" enden (keine Zusammenziehung)
  const legitimatePunktWords = new Set([
    'zeit', 'stand', 'gesichts', 'schwer', 'dreh', 'angel', 'angriffs',
    'ansatz', 'ausgangs', 'blick', 'brenn', 'eck', 'end', 'fix', 'flucht',
    'flieh', 'gegen', 'haupt', 'hinter', 'höhe', 'kern', 'knack', 'kristallisations',
    'markierungs', 'mittel', 'null', 'setz', 'siede',
    'stütz', 'tief', 'treff', 'umkehr', 'verknüpfungs', 'wahl', 'wende',
    'wolken',
  ]);

  // Regex: Wort das mit "punkt" endet (case-insensitive), aber mind. 3 Zeichen Stamm.
  // Gruppe 1: Wortstamm vor "punkt", Gruppe 2: nachfolgender Whitespace+Punkt oder Satzende.
  const concatenatedPunktRegex = /\b([A-ZÄÖÜa-zäöüß]{2,})punkt(\s*\.\s*|\s*\.$|$)/gi;

  const result = text.replace(concatenatedPunktRegex, (match, stem: string, trailing: string, offset: number) => {
    const stemLower = stem.toLowerCase();

    // Überspringe legitime Zusammensetzungen mit "punkt"
    if (legitimatePunktWords.has(stemLower)) return match;

    const hasTrailingPeriod = trailing.includes('.');

    // Regel 1: Automatischer Punkt folgt → hohe Sicherheit, immer trennen
    if (hasTrailingPeriod) {
      const replacement = stem + '. ';
      operations.push({
        originalText: match.trim(),
        replacementText: replacement.trim(),
        dictionaryWrong: stem + 'punkt',
        dictionaryCorrect: stem + '.',
        source: 'standard',
        matchType: 'exact',
      });
      return replacement;
    }

    // Regel 2: Wortstamm ist im Wörterbuch bekannt → trennen
    if (knownCorrectWords && knownCorrectWords.has(stemLower)) {
      const replacement = stem + '. ';
      operations.push({
        originalText: match.trim(),
        replacementText: replacement.trim(),
        dictionaryWrong: stem + 'punkt',
        dictionaryCorrect: stem + '.',
        source: 'standard',
        matchType: 'exact',
      });
      return replacement;
    }

    // Kein Match → unverändert lassen
    return match;
  });

  if (operations.length > 0) {
    console.log(`[PunktConcat] Fixed ${operations.length} concatenated "punkt" word(s):`,
      operations.map(o => `"${o.dictionaryWrong}"→"${o.dictionaryCorrect}"`).join(', '));
  }

  return { text: result, operations };
}

/**
 * Combined preprocessing: apply formatting + remove fillers + dictionary corrections
 * Use this before sending to LLM
 * 
 * @param text - Raw transcription text
 * @param dictionaryEntries - Optional dictionary entries for user-specific corrections
 */
export function preprocessTranscription(text: string, dictionaryEntries?: DictionaryEntry[], standardEntries?: { wrong: string; correct: string; phoneticMinSimilarity?: number }[]): string {
  return preprocessTranscriptionDetailed(text, dictionaryEntries, standardEntries).text;
}

export function preprocessTranscriptionDetailed(
  text: string,
  dictionaryEntries?: DictionaryEntry[],
  standardEntries?: { wrong: string; correct: string; phoneticMinSimilarity?: number }[],
  options?: PreprocessTranscriptionOptions,
  disabledAbbreviationIds?: Set<string>
): PreprocessTranscriptionResult {
  if (!text) return { text, operations: [] };
  
  let result = text;
  const operations: DictionaryCorrectionOperation[] = [];
  
  // Step 1: Remove filler words
  result = removeFillerWords(result);
  
  // Step 2: Apply formatting control words (logs automatically if any found)
  result = applyFormattingControlWords(result);
  
  // Step 2b: Fix concatenated "punkt" words (z.B. "stehenpunkt." → "stehen. ")
  // Läuft NACH den control words (die standalone "Punkt" behandeln) und VOR
  // den dictionary corrections (die den abgetrennten Stamm phonetisch korrigieren).
  const hasDictionaryEntries = (dictionaryEntries?.length ?? 0) > 0;
  const hasStandardEntries = (standardEntries?.length ?? 0) > 0;
  if (hasDictionaryEntries || hasStandardEntries) {
    const allCorrectWords = new Set<string>();
    for (const e of (dictionaryEntries ?? [])) {
      allCorrectWords.add(e.correct.toLowerCase());
    }
    for (const e of (standardEntries ?? [])) {
      allCorrectWords.add(e.correct.toLowerCase());
    }
    const punktResult = fixConcatenatedPunkt(result, allCorrectWords);
    result = punktResult.text;
    operations.push(...punktResult.operations);
  } else {
    // Auch ohne Wörterbuch: Regel 1 (automatischer Punkt danach) greift trotzdem
    const punktResult = fixConcatenatedPunkt(result);
    result = punktResult.text;
    operations.push(...punktResult.operations);
  }
  
  // Step 3: Apply dictionary corrections (if entries provided, logs automatically if any applied)
  if (hasDictionaryEntries || hasStandardEntries) {
    const dictionaryResult = applyDictionaryCorrectionsDetailed(result, dictionaryEntries ?? [], standardEntries, options);
    result = dictionaryResult.text;
    operations.push(...dictionaryResult.operations);
  }
  
  // Step 4: Deterministic medical abbreviation conversion (e.g. Milligramm → mg, rechts → re.)
  if (disabledAbbreviationIds) {
    result = applyAbbreviations(result, disabledAbbreviationIds);
  } else {
    result = applyAbbreviations(result);
  }
  
  return { text: result, operations };
}

/**
 * Remove Markdown formatting from text.
 * Used to clean up LLM output that may contain unwanted formatting.
 * 
 * Removes:
 * - Bold: **text** or __text__
 * - Italic: *text* or _text_
 * - Headers: # ## ### etc.
 * - Code: `code` or ```code```
 * - Strikethrough: ~~text~~
 * - Links: [text](url)
 * 
 * @param text - Text potentially containing Markdown formatting
 * @returns Clean text without Markdown formatting
 */
export function removeMarkdownFormatting(text: string): string {
  if (!text) return '';
  
  // Ensure text is a string
  let result = typeof text === 'string' ? text : String(text);
  
  // Remove bold: **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');
  
  // Remove italic: *text* or _text_ (be careful not to affect underscores in words)
  // Only match single asterisks not preceded/followed by another asterisk
  result = result.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '$1');
  // Only match underscores at word boundaries
  result = result.replace(/(?<=\s|^)_([^_]+)_(?=\s|$|[.,;:!?])/g, '$1');
  
  // Remove strikethrough: ~~text~~
  result = result.replace(/~~([^~]+)~~/g, '$1');
  
  // Remove inline code: `code`
  result = result.replace(/`([^`]+)`/g, '$1');
  
  // Remove code blocks: ```code```
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    // Extract the code content without the backticks
    return match.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  });
  
  // Remove headers: # ## ### #### ##### ###### at start of lines
  result = result.replace(/^#{1,6}\s+/gm, '');
  
  // Remove links but keep text: [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // Remove reference links: [text][ref] → text
  result = result.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  
  // Remove images: ![alt](url) → (remove completely or keep alt)
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
  
  // Clean up multiple spaces that may have been created
  result = result.replace(/  +/g, ' ');
  
  // Clean up multiple newlines
  result = result.replace(/\n{3,}/g, '\n\n');
  
  return result.trim();
}
