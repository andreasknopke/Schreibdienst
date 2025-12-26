import { query, execute } from './db';

export interface DictionaryEntry {
  wrong: string;
  correct: string;
  addedAt: string;
}

interface DbDictionaryEntry {
  id: number;
  username: string;
  wrong_word: string;
  correct_word: string;
  added_at: Date;
}

// Get all entries for a user
export async function getEntries(username: string): Promise<DictionaryEntry[]> {
  try {
    const entries = await query<DbDictionaryEntry>(
      'SELECT wrong_word, correct_word, added_at FROM dictionary_entries WHERE LOWER(username) = LOWER(?) ORDER BY added_at DESC',
      [username]
    );
    
    return entries.map(e => ({
      wrong: e.wrong_word,
      correct: e.correct_word,
      addedAt: e.added_at?.toISOString() || new Date().toISOString()
    }));
  } catch (error) {
    console.error('[Dictionary] Get entries error:', error);
    return [];
  }
}

// Add or update entry
export async function addEntry(username: string, wrong: string, correct: string): Promise<{ success: boolean; error?: string }> {
  if (!wrong?.trim() || !correct?.trim()) {
    return { success: false, error: 'Beide Felder müssen ausgefüllt sein' };
  }

  const wrongTrimmed = wrong.trim();
  const correctTrimmed = correct.trim();

  if (wrongTrimmed.toLowerCase() === correctTrimmed.toLowerCase()) {
    return { success: false, error: 'Falsches und korrektes Wort sind identisch' };
  }

  try {
    // Use INSERT ... ON DUPLICATE KEY UPDATE for upsert
    await execute(
      `INSERT INTO dictionary_entries (username, wrong_word, correct_word) 
       VALUES (?, ?, ?) 
       ON DUPLICATE KEY UPDATE correct_word = ?, added_at = CURRENT_TIMESTAMP`,
      [username.toLowerCase(), wrongTrimmed, correctTrimmed, correctTrimmed]
    );
    
    console.log('[Dictionary] Added/updated entry for', username, ':', wrongTrimmed, '->', correctTrimmed);
    return { success: true };
  } catch (error) {
    console.error('[Dictionary] Add entry error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Remove entry
export async function removeEntry(username: string, wrong: string): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await execute(
      'DELETE FROM dictionary_entries WHERE LOWER(username) = LOWER(?) AND LOWER(wrong_word) = LOWER(?)',
      [username, wrong]
    );
    
    if (result.affectedRows === 0) {
      return { success: false, error: 'Eintrag nicht gefunden' };
    }
    
    console.log('[Dictionary] Removed entry for', username, ':', wrong);
    return { success: true };
  } catch (error) {
    console.error('[Dictionary] Remove entry error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Load dictionary for text correction (returns map of wrong -> correct)
export async function loadDictionary(username: string): Promise<{ entries: DictionaryEntry[] }> {
  const entries = await getEntries(username);
  return { entries };
}

// Format dictionary for LLM prompt
export function formatDictionaryForPrompt(entries: DictionaryEntry[]): string {
  if (!entries || entries.length === 0) {
    return '';
  }
  
  const lines = entries.map(e => `- "${e.wrong}" → "${e.correct}"`);
  return `\n\nBenutzerwörterbuch (bitte diese Korrekturen anwenden):\n${lines.join('\n')}`;
}

// Apply dictionary corrections to text
export function applyDictionary(text: string, entries: DictionaryEntry[]): string {
  if (!entries || entries.length === 0 || !text) {
    return text;
  }
  
  let result = text;
  
  for (const entry of entries) {
    // Case-insensitive replacement, but preserve original case pattern where possible
    const regex = new RegExp(escapeRegExp(entry.wrong), 'gi');
    result = result.replace(regex, entry.correct);
  }
  
  return result;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Convert spoken punctuation to actual punctuation marks
export function convertSpokenPunctuation(text: string): string {
  let result = text;
  
  // Map of spoken words to punctuation (case-insensitive)
  const punctuationMap: [RegExp, string][] = [
    // Periods and endings
    [/\b(punkt|period)\b/gi, '.'],
    [/\bsatzende\b/gi, '.'],
    
    // Commas
    [/\b(komma|beistrich)\b/gi, ','],
    
    // Question and exclamation
    [/\bfragezeichen\b/gi, '?'],
    [/\bausrufezeichen\b/gi, '!'],
    
    // Colons and semicolons
    [/\bdoppelpunkt\b/gi, ':'],
    [/\bsemikolon\b/gi, ';'],
    [/\bstrichpunkt\b/gi, ';'],
    
    // Dashes and hyphens
    [/\bgedankenstrich\b/gi, ' – '],
    [/\bbindestrich\b/gi, '-'],
    
    // Parentheses
    [/\bklammer auf\b/gi, '('],
    [/\bklammer zu\b/gi, ')'],
    [/\brunde klammer auf\b/gi, '('],
    [/\brunde klammer zu\b/gi, ')'],
    
    // Quotes
    [/\banführungszeichen auf\b/gi, '„'],
    [/\banführungszeichen zu\b/gi, '"'],
    [/\bzitat anfang\b/gi, '„'],
    [/\bzitat ende\b/gi, '"'],
    
    // Line breaks
    [/\bneue zeile\b/gi, '\n'],
    [/\bneuer absatz\b/gi, '\n\n'],
    [/\babsatz\b/gi, '\n\n'],
    [/\bzeilenumbruch\b/gi, '\n'],
    
    // Slash
    [/\bschrägstrich\b/gi, '/'],
  ];
  
  for (const [pattern, replacement] of punctuationMap) {
    result = result.replace(pattern, replacement);
  }
  
  return result;
}

// Remove duplicate punctuation marks (e.g., ".." -> "." or ",," -> ",")
export function removeDuplicatePunctuation(text: string): string {
  let result = text;
  
  // Remove duplicate periods, commas, etc.
  result = result.replace(/\.{2,}/g, '.');
  result = result.replace(/,{2,}/g, ',');
  result = result.replace(/:{2,}/g, ':');
  result = result.replace(/;{2,}/g, ';');
  result = result.replace(/\?{2,}/g, '?');
  result = result.replace(/!{2,}/g, '!');
  
  // Remove space before punctuation
  result = result.replace(/\s+([.,;:!?])/g, '$1');
  
  // Remove punctuation followed by same punctuation with space
  result = result.replace(/([.,;:!?])\s+\1/g, '$1');
  
  // Ensure space after punctuation (except at end or before newline)
  result = result.replace(/([.,;:!?])([^\s\n"'"„"\)\]])/g, '$1 $2');
  
  // Fix multiple spaces
  result = result.replace(/  +/g, ' ');
  
  return result.trim();
}

// Full text cleanup: apply all corrections
export function cleanupText(text: string, entries: DictionaryEntry[]): string {
  let result = text;
  
  // Step 1: Convert spoken punctuation to actual marks
  result = convertSpokenPunctuation(result);
  
  // Step 2: Apply dictionary corrections
  result = applyDictionary(result, entries);
  
  // Step 3: Remove duplicate punctuation
  result = removeDuplicatePunctuation(result);
  
  return result;
}
