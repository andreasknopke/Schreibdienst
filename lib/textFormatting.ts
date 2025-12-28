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
      // Preserve case pattern of original match where possible
      if (match === match.toUpperCase() && entry.correct.length > 0) {
        return entry.correct.toUpperCase();
      } else if (match[0] === match[0].toUpperCase() && entry.correct.length > 0) {
        return entry.correct.charAt(0).toUpperCase() + entry.correct.slice(1);
      }
      return entry.correct;
    });
  }

  return result;
}

// Control word replacements - order matters for multi-word phrases first
const CONTROL_WORD_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
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
  
  // Punctuation (standalone words only)
  { pattern: /\bdoppelpunkt\b/gi, replacement: ':' },
  { pattern: /\bsemikolon\b/gi, replacement: ';' },
  { pattern: /\bfragezeichen\b/gi, replacement: '?' },
  { pattern: /\bausrufezeichen\b/gi, replacement: '!' },
  
  // Punkt and Komma - more careful matching to avoid replacing parts of words
  // Match "Punkt" only when it's standalone (not part of a compound word like "Endpunkt")
  { pattern: /(?<![A-ZÄÖÜa-zäöüß])\bpunkt\b(?![A-ZÄÖÜa-zäöüß])/gi, replacement: '.' },
  { pattern: /(?<![A-ZÄÖÜa-zäöüß])\bkomma\b(?![A-ZÄÖÜa-zäöüß])/gi, replacement: ',' },
  
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
export function applyFormattingControlWords(text: string): string {
  if (!text) return text;
  
  let result = text;
  
  // Step 1: Apply simple replacements
  for (const { pattern, replacement } of CONTROL_WORD_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  
  // Step 2: Handle delete commands
  result = handleDeleteCommands(result);
  
  // Step 3: Clean up formatting
  result = cleanupFormatting(result);
  
  return result;
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
  
  // Step 2: Apply formatting control words
  result = applyFormattingControlWords(result);
  
  // Step 3: Apply dictionary corrections (if entries provided)
  if (dictionaryEntries && dictionaryEntries.length > 0) {
    result = applyDictionaryCorrections(result, dictionaryEntries);
  }
  
  return result;
}
