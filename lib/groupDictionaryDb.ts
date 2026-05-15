import { NextRequest } from 'next/server';
import { getPoolForRequest } from './db';
import type { DictionaryEntry } from './dictionaryDb';

export interface DictionaryGroup {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  createdBy: string;
  memberCount: number;
  entryCount: number;
}

export interface GroupDictionaryEntry extends DictionaryEntry {
  id: number;
  groupId: number;
  groupName: string;
  addedBy: string;
}

export interface GroupMember {
  username: string;
  addedAt: string;
}

export interface GroupImportCandidate extends DictionaryEntry {
  sourceUsername: string;
  alreadyInGroup: boolean;
  groupCorrect?: string;
}

const tablesCheckedPerPool = new Map<string, boolean>();

function getPoolKeyFromRequest(request: NextRequest): string {
  const dbToken = request.headers.get('x-db-token');
  if (dbToken) {
    try {
      const decoded = Buffer.from(dbToken, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      return `${parsed.host}:${parsed.port || 3306}:${parsed.database}:${parsed.user}`;
    } catch {
      // Invalid token, use default tracking key.
    }
  }
  return 'default';
}

async function ensureGroupDictionaryTables(request: NextRequest): Promise<void> {
  const poolKey = getPoolKeyFromRequest(request);
  if (tablesCheckedPerPool.get(poolKey)) return;

  const db = await getPoolForRequest(request);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS dictionary_groups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(255)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS dictionary_group_members (
      group_id INT NOT NULL,
      username VARCHAR(255) NOT NULL,
      added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, username),
      INDEX idx_group_members_username (username)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS dictionary_group_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id INT NOT NULL,
      wrong_word VARCHAR(500) NOT NULL,
      correct_word VARCHAR(500) NOT NULL,
      use_in_prompt BOOLEAN DEFAULT FALSE,
      match_stem BOOLEAN DEFAULT FALSE,
      phonetic_min_similarity DOUBLE DEFAULT NULL,
      added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      added_by VARCHAR(255),
      UNIQUE KEY unique_group_entry (group_id, wrong_word(191)),
      INDEX idx_group_entries_group (group_id)
    )
  `);

  const entryMigrations = [
    { column: 'use_in_prompt', sql: 'ADD COLUMN use_in_prompt BOOLEAN DEFAULT FALSE' },
    { column: 'match_stem', sql: 'ADD COLUMN match_stem BOOLEAN DEFAULT FALSE' },
    { column: 'phonetic_min_similarity', sql: 'ADD COLUMN phonetic_min_similarity DOUBLE DEFAULT NULL' },
    { column: 'added_by', sql: 'ADD COLUMN added_by VARCHAR(255)' },
  ];

  const [entryColumns] = await db.execute<any[]>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'dictionary_group_entries'
  `);
  const existingEntryColumns = new Set((entryColumns || []).map(row => String(row.COLUMN_NAME).toLowerCase()));

  for (const migration of entryMigrations) {
    if (!existingEntryColumns.has(migration.column)) {
      try {
        await db.execute(`ALTER TABLE dictionary_group_entries ${migration.sql}`);
      } catch {
        // Concurrent startup or existing column; safe to ignore.
      }
    }
  }

  await ensurePrivateDictionaryColumns(db);

  tablesCheckedPerPool.set(poolKey, true);
}

async function ensurePrivateDictionaryColumns(db: any): Promise<void> {
  const migrations = [
    { column: 'use_in_prompt', sql: 'ADD COLUMN use_in_prompt BOOLEAN DEFAULT FALSE' },
    { column: 'match_stem', sql: 'ADD COLUMN match_stem BOOLEAN DEFAULT FALSE' },
    { column: 'phonetic_min_similarity', sql: 'ADD COLUMN phonetic_min_similarity DOUBLE DEFAULT NULL' },
  ];

  const [columns] = await db.execute(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'dictionary_entries'
  `);
  const existingColumns = new Set(((columns || []) as any[]).map((row: any) => String(row.COLUMN_NAME).toLowerCase()));

  for (const migration of migrations) {
    if (!existingColumns.has(migration.column)) {
      try {
        await db.execute(`ALTER TABLE dictionary_entries ${migration.sql}`);
      } catch {
        // Existing column or concurrent startup.
      }
    }
  }
}

function rowToEntry(row: any): GroupDictionaryEntry {
  return {
    id: Number(row.id),
    groupId: Number(row.group_id),
    groupName: row.group_name || row.name || '',
    wrong: row.wrong_word,
    correct: row.correct_word,
    addedAt: row.added_at?.toISOString?.() || new Date().toISOString(),
    useInPrompt: Boolean(row.use_in_prompt),
    matchStem: Boolean(row.match_stem),
    phoneticMinSimilarity: row.phonetic_min_similarity ?? undefined,
    addedBy: row.added_by || '',
  };
}

export async function listDictionaryGroupsWithRequest(request: NextRequest): Promise<DictionaryGroup[]> {
  await ensureGroupDictionaryTables(request);
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute<any[]>(`
    SELECT
      g.id,
      g.name,
      COALESCE(g.description, '') AS description,
      g.created_at,
      COALESCE(g.created_by, '') AS created_by,
      COUNT(DISTINCT m.username) AS member_count,
      COUNT(DISTINCT e.id) AS entry_count
    FROM dictionary_groups g
    LEFT JOIN dictionary_group_members m ON m.group_id = g.id
    LEFT JOIN dictionary_group_entries e ON e.group_id = g.id
    GROUP BY g.id, g.name, g.description, g.created_at, g.created_by
    ORDER BY g.name ASC
  `);

  return rows.map(row => ({
    id: Number(row.id),
    name: row.name,
    description: row.description || '',
    createdAt: row.created_at?.toISOString?.() || new Date().toISOString(),
    createdBy: row.created_by || '',
    memberCount: Number(row.member_count || 0),
    entryCount: Number(row.entry_count || 0),
  }));
}

export async function createDictionaryGroupWithRequest(
  request: NextRequest,
  name: string,
  description: string,
  createdBy: string
): Promise<{ success: boolean; id?: number; error?: string }> {
  const trimmedName = name?.trim();
  if (!trimmedName) return { success: false, error: 'Gruppenname erforderlich' };

  try {
    await ensureGroupDictionaryTables(request);
    const db = await getPoolForRequest(request);
    const [result] = await db.execute<any>(
      'INSERT INTO dictionary_groups (name, description, created_by) VALUES (?, ?, ?)',
      [trimmedName, description?.trim() || '', createdBy]
    );
    return { success: true, id: Number(result.insertId) };
  } catch (error: any) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return { success: false, error: 'Gruppe existiert bereits' };
    }
    console.error('[GroupDictionary] Create group error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

export async function deleteDictionaryGroupWithRequest(request: NextRequest, groupId: number): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureGroupDictionaryTables(request);
    const db = await getPoolForRequest(request);
    await db.execute('DELETE FROM dictionary_group_entries WHERE group_id = ?', [groupId]);
    await db.execute('DELETE FROM dictionary_group_members WHERE group_id = ?', [groupId]);
    const [result] = await db.execute<any>('DELETE FROM dictionary_groups WHERE id = ?', [groupId]);
    if (result.affectedRows === 0) return { success: false, error: 'Gruppe nicht gefunden' };
    return { success: true };
  } catch (error) {
    console.error('[GroupDictionary] Delete group error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

export async function getDictionaryGroupMembersWithRequest(request: NextRequest, groupId: number): Promise<GroupMember[]> {
  await ensureGroupDictionaryTables(request);
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute<any[]>(
    'SELECT username, added_at FROM dictionary_group_members WHERE group_id = ? ORDER BY username ASC',
    [groupId]
  );
  return rows.map(row => ({
    username: row.username,
    addedAt: row.added_at?.toISOString?.() || new Date().toISOString(),
  }));
}

export async function setDictionaryGroupMembersWithRequest(
  request: NextRequest,
  groupId: number,
  usernames: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureGroupDictionaryTables(request);
    const db = await getPoolForRequest(request);
    const normalizedUsers = [...new Set(usernames.map(u => u.trim()).filter(Boolean))];
    await db.execute('DELETE FROM dictionary_group_members WHERE group_id = ?', [groupId]);

    for (const username of normalizedUsers) {
      await db.execute(
        'INSERT IGNORE INTO dictionary_group_members (group_id, username) VALUES (?, ?)',
        [groupId, username]
      );
    }
    return { success: true };
  } catch (error) {
    console.error('[GroupDictionary] Set members error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

export async function getDictionaryGroupEntriesWithRequest(request: NextRequest, groupId: number): Promise<GroupDictionaryEntry[]> {
  await ensureGroupDictionaryTables(request);
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute<any[]>(`
    SELECT e.*, g.name AS group_name
    FROM dictionary_group_entries e
    JOIN dictionary_groups g ON g.id = e.group_id
    WHERE e.group_id = ?
    ORDER BY e.added_at DESC
  `, [groupId]);

  return rows.map(rowToEntry);
}

export async function getEntriesForUserGroupsWithRequest(request: NextRequest, username: string): Promise<GroupDictionaryEntry[]> {
  await ensureGroupDictionaryTables(request);
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute<any[]>(`
    SELECT e.*, g.name AS group_name
    FROM dictionary_group_entries e
    JOIN dictionary_groups g ON g.id = e.group_id
    JOIN dictionary_group_members m ON m.group_id = g.id
    WHERE m.username = ?
    ORDER BY e.added_at DESC
  `, [username]);

  const seen = new Set<string>();
  const entries: GroupDictionaryEntry[] = [];
  for (const row of rows) {
    const key = String(row.wrong_word).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(rowToEntry(row));
  }
  return entries;
}

export async function upsertDictionaryGroupEntryWithRequest(
  request: NextRequest,
  groupId: number,
  wrong: string,
  correct: string,
  useInPrompt: boolean,
  matchStem: boolean,
  addedBy: string
): Promise<{ success: boolean; error?: string }> {
  const wrongTrimmed = wrong?.trim();
  const correctTrimmed = correct?.trim();
  if (!wrongTrimmed || !correctTrimmed) return { success: false, error: 'Beide Felder müssen ausgefüllt sein' };
  if (wrongTrimmed === correctTrimmed) return { success: false, error: 'Falsches und korrektes Wort sind identisch' };

  try {
    await ensureGroupDictionaryTables(request);
    const db = await getPoolForRequest(request);
    await db.execute(
      `INSERT INTO dictionary_group_entries (group_id, wrong_word, correct_word, use_in_prompt, match_stem, added_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE correct_word = VALUES(correct_word), use_in_prompt = VALUES(use_in_prompt), match_stem = VALUES(match_stem), added_by = VALUES(added_by), added_at = CURRENT_TIMESTAMP`,
      [groupId, wrongTrimmed, correctTrimmed, useInPrompt ? 1 : 0, matchStem ? 1 : 0, addedBy]
    );
    return { success: true };
  } catch (error) {
    console.error('[GroupDictionary] Upsert entry error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

export async function removeDictionaryGroupEntryWithRequest(request: NextRequest, groupId: number, wrong: string): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureGroupDictionaryTables(request);
    const db = await getPoolForRequest(request);
    const [result] = await db.execute<any>(
      'DELETE FROM dictionary_group_entries WHERE group_id = ? AND wrong_word = ?',
      [groupId, wrong]
    );
    if (result.affectedRows === 0) return { success: false, error: 'Eintrag nicht gefunden' };
    return { success: true };
  } catch (error) {
    console.error('[GroupDictionary] Remove entry error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

export async function getGroupImportCandidatesWithRequest(request: NextRequest, groupId: number): Promise<GroupImportCandidate[]> {
  await ensureGroupDictionaryTables(request);
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute<any[]>(`
    SELECT
      d.username,
      d.wrong_word,
      d.correct_word,
      d.added_at,
      COALESCE(d.use_in_prompt, 0) AS use_in_prompt,
      COALESCE(d.match_stem, 0) AS match_stem,
      d.phonetic_min_similarity,
      ge.correct_word AS group_correct_word
    FROM dictionary_group_members m
    JOIN dictionary_entries d ON d.username = m.username
    LEFT JOIN dictionary_group_entries ge ON ge.group_id = m.group_id AND ge.wrong_word = d.wrong_word
    WHERE m.group_id = ?
    ORDER BY d.username ASC, d.added_at DESC
  `, [groupId]);

  return rows.map(row => ({
    sourceUsername: row.username,
    wrong: row.wrong_word,
    correct: row.correct_word,
    addedAt: row.added_at?.toISOString?.() || new Date().toISOString(),
    useInPrompt: Boolean(row.use_in_prompt),
    matchStem: Boolean(row.match_stem),
    phoneticMinSimilarity: row.phonetic_min_similarity ?? undefined,
    alreadyInGroup: row.group_correct_word !== null && row.group_correct_word !== undefined,
    groupCorrect: row.group_correct_word || undefined,
  }));
}

export async function importEntriesToGroupWithRequest(
  request: NextRequest,
  groupId: number,
  entries: { wrong: string; correct: string; useInPrompt?: boolean; matchStem?: boolean; sourceUsername?: string }[],
  overwriteExisting: boolean,
  addedBy: string
): Promise<{ success: boolean; imported: number; skipped: number; error?: string }> {
  try {
    await ensureGroupDictionaryTables(request);
    const db = await getPoolForRequest(request);
    let imported = 0;
    let skipped = 0;

    for (const entry of entries) {
      const wrong = entry.wrong?.trim();
      const correct = entry.correct?.trim();
      if (!wrong || !correct || wrong === correct) {
        skipped += 1;
        continue;
      }

      const sql = overwriteExisting
        ? `INSERT INTO dictionary_group_entries (group_id, wrong_word, correct_word, use_in_prompt, match_stem, added_by)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE correct_word = VALUES(correct_word), use_in_prompt = VALUES(use_in_prompt), match_stem = VALUES(match_stem), added_by = VALUES(added_by), added_at = CURRENT_TIMESTAMP`
        : `INSERT IGNORE INTO dictionary_group_entries (group_id, wrong_word, correct_word, use_in_prompt, match_stem, added_by)
           VALUES (?, ?, ?, ?, ?, ?)`;

      const [result] = await db.execute<any>(sql, [
        groupId,
        wrong,
        correct,
        entry.useInPrompt ? 1 : 0,
        entry.matchStem ? 1 : 0,
        entry.sourceUsername ? `${addedBy} via ${entry.sourceUsername}` : addedBy,
      ]);

      if (result.affectedRows > 0) imported += 1;
      else skipped += 1;
    }

    return { success: true, imported, skipped };
  } catch (error) {
    console.error('[GroupDictionary] Import entries error:', error);
    return { success: false, imported: 0, skipped: 0, error: 'Datenbankfehler' };
  }
}