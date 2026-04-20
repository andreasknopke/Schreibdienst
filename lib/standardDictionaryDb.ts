/**
 * DB-Funktionen für das Standard-Wörterbuch (globale Einträge für alle Benutzer).
 * Tabelle: standard_dictionary (ohne username — gilt systemweit)
 */

import { NextRequest } from 'next/server';
import { query, execute, queryWithRequest, executeWithRequest, tableExistsCache } from './db';
import { STANDARD_DICTIONARY } from './standardDictionary';

export interface StandardDictDbEntry {
  id: number;
  wrong_word: string;
  correct_word: string;
  category: string;
  added_at: Date;
}

export interface StandardDictEntry {
  wrong: string;
  correct: string;
  category?: string;
}

// Tracking ob Tabelle+Seed schon geprüft wurde (pro Pool)
const tableCheckedPools = new Set<string>();

/**
 * Stellt sicher, dass die Tabelle existiert und mit Seed-Daten befüllt ist.
 */
async function ensureTable(request?: NextRequest): Promise<void> {
  const poolKey = request ? 'dynamic' : 'default';
  if (tableCheckedPools.has(poolKey)) return;

  const createSQL = `
    CREATE TABLE IF NOT EXISTS standard_dictionary (
      id INT AUTO_INCREMENT PRIMARY KEY,
      wrong_word VARCHAR(500) NOT NULL,
      correct_word VARCHAR(500) NOT NULL,
      category VARCHAR(100) DEFAULT '',
      added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_wrong (wrong_word(191))
    )
  `;

  if (request) {
    await executeWithRequest(request, createSQL);
  } else {
    await execute(createSQL);
  }

  // Prüfen ob Tabelle leer ist → Seed-Daten einfügen
  const countSQL = 'SELECT COUNT(*) as cnt FROM standard_dictionary';
  let count: number;
  if (request) {
    const rows = await queryWithRequest<{ cnt: number }>(request, countSQL);
    count = rows[0]?.cnt ?? 0;
  } else {
    const rows = await query<{ cnt: number }>(countSQL);
    count = rows[0]?.cnt ?? 0;
  }

  if (count === 0) {
    console.log('[StandardDict] Tabelle leer, füge Seed-Daten ein...');
    await seedFromHardcoded(request);
  }

  tableCheckedPools.add(poolKey);
}

/**
 * Befüllt die DB-Tabelle mit den hardcodierten Seed-Daten.
 */
async function seedFromHardcoded(request?: NextRequest): Promise<void> {
  // Kategorie aus dem Array-Index ableiten
  let currentCategory = '';
  const categorized: { wrong: string; correct: string; category: string }[] = [];

  for (const entry of STANDARD_DICTIONARY) {
    categorized.push({ ...entry, category: '' });
  }

  // Batch-Insert in Gruppen von 50
  for (let i = 0; i < categorized.length; i += 50) {
    const batch = categorized.slice(i, i + 50);
    const placeholders = batch.map(() => '(?, ?, ?)').join(', ');
    const params = batch.flatMap(e => [e.wrong, e.correct, e.category]);

    const sql = `INSERT IGNORE INTO standard_dictionary (wrong_word, correct_word, category) VALUES ${placeholders}`;
    if (request) {
      await executeWithRequest(request, sql, params);
    } else {
      await execute(sql, params);
    }
  }

  console.log('[StandardDict] Seed-Daten eingefügt:', categorized.length, 'Einträge');
}

/**
 * Alle Standard-Wörterbuch-Einträge laden.
 */
export async function getStandardDictEntries(request?: NextRequest): Promise<StandardDictEntry[]> {
  try {
    await ensureTable(request);

    const sql = 'SELECT wrong_word, correct_word, category FROM standard_dictionary ORDER BY correct_word ASC';
    let rows: StandardDictDbEntry[];
    if (request) {
      rows = await queryWithRequest<StandardDictDbEntry>(request, sql);
    } else {
      rows = await query<StandardDictDbEntry>(sql);
    }

    return rows.map(r => ({
      wrong: r.wrong_word,
      correct: r.correct_word,
      category: r.category || '',
    }));
  } catch (error) {
    console.error('[StandardDict] Fehler beim Laden, nutze Fallback:', error);
    // Fallback: hardcodierte Liste
    return STANDARD_DICTIONARY.map(e => ({ ...e, category: '' }));
  }
}

/**
 * Eintrag hinzufügen (INSERT oder UPDATE bei Duplikat).
 */
export async function addStandardDictEntry(
  request: NextRequest,
  wrong: string,
  correct: string,
  category: string = ''
): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureTable(request);
    await executeWithRequest(
      request,
      'INSERT INTO standard_dictionary (wrong_word, correct_word, category) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE correct_word = VALUES(correct_word), category = VALUES(category)',
      [wrong, correct, category]
    );
    return { success: true };
  } catch (error: any) {
    console.error('[StandardDict] Add error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Eintrag löschen.
 */
export async function removeStandardDictEntry(
  request: NextRequest,
  wrong: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureTable(request);
    await executeWithRequest(
      request,
      'DELETE FROM standard_dictionary WHERE wrong_word = ?',
      [wrong]
    );
    return { success: true };
  } catch (error: any) {
    console.error('[StandardDict] Remove error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Tabelle komplett leeren und mit Seed-Daten neu befüllen.
 */
export async function resetStandardDict(request: NextRequest): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    await ensureTable(request);
    await executeWithRequest(request, 'DELETE FROM standard_dictionary');
    await seedFromHardcoded(request);
    return { success: true, count: STANDARD_DICTIONARY.length };
  } catch (error: any) {
    console.error('[StandardDict] Reset error:', error);
    return { success: false, count: 0, error: error.message };
  }
}
