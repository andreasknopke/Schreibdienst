/**
 * Programmatic text formatting for dictation control words.
 * Applied BEFORE LLM correction for consistent, deterministic results.
 */

// Dictionary entry interface (compatible with dictionaryDb.ts)
export interface DictionaryEntry {
  wrong: string;
  correct: string;
  addedAt?: string;
}

/**
 * Apply dictionary corrections to text.
 * Replaces all occurrences of wrong words with their correct versions.
 * Uses word boundaries for more precise matching.
 */
export function applyDictionaryCorrections(text: string, entries: DictionaryEntry[]): string {
  if (!text || !entries || entries.length === 0) {
    return text;
  }

  let result = text;
  let replacementCount = 0;

  // Sort entries by length of wrong word (longest first) to avoid partial replacements
  const sortedEntries = [...entries].sort((a, b) => b.wrong.length - a.wrong.length);

  for (const entry of sortedEntries) {
    if (!entry.wrong || !entry.correct) continue;
    
    // Escape special regex characters in the wrong word
    const escapedWrong = entry.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Use word boundary matching for better precision
    // But also handle cases where the word might be at start/end or surrounded by punctuation
    const regex = new RegExp(`(?<![A-ZÄÖÜa-zäöüß])${escapedWrong}(?![A-ZÄÖÜa-zäöüß])`, 'gi');
    
    result = result.replace(regex, (match) => {
      replacementCount++;
      // Preserve case pattern of original match where possible
      if (match === match.toUpperCase() && entry.correct.length > 0) {
        return entry.correct.toUpperCase();
      } else if (match[0] === match[0].toUpperCase() && entry.correct.length > 0) {
        return entry.correct.charAt(0).toUpperCase() + entry.correct.slice(1);
      }
      return entry.correct;
    });
  }

  if (replacementCount > 0) {
    console.log(`[Dictionary] Applied ${replacementCount} corrections`);
  }

  return result;
}

// Replacement function type for control words
type ReplacementFn = (match: string, p1: string) => string;

// Control word replacements - order matters for multi-word phrases first
const CONTROL_WORD_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string | ReplacementFn }> = [
  // Paragraph/line breaks (must come before simpler patterns)
  { pattern: /\bneuer\s+absatz\b/gi, replacement: '\n\n' },
  { pattern: /\bnächster\s+absatz\b/gi, replacement: '\n\n' },
  { pattern: /\babsatz\b/gi, replacement: '\n\n' },
  { pattern: /\bneue\s+zeile\b/gi, replacement: '\n' },
  { pattern: /\bnächste\s+zeile\b/gi, replacement: '\n' },
  
  // Brackets/parentheses
  { pattern: /\bklammer\s+auf\b/gi, replacement: '(' },
  { pattern: /\bklammer\s+zu\b/gi, replacement: ')' },
  { pattern: /\bin\s+klammern\s+/gi, replacement: '(' }, // "in Klammern XYZ" - opening only, closing handled separately
  
  // Punctuation - FIRST handle compound words ending with punctuation command
  // e.g., "Diagnosedoppelpunkt" → "Diagnose:"
  // NOTE: "Punkt" and "Komma" are handled by LLM because they're too ambiguous
  //       (e.g., "der entscheidende Punkt ist..." should NOT become "der entscheidende . ist...")
  { pattern: /\b(\w+?)doppelpunkt\b/gi, replacement: (_: string, word: string) => `${word}:` },
  { pattern: /\b(\w+?)semikolon\b/gi, replacement: (_: string, word: string) => `${word};` },
  { pattern: /\b(\w+?)fragezeichen\b/gi, replacement: (_: string, word: string) => `${word}?` },
  { pattern: /\b(\w+?)ausrufezeichen\b/gi, replacement: (_: string, word: string) => `${word}!` },
  
  // Punctuation (standalone words only) - unambiguous ones only
  // "Punkt" and "Komma" are left to LLM for context-aware handling
  { pattern: /\bdoppelpunkt\b/gi, replacement: ':' },
  { pattern: /\bsemikolon\b/gi, replacement: ';' },
  { pattern: /\bfragezeichen\b/gi, replacement: '?' },
  { pattern: /\bausrufezeichen\b/gi, replacement: '!' },
  
  // Quotes
  { pattern: /\banführungszeichen\s+auf\b/gi, replacement: '„' },
  { pattern: /\banführungszeichen\s+zu\b/gi, replacement: '"' },
  { pattern: /\banführungszeichen\s+oben\b/gi, replacement: '"' },
  { pattern: /\banführungszeichen\s+unten\b/gi, replacement: '„' },
  
  // Delete commands - these need special handling after replacement
  // Mark them for post-processing
];

// Delete command patterns
const DELETE_PATTERNS = [
  { pattern: /lösche\s+das\s+letzte\s+wort\b/gi, type: 'word' as const },
  { pattern: /letztes\s+wort\s+löschen\b/gi, type: 'word' as const },
  { pattern: /lösche\s+den\s+letzten\s+satz\b/gi, type: 'sentence' as const },
  { pattern: /letzten\s+satz\s+löschen\b/gi, type: 'sentence' as const },
  { pattern: /lösche\s+den\s+letzten\s+absatz\b/gi, type: 'paragraph' as const },
  { pattern: /letzten\s+absatz\s+löschen\b/gi, type: 'paragraph' as const },
];

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
    punctuation: number; // "Punkt", "Komma", "Doppelpunkt" etc.
    brackets: number;    // "Klammer auf/zu"
    deletions: number;   // "lösche das letzte Wort" etc.
    total: number;
  };
}

/**
 * Apply formatting control words programmatically.
 * This should be called BEFORE sending text to LLM for correction.
 * 
 * @param text - Raw transcription text with spoken control words
 * @returns Text with control words replaced by actual formatting
 */
export function applyFormattingControlWords(text: string): string {
  const result = applyFormattingControlWordsWithStats(text);
  return result.text;
}

/**
 * Apply formatting control words and return statistics about what was applied.
 * Use this version when you need to log/display the results.
 */
export function applyFormattingControlWordsWithStats(text: string): ControlWordResult {
  if (!text) return { text, stats: { paragraphs: 0, lineBreaks: 0, punctuation: 0, brackets: 0, deletions: 0, total: 0 } };
  
  let result = text;
  const stats = { paragraphs: 0, lineBreaks: 0, punctuation: 0, brackets: 0, deletions: 0, total: 0 };
  
  // Step 1: Apply simple replacements and count
  for (const { pattern, replacement } of CONTROL_WORD_REPLACEMENTS) {
    const matches = result.match(pattern);
    if (matches) {
      const count = matches.length;
      stats.total += count;
      
      // Categorize the match
      const patternStr = pattern.source.toLowerCase();
      if (patternStr.includes('absatz') || patternStr.includes('zeile')) {
        if (patternStr.includes('zeile')) {
          stats.lineBreaks += count;
        } else {
          stats.paragraphs += count;
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
  
  // Step 3: Clean up formatting
  result = cleanupFormatting(result);
  
  // Log if any control words were applied
  if (stats.total > 0) {
    const details: string[] = [];
    if (stats.paragraphs > 0) details.push(`${stats.paragraphs}x Absatz`);
    if (stats.lineBreaks > 0) details.push(`${stats.lineBreaks}x Zeile`);
    if (stats.punctuation > 0) details.push(`${stats.punctuation}x Satzzeichen`);
    if (stats.brackets > 0) details.push(`${stats.brackets}x Klammer`);
    if (stats.deletions > 0) details.push(`${stats.deletions}x Löschung`);
    console.log(`[ControlWords] ${stats.total} Steuerbefehle erkannt: ${details.join(', ')}`);
  }
  
  return { text: result, stats };
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
    .replace(/\s+([.,;:!?)])/g, '$1')
    // Add space after punctuation if missing (but not before newline)
    .replace(/([.,;:!?])(?=[A-ZÄÖÜa-zäöüß])/g, '$1 ')
    // Remove space after opening parenthesis
    .replace(/\(\s+/g, '(')
    // Remove space before closing parenthesis
    .replace(/\s+\)/g, ')')
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
 * Combined preprocessing: apply formatting + remove fillers + dictionary corrections
 * Use this before sending to LLM
 * 
 * @param text - Raw transcription text
 * @param dictionaryEntries - Optional dictionary entries for user-specific corrections
 */
export function preprocessTranscription(text: string, dictionaryEntries?: DictionaryEntry[]): string {
  if (!text) return text;
  
  let result = text;
  
  // Step 1: Remove filler words
  result = removeFillerWords(result);
  
  // Step 2: Apply formatting control words (logs automatically if any found)
  result = applyFormattingControlWords(result);
  
  // Step 3: Apply dictionary corrections (if entries provided, logs automatically if any applied)
  if (dictionaryEntries && dictionaryEntries.length > 0) {
    result = applyDictionaryCorrections(result, dictionaryEntries);
  }
  
  return result;
}
