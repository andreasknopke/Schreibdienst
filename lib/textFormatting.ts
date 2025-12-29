/**
 * Programmatic text formatting for dictation control words.
 * Applied BEFORE LLM correction for consistent, deterministic results.
 */

// Dictionary entry interface (compatible with dictionaryDb.ts)
export interface DictionaryEntry {
  wrong: string;
  correct: string;
  addedAt?: string;
  useInPrompt?: boolean;  // Wort wird im Whisper initial_prompt verwendet
  matchStem?: boolean;    // Wortstamm-Matching aktivieren
}

/**
 * Apply dictionary corrections to text.
 * Replaces all occurrences of wrong words with their correct versions.
 * Uses word boundaries for more precise matching.
 * 
 * If matchStem is enabled for an entry, it also replaces the wrong word
 * when it appears as a prefix in compound words (e.g., "Schole" -> "Chole"
 * will also correct "Scholezystitis" -> "Cholezystitis").
 */
export function applyDictionaryCorrections(text: string, entries: DictionaryEntry[]): string {
  if (!text || !entries || entries.length === 0) {
    return text;
  }

  let result = text;
  let replacementCount = 0;
  let stemReplacementCount = 0;

  // Sort entries by length of wrong word (longest first) to avoid partial replacements
  const sortedEntries = [...entries].sort((a, b) => b.wrong.length - a.wrong.length);

  for (const entry of sortedEntries) {
    if (!entry.wrong || !entry.correct) continue;
    
    // Escape special regex characters in the wrong word
    const escapedWrong = entry.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedCorrect = entry.correct;
    
    if (entry.matchStem) {
      // STEM MATCHING: Also match when wrong word appears as prefix in compound words
      // Match: "Schole" in "Scholezystitis", "Scholedochus", "Scholestase"
      // Pattern: word boundary at start, then the wrong word, followed by more letters
      
      // First: Match standalone words (exact match)
      const standaloneRegex = new RegExp(`(?<![A-ZÄÖÜa-zäöüß])${escapedWrong}(?![A-ZÄÖÜa-zäöüß])`, 'gi');
      result = result.replace(standaloneRegex, (match) => {
        replacementCount++;
        return preserveCase(match, escapedCorrect);
      });
      
      // Second: Match as prefix in compound words (wrong word followed by more letters)
      // This matches "Scholezystitis" and replaces "Schole" with "Chole" -> "Cholezystitis"
      const stemRegex = new RegExp(`(?<![A-ZÄÖÜa-zäöüß])${escapedWrong}([A-ZÄÖÜa-zäöüß]+)`, 'gi');
      result = result.replace(stemRegex, (match, suffix) => {
        stemReplacementCount++;
        // Preserve case of the original stem
        const correctedStem = preserveCase(match.slice(0, entry.wrong.length), escapedCorrect);
        return correctedStem + suffix;
      });
    } else {
      // Standard word boundary matching (no stem matching)
      const regex = new RegExp(`(?<![A-ZÄÖÜa-zäöüß])${escapedWrong}(?![A-ZÄÖÜa-zäöüß])`, 'gi');
      
      result = result.replace(regex, (match) => {
        replacementCount++;
        return preserveCase(match, escapedCorrect);
      });
    }
  }

  if (replacementCount > 0 || stemReplacementCount > 0) {
    console.log(`[Dictionary] Applied ${replacementCount} direct + ${stemReplacementCount} stem corrections`);
  }

  return result;
}

/**
 * Preserve case pattern from original match when replacing.
 */
function preserveCase(original: string, replacement: string): string {
  if (!original || !replacement) return replacement;
  
  // All uppercase -> make replacement uppercase
  if (original === original.toUpperCase() && replacement.length > 0) {
    return replacement.toUpperCase();
  }
  // First letter uppercase -> capitalize replacement
  if (original[0] === original[0].toUpperCase() && replacement.length > 0) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  // Default: return as-is
  return replacement;
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

// Number word to digit mapping for enumeration
const NUMBER_WORDS: Record<string, number> = {
  'eins': 1, 'ein': 1, 'erste': 1, 'erster': 1, 'erstes': 1,
  'zwei': 2, 'zweite': 2, 'zweiter': 2, 'zweites': 2,
  'drei': 3, 'dritte': 3, 'dritter': 3, 'drittes': 3,
  'vier': 4, 'vierte': 4, 'vierter': 4, 'viertes': 4,
  'fünf': 5, 'fünfte': 5, 'fünfter': 5, 'fünftes': 5,
  'sechs': 6, 'sechste': 6, 'sechster': 6, 'sechstes': 6,
  'sieben': 7, 'siebte': 7, 'siebter': 7, 'siebtes': 7,
  'acht': 8, 'achte': 8, 'achter': 8, 'achtes': 8,
  'neun': 9, 'neunte': 9, 'neunter': 9, 'neuntes': 9,
  'zehn': 10, 'zehnte': 10, 'zehnter': 10, 'zehntes': 10,
  'elf': 11, 'elfte': 11, 'elfter': 11, 'elftes': 11,
  'zwölf': 12, 'zwölfte': 12, 'zwölfter': 12, 'zwölftes': 12,
};

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
    enumerations: number; // "Punkt eins", "Nächster Punkt" etc.
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
  if (!text) return { text, stats: { paragraphs: 0, lineBreaks: 0, punctuation: 0, brackets: 0, deletions: 0, enumerations: 0, total: 0 } };
  
  let result = text;
  const stats = { paragraphs: 0, lineBreaks: 0, punctuation: 0, brackets: 0, deletions: 0, enumerations: 0, total: 0 };
  
  // Step 0: Handle enumeration commands first (before other replacements)
  const enumResult = handleEnumerationCommands(result);
  result = enumResult.text;
  stats.enumerations = enumResult.count;
  stats.total += enumResult.count;
  
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
    if (stats.enumerations > 0) details.push(`${stats.enumerations}x Aufzählung`);
    console.log(`[ControlWords] ${stats.total} Steuerbefehle erkannt: ${details.join(', ')}`);
  }
  
  return { text: result, stats };
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
    /\baufzählung\s+beginnen\b[.,;:\s]*/gi,
    /\baufzählung\s+starten\b[.,;:\s]*/gi,
    /\bliste\s+beginnen\b[.,;:\s]*/gi,
    /\bliste\s+starten\b[.,;:\s]*/gi,
  ];
  
  for (const pattern of startPatterns) {
    if (pattern.test(result)) {
      result = result.replace(pattern, '\n');
      count++;
    }
  }
  
  // Step 2: Remove end markers
  const endPatterns = [
    /\baufzählung\s+beenden\b[.,;:\s]*/gi,
    /\baufzählung\s+ende\b[.,;:\s]*/gi,
    /\bliste\s+beenden\b[.,;:\s]*/gi,
    /\bliste\s+ende\b[.,;:\s]*/gi,
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
  const allEnumPatterns = new RegExp(
    `\\bpunkt\\s+(${numberWordPattern}|\\d+)\\b[.,;:\\s]*` +
    `|\\bnächster\\s+punkt\\b[.,;:\\s]*` +
    `|\\bnächster\\s+listenpunkt\\b[.,;:\\s]*` +
    `|\\bweiterer\\s+punkt\\b[.,;:\\s]*` +
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
    const punktMatch = match.match(/\bpunkt\s+(\S+)/i);
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
