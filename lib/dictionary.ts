import fs from 'fs';
import path from 'path';

const DICTIONARIES_DIR = path.join(process.cwd(), 'cache', 'dictionaries');

export interface DictionaryEntry {
  wrong: string;       // Falsch erkanntes Wort
  correct: string;     // Korrekte Schreibweise
  addedAt: string;     // Zeitstempel
}

interface UserDictionary {
  entries: DictionaryEntry[];
}

// Ensure dictionaries directory exists
function ensureDir(): void {
  if (!fs.existsSync(DICTIONARIES_DIR)) {
    fs.mkdirSync(DICTIONARIES_DIR, { recursive: true });
  }
}

// Get file path for user dictionary
function getDictionaryPath(username: string): string {
  // Sanitize username for file system
  const safeUsername = username.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return path.join(DICTIONARIES_DIR, `${safeUsername}.json`);
}

// Load user dictionary
export function loadDictionary(username: string): UserDictionary {
  ensureDir();
  const filePath = getDictionaryPath(username);
  
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading dictionary for', username, error);
  }
  
  return { entries: [] };
}

// Save user dictionary
function saveDictionary(username: string, dictionary: UserDictionary): void {
  ensureDir();
  const filePath = getDictionaryPath(username);
  fs.writeFileSync(filePath, JSON.stringify(dictionary, null, 2), 'utf-8');
}

// Add entry to user dictionary
export function addEntry(username: string, wrong: string, correct: string): { success: boolean; error?: string } {
  if (!wrong?.trim() || !correct?.trim()) {
    return { success: false, error: 'Beide Felder müssen ausgefüllt sein' };
  }

  const wrongTrimmed = wrong.trim();
  const correctTrimmed = correct.trim();

  if (wrongTrimmed.toLowerCase() === correctTrimmed.toLowerCase()) {
    return { success: false, error: 'Falsches und korrektes Wort sind identisch' };
  }

  const dictionary = loadDictionary(username);
  
  // Check if entry already exists
  const existingIndex = dictionary.entries.findIndex(
    e => e.wrong.toLowerCase() === wrongTrimmed.toLowerCase()
  );

  if (existingIndex >= 0) {
    // Update existing entry
    dictionary.entries[existingIndex] = {
      wrong: wrongTrimmed,
      correct: correctTrimmed,
      addedAt: new Date().toISOString()
    };
  } else {
    // Add new entry
    dictionary.entries.push({
      wrong: wrongTrimmed,
      correct: correctTrimmed,
      addedAt: new Date().toISOString()
    });
  }

  saveDictionary(username, dictionary);
  return { success: true };
}

// Remove entry from user dictionary
export function removeEntry(username: string, wrong: string): { success: boolean; error?: string } {
  const dictionary = loadDictionary(username);
  
  const index = dictionary.entries.findIndex(
    e => e.wrong.toLowerCase() === wrong.toLowerCase()
  );

  if (index === -1) {
    return { success: false, error: 'Eintrag nicht gefunden' };
  }

  dictionary.entries.splice(index, 1);
  saveDictionary(username, dictionary);
  return { success: true };
}

// Get all entries for a user
export function getEntries(username: string): DictionaryEntry[] {
  const dictionary = loadDictionary(username);
  return dictionary.entries;
}

// Format dictionary for LLM prompt
export function formatDictionaryForPrompt(username: string): string {
  const entries = getEntries(username);
  
  if (entries.length === 0) {
    return '';
  }

  const lines = entries.map(e => `"${e.wrong}" → "${e.correct}"`);
  
  return `
PERSÖNLICHES WÖRTERBUCH DES BENUTZERS:
Die folgenden Wörter wurden vom Benutzer korrigiert. Verwende IMMER die korrekte Schreibweise:
${lines.join('\n')}
`;
}

// Apply dictionary replacements to text (for direct replacement before/after transcription)
export function applyDictionary(username: string, text: string): string {
  const entries = getEntries(username);
  
  if (entries.length === 0 || !text) {
    return text;
  }

  let result = text;
  
  for (const entry of entries) {
    // Case-insensitive replacement, preserving word boundaries
    const regex = new RegExp(`\\b${escapeRegExp(entry.wrong)}\\b`, 'gi');
    result = result.replace(regex, entry.correct);
  }

  return result;
}

// Helper to escape special regex characters
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
