import { NextRequest } from 'next/server';
import { query, execute, getPoolForRequest } from './db';

export interface DictionaryEntry {
  wrong: string;
  correct: string;
  addedAt: string;
  useInPrompt?: boolean;  // Wort wird im Whisper initial_prompt verwendet
  matchStem?: boolean;    // Wortstamm-Matching aktivieren (z.B. "Schole" -> "Chole" korrigiert auch "Scholezystitis" -> "Cholezystitis")
}

interface DbDictionaryEntry {
  id: number;
  username: string;
  wrong_word: string;
  correct_word: string;
  added_at: Date;
  use_in_prompt: boolean;
  match_stem: boolean;
}

// Get all entries for a user
export async function getEntries(username: string): Promise<DictionaryEntry[]> {
  try {
    const entries = await query<DbDictionaryEntry>(
      'SELECT wrong_word, correct_word, added_at, COALESCE(use_in_prompt, 0) as use_in_prompt, COALESCE(match_stem, 0) as match_stem FROM dictionary_entries WHERE username = ? ORDER BY added_at DESC',
      [username]
    );
    
    return entries.map(e => ({
      wrong: e.wrong_word,
      correct: e.correct_word,
      addedAt: e.added_at?.toISOString() || new Date().toISOString(),
      useInPrompt: Boolean(e.use_in_prompt),
      matchStem: Boolean(e.match_stem)
    }));
  } catch (error: any) {
    // If columns don't exist yet, fall back to basic query
    if (error?.code === 'ER_BAD_FIELD_ERROR') {
      console.log('[Dictionary] New columns not found, using basic query');
      try {
        const entries = await query<DbDictionaryEntry>(
          'SELECT wrong_word, correct_word, added_at FROM dictionary_entries WHERE username = ? ORDER BY added_at DESC',
          [username]
        );
        
        return entries.map(e => ({
          wrong: e.wrong_word,
          correct: e.correct_word,
          addedAt: e.added_at?.toISOString() || new Date().toISOString(),
          useInPrompt: false,
          matchStem: false
        }));
      } catch (fallbackError) {
        console.error('[Dictionary] Fallback query also failed:', fallbackError);
        return [];
      }
    }
    console.error('[Dictionary] Get entries error:', error);
    return [];
  }
}

// Add or update entry
export async function addEntry(
  username: string, 
  wrong: string, 
  correct: string,
  useInPrompt: boolean = false,
  matchStem: boolean = false
): Promise<{ success: boolean; error?: string }> {
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
      `INSERT INTO dictionary_entries (username, wrong_word, correct_word, use_in_prompt, match_stem) 
       VALUES (?, ?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE correct_word = ?, use_in_prompt = ?, match_stem = ?, added_at = CURRENT_TIMESTAMP`,
      [username.toLowerCase(), wrongTrimmed, correctTrimmed, useInPrompt ? 1 : 0, matchStem ? 1 : 0, correctTrimmed, useInPrompt ? 1 : 0, matchStem ? 1 : 0]
    );
    
    console.log('[Dictionary] Added/updated entry for', username, ':', wrongTrimmed, '->', correctTrimmed, `(prompt: ${useInPrompt}, stem: ${matchStem})`);
    return { success: true };
  } catch (error) {
    console.error('[Dictionary] Add entry error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Update entry options (useInPrompt, matchStem)
export async function updateEntryOptions(
  username: string, 
  wrong: string, 
  useInPrompt: boolean,
  matchStem: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await execute(
      'UPDATE dictionary_entries SET use_in_prompt = ?, match_stem = ? WHERE username = ? AND wrong_word = ?',
      [useInPrompt ? 1 : 0, matchStem ? 1 : 0, username, wrong]
    );
    
    if (result.affectedRows === 0) {
      return { success: false, error: 'Eintrag nicht gefunden' };
    }
    
    console.log('[Dictionary] Updated options for', username, ':', wrong, `(prompt: ${useInPrompt}, stem: ${matchStem})`);
    return { success: true };
  } catch (error) {
    console.error('[Dictionary] Update options error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Remove entry
export async function removeEntry(username: string, wrong: string): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await execute(
      'DELETE FROM dictionary_entries WHERE username = ? AND wrong_word = ?',
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
  
  const lines = entries.map(e => `- "${e.wrong}" MUSS IMMER ersetzt werden durch "${e.correct}"`);
  return `\n\nKRITISCH - BENUTZERWÖRTERBUCH (MUSS angewendet werden):\nDie folgenden Ersetzungen sind PFLICHT und müssen IMMER durchgeführt werden, unabhängig vom Kontext:\n${lines.join('\n')}\n\nWenn du eines dieser Wörter im Text findest, MUSST du es ersetzen!`;
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

// ============================================================
// Request-basierte Funktionen (für dynamische DB über Token)
// ============================================================

// Ensure new columns exist (on-demand migration)
async function ensureColumnsExist(db: any, poolKey: string): Promise<void> {
  try {
    // Try to add use_in_prompt column if it doesn't exist
    await db.execute(`
      ALTER TABLE dictionary_entries ADD COLUMN use_in_prompt BOOLEAN DEFAULT FALSE
    `);
    console.log(`[Dictionary] Added use_in_prompt column on-demand (${poolKey})`);
  } catch (e: any) {
    // Column already exists - that's fine
  }
  
  try {
    // Try to add match_stem column if it doesn't exist
    await db.execute(`
      ALTER TABLE dictionary_entries ADD COLUMN match_stem BOOLEAN DEFAULT FALSE
    `);
    console.log(`[Dictionary] Added match_stem column on-demand (${poolKey})`);
  } catch (e: any) {
    // Column already exists - that's fine
  }
}

// Track if we've already checked columns PER DATABASE (not global!)
// Key: poolKey (host:port:database:user or "default"), Value: true if checked
const columnsCheckedPerPool = new Map<string, boolean>();

// Helper to get pool key for tracking
function getPoolKeyFromRequest(request: NextRequest): string {
  const dbToken = request.headers.get('x-db-token');
  if (dbToken) {
    try {
      const decoded = Buffer.from(dbToken, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      return `${parsed.host}:${parsed.port || 3306}:${parsed.database}:${parsed.user}`;
    } catch {
      // Invalid token, fall through to default
    }
  }
  return 'default';
}

// Get entries with Request context
export async function getEntriesWithRequest(request: NextRequest, username: string): Promise<DictionaryEntry[]> {
  const poolKey = getPoolKeyFromRequest(request);
  
  try {
    const db = await getPoolForRequest(request);
    
    // On-demand migration: ensure new columns exist (only check once per database pool)
    if (!columnsCheckedPerPool.get(poolKey)) {
      console.log(`[Dictionary] Checking columns for pool: ${poolKey}`);
      await ensureColumnsExist(db, poolKey);
      columnsCheckedPerPool.set(poolKey, true);
    }
    
    const [rows] = await db.execute<any[]>(
      'SELECT wrong_word, correct_word, added_at, COALESCE(use_in_prompt, 0) as use_in_prompt, COALESCE(match_stem, 0) as match_stem FROM dictionary_entries WHERE username = ? ORDER BY added_at DESC',
      [username]
    );
    
    return (rows as DbDictionaryEntry[]).map(e => ({
      wrong: e.wrong_word,
      correct: e.correct_word,
      addedAt: e.added_at?.toISOString() || new Date().toISOString(),
      useInPrompt: Boolean(e.use_in_prompt),
      matchStem: Boolean(e.match_stem)
    }));
  } catch (error: any) {
    // If columns don't exist yet (migration failed or didn't run), fall back to basic query
    if (error?.code === 'ER_BAD_FIELD_ERROR') {
      console.log(`[Dictionary] New columns not found for pool "${poolKey}", using basic query`);
      // Reset the checked flag so next request tries migration again
      columnsCheckedPerPool.delete(poolKey);
      try {
        const db = await getPoolForRequest(request);
        const [rows] = await db.execute<any[]>(
          'SELECT wrong_word, correct_word, added_at FROM dictionary_entries WHERE username = ? ORDER BY added_at DESC',
          [username]
        );
        
        return (rows as DbDictionaryEntry[]).map(e => ({
          wrong: e.wrong_word,
          correct: e.correct_word,
          addedAt: e.added_at?.toISOString() || new Date().toISOString(),
          useInPrompt: false,
          matchStem: false
        }));
      } catch (fallbackError) {
        console.error(`[Dictionary] Fallback query also failed for pool "${poolKey}":`, fallbackError);
        return [];
      }
    }
    console.error(`[Dictionary] Get entries error for pool "${poolKey}":`, error);
    return [];
  }
}

// Add entry with Request context
export async function addEntryWithRequest(
  request: NextRequest,
  username: string, 
  wrong: string, 
  correct: string,
  useInPrompt: boolean = false,
  matchStem: boolean = false
): Promise<{ success: boolean; error?: string }> {
  if (!wrong?.trim() || !correct?.trim()) {
    return { success: false, error: 'Beide Felder müssen ausgefüllt sein' };
  }

  const wrongTrimmed = wrong.trim();
  const correctTrimmed = correct.trim();

  if (wrongTrimmed.toLowerCase() === correctTrimmed.toLowerCase()) {
    return { success: false, error: 'Falsches und korrektes Wort sind identisch' };
  }

  try {
    const db = await getPoolForRequest(request);
    await db.execute(
      `INSERT INTO dictionary_entries (username, wrong_word, correct_word, use_in_prompt, match_stem) 
       VALUES (?, ?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE correct_word = ?, use_in_prompt = ?, match_stem = ?, added_at = CURRENT_TIMESTAMP`,
      [username.toLowerCase(), wrongTrimmed, correctTrimmed, useInPrompt ? 1 : 0, matchStem ? 1 : 0, correctTrimmed, useInPrompt ? 1 : 0, matchStem ? 1 : 0]
    );
    
    console.log('[Dictionary] Added/updated entry (with request) for', username, ':', wrongTrimmed, '->', correctTrimmed, `(prompt: ${useInPrompt}, stem: ${matchStem})`);
    return { success: true };
  } catch (error) {
    console.error('[Dictionary] Add entry error (with request):', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Update entry options with Request context
export async function updateEntryOptionsWithRequest(
  request: NextRequest,
  username: string, 
  wrong: string, 
  useInPrompt: boolean,
  matchStem: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getPoolForRequest(request);
    const [result] = await db.execute(
      'UPDATE dictionary_entries SET use_in_prompt = ?, match_stem = ? WHERE username = ? AND wrong_word = ?',
      [useInPrompt ? 1 : 0, matchStem ? 1 : 0, username, wrong]
    );
    
    if ((result as any).affectedRows === 0) {
      return { success: false, error: 'Eintrag nicht gefunden' };
    }
    
    console.log('[Dictionary] Updated options (with request) for', username, ':', wrong, `(prompt: ${useInPrompt}, stem: ${matchStem})`);
    return { success: true };
  } catch (error) {
    console.error('[Dictionary] Update options error (with request):', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Remove entry with Request context
export async function removeEntryWithRequest(
  request: NextRequest,
  username: string, 
  wrong: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getPoolForRequest(request);
    const [result] = await db.execute(
      'DELETE FROM dictionary_entries WHERE username = ? AND wrong_word = ?',
      [username, wrong]
    );
    
    if ((result as any).affectedRows === 0) {
      return { success: false, error: 'Eintrag nicht gefunden' };
    }
    
    console.log('[Dictionary] Removed entry (with request) for', username, ':', wrong);
    return { success: true };
  } catch (error) {
    console.error('[Dictionary] Remove entry error (with request):', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Load dictionary with Request context
export async function loadDictionaryWithRequest(request: NextRequest, username: string): Promise<{ entries: DictionaryEntry[] }> {
  const entries = await getEntriesWithRequest(request, username);
  return { entries };
}
