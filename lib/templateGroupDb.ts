import { NextRequest } from 'next/server';
import { getPoolForRequest } from './db';
import type { Template } from './templatesDb';

export interface TemplateGroup {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  createdBy: string;
  memberCount: number;
  entryCount: number;
}

export interface GroupTemplateEntry {
  id: number;
  groupId: number;
  groupName: string;
  name: string;
  content: string;
  field: 'methodik' | 'befund' | 'beurteilung';
  formatRanges: any[];
  addedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  username: string;
  addedAt: string;
}

export interface TemplateImportCandidate {
  sourceUsername: string;
  name: string;
  content: string;
  field: 'methodik' | 'befund' | 'beurteilung';
  formatRanges?: any[];
  alreadyInGroup: boolean;
  groupName?: string;
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

async function ensureTemplateGroupTables(request: NextRequest): Promise<void> {
  const poolKey = getPoolKeyFromRequest(request);
  if (tablesCheckedPerPool.get(poolKey)) return;

  const db = await getPoolForRequest(request);

  // Hinweis: Die Tabelle dictionary_groups und dictionary_group_members werden
  // von groupDictionaryDb.ts verwaltet – hier wird NUR template_group_entries
  // angelegt, das an dictionary_groups.id anknüpft.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS template_group_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      content TEXT NOT NULL,
      field ENUM('methodik', 'befund', 'beurteilung') DEFAULT 'befund',
      format_ranges TEXT NULL,
      added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      added_by VARCHAR(255),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_group_template (group_id, name),
      INDEX idx_template_group_entries_group (group_id)
    )
  `);

  // Migration: Alte separate Tabellen löschen (seit Einführung der
  // gemeinsamen Gruppen-Tabelle dictionary_groups nicht mehr nötig)
  try { await db.execute('DROP TABLE IF EXISTS template_group_members'); } catch { /* ignore */ }
  try { await db.execute('DROP TABLE IF EXISTS template_groups'); } catch { /* ignore */ }

  tablesCheckedPerPool.set(poolKey, true);
}

// ─── Service Functions ───────────────────────────────────────────────────────

export async function listTemplateGroupsWithRequest(request: NextRequest): Promise<TemplateGroup[]> {
  await ensureTemplateGroupTables(request);
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
    LEFT JOIN template_group_entries e ON e.group_id = g.id
    GROUP BY g.id, g.name, g.description, g.created_at, g.created_by
    ORDER BY g.name ASC
  `);

  return rows.map((row: any) => ({
    id: Number(row.id),
    name: row.name,
    description: row.description || '',
    createdAt: row.created_at?.toISOString?.() || new Date().toISOString(),
    createdBy: row.created_by || '',
    memberCount: Number(row.member_count || 0),
    entryCount: Number(row.entry_count || 0),
  }));
}

export async function createTemplateGroupWithRequest(
  request: NextRequest,
  name: string,
  description: string,
  createdBy: string
): Promise<{ success: boolean; id?: number; error?: string }> {
  const trimmedName = name?.trim();
  if (!trimmedName) return { success: false, error: 'Gruppenname erforderlich' };

  try {
    await ensureTemplateGroupTables(request);
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
    console.error('[TemplateGroup] Create group error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

export async function deleteTemplateGroupWithRequest(request: NextRequest, groupId: number): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureTemplateGroupTables(request);
    const db = await getPoolForRequest(request);
    await db.execute('DELETE FROM template_group_entries WHERE group_id = ?', [groupId]);
    await db.execute('DELETE FROM dictionary_group_members WHERE group_id = ?', [groupId]);
    const [result] = await db.execute<any>('DELETE FROM dictionary_groups WHERE id = ?', [groupId]);
    if (result.affectedRows === 0) return { success: false, error: 'Gruppe nicht gefunden' };
    return { success: true };
  } catch (error) {
    console.error('[TemplateGroup] Delete group error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

export async function getTemplateGroupMembersWithRequest(request: NextRequest, groupId: number): Promise<GroupMember[]> {
  await ensureTemplateGroupTables(request);
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute<any[]>(
    'SELECT username, added_at FROM dictionary_group_members WHERE group_id = ? ORDER BY username ASC',
    [groupId]
  );
  return rows.map((row: any) => ({
    username: row.username,
    addedAt: row.added_at?.toISOString?.() || new Date().toISOString(),
  }));
}

export async function setTemplateGroupMembersWithRequest(
  request: NextRequest,
  groupId: number,
  usernames: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureTemplateGroupTables(request);
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
    console.error('[TemplateGroup] Set members error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

export async function getTemplateGroupEntriesWithRequest(request: NextRequest, groupId: number): Promise<GroupTemplateEntry[]> {
  await ensureTemplateGroupTables(request);
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute<any[]>(`
    SELECT e.*, g.name AS group_name
    FROM template_group_entries e
    JOIN dictionary_groups g ON g.id = e.group_id
    WHERE e.group_id = ?
    ORDER BY e.name ASC
  `, [groupId]);

  return rows.map((row: any) => ({
    id: Number(row.id),
    groupId: Number(row.group_id),
    groupName: row.group_name || '',
    name: row.name,
    content: row.content,
    field: row.field || 'befund',
    formatRanges: parseFormatRanges(row.content, row.format_ranges),
    addedBy: row.added_by || '',
    createdAt: row.added_at?.toISOString?.() || new Date().toISOString(),
    updatedAt: row.updated_at?.toISOString?.() || new Date().toISOString(),
  }));
}

export async function getEntriesForUserTemplateGroupsWithRequest(request: NextRequest, username: string): Promise<GroupTemplateEntry[]> {
  await ensureTemplateGroupTables(request);
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute<any[]>(`
    SELECT e.*, g.name AS group_name
    FROM template_group_entries e
    JOIN dictionary_groups g ON g.id = e.group_id
    JOIN dictionary_group_members m ON m.group_id = g.id
    WHERE m.username = ?
    ORDER BY e.name ASC
  `, [username.toLowerCase()]);

  // Deduplizieren: spätere Gruppe überschreibt frühere bei Namenskonflikt
  const seen = new Map<string, GroupTemplateEntry>();
  for (const row of rows) {
    const key = String(row.name).toLowerCase();
    seen.set(key, {
      id: Number(row.id),
      groupId: Number(row.group_id),
      groupName: row.group_name || '',
      name: row.name,
      content: row.content,
      field: row.field || 'befund',
      formatRanges: parseFormatRanges(row.content, row.format_ranges),
      addedBy: row.added_by || '',
      createdAt: row.added_at?.toISOString?.() || new Date().toISOString(),
      updatedAt: row.updated_at?.toISOString?.() || new Date().toISOString(),
    });
  }
  return Array.from(seen.values());
}

export async function getUserTemplateGroupIds(request: NextRequest, username: string): Promise<number[]> {
  await ensureTemplateGroupTables(request);
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute<any[]>(
    'SELECT group_id FROM dictionary_group_members WHERE username = ? ORDER BY group_id ASC',
    [username.toLowerCase()]
  );
  return rows.map((row: any) => Number(row.group_id)).filter((id: number) => Number.isFinite(id));
}

export async function upsertTemplateGroupEntryWithRequest(
  request: NextRequest,
  groupId: number,
  name: string,
  content: string,
  field: 'methodik' | 'befund' | 'beurteilung',
  formatRanges: any[],
  addedBy: string
): Promise<{ success: boolean; id?: number; error?: string }> {
  const nameTrimmed = name?.trim();
  const contentTrimmed = content?.trim();
  if (!nameTrimmed || !contentTrimmed) return { success: false, error: 'Name und Inhalt müssen ausgefüllt sein' };

  try {
    await ensureTemplateGroupTables(request);
    const db = await getPoolForRequest(request);

    const serialized = JSON.stringify(formatRanges || []);

    await db.execute(
      `INSERT INTO template_group_entries (group_id, name, content, field, format_ranges, added_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE content = VALUES(content), field = VALUES(field), format_ranges = VALUES(format_ranges), added_by = VALUES(added_by), updated_at = CURRENT_TIMESTAMP`,
      [groupId, nameTrimmed, contentTrimmed, field, serialized, addedBy]
    );

    return { success: true };
  } catch (error) {
    console.error('[TemplateGroup] Upsert entry error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

export async function removeTemplateGroupEntryWithRequest(
  request: NextRequest,
  groupId: number,
  name: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureTemplateGroupTables(request);
    const db = await getPoolForRequest(request);
    const [result] = await db.execute<any>(
      'DELETE FROM template_group_entries WHERE group_id = ? AND name = ?',
      [groupId, name]
    );
    if (result.affectedRows === 0) return { success: false, error: 'Eintrag nicht gefunden' };
    return { success: true };
  } catch (error) {
    console.error('[TemplateGroup] Remove entry error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

export async function getTemplateImportCandidatesWithRequest(
  request: NextRequest,
  groupId: number
): Promise<TemplateImportCandidate[]> {
  await ensureTemplateGroupTables(request);
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute<any[]>(`
    SELECT
      t.username,
      t.name,
      t.content,
      COALESCE(t.field, 'befund') AS field,
      t.format_ranges,
      ge.name AS group_name
    FROM dictionary_group_members m
    JOIN templates t ON t.username = m.username
    LEFT JOIN template_group_entries ge ON ge.group_id = m.group_id AND ge.name = t.name
    WHERE m.group_id = ?
    ORDER BY t.username ASC, t.name ASC
  `, [groupId]);

  return rows.map((row: any) => ({
    sourceUsername: row.username,
    name: row.name,
    content: row.content,
    field: row.field || 'befund',
    formatRanges: parseFormatRanges(row.content, row.format_ranges),
    alreadyInGroup: row.group_name !== null && row.group_name !== undefined,
    groupName: row.group_name || undefined,
  }));
}

export async function importTemplatesToGroupWithRequest(
  request: NextRequest,
  groupId: number,
  entries: { name: string; content: string; field: string; formatRanges?: any[]; sourceUsername?: string }[],
  overwriteExisting: boolean,
  addedBy: string
): Promise<{ success: boolean; imported: number; skipped: number; error?: string }> {
  try {
    await ensureTemplateGroupTables(request);
    const db = await getPoolForRequest(request);
    let imported = 0;
    let skipped = 0;

    for (const entry of entries) {
      const name = entry.name?.trim();
      const content = entry.content?.trim();
      if (!name || !content) {
        skipped += 1;
        continue;
      }

      const serialized = JSON.stringify(entry.formatRanges || []);

      const sql = overwriteExisting
        ? `INSERT INTO template_group_entries (group_id, name, content, field, format_ranges, added_by)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE content = VALUES(content), field = VALUES(field), format_ranges = VALUES(format_ranges), added_by = VALUES(added_by), updated_at = CURRENT_TIMESTAMP`
        : `INSERT IGNORE INTO template_group_entries (group_id, name, content, field, format_ranges, added_by)
           VALUES (?, ?, ?, ?, ?, ?)`;

      const [result] = await db.execute<any>(sql, [
        groupId,
        name,
        content,
        entry.field || 'befund',
        serialized,
        entry.sourceUsername ? `${addedBy} via ${entry.sourceUsername}` : addedBy,
      ]);

      if (result.affectedRows > 0) imported += 1;
      else skipped += 1;
    }

    return { success: true, imported, skipped };
  } catch (error) {
    console.error('[TemplateGroup] Import entries error:', error);
    return { success: false, imported: 0, skipped: 0, error: 'Datenbankfehler' };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseFormatRanges(content: string, raw: string | null | undefined): any[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}
