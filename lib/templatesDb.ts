import { NextRequest } from 'next/server';
import { query, execute, getPoolForRequest } from './db';
import { normalizeRichTextRanges, type RichTextFormatRange } from './richTextFormatting';
import { getEntriesForUserTemplateGroupsWithRequest, getUserTemplateGroupIds, upsertTemplateGroupEntryWithRequest } from './templateGroupDb';

export interface Template {
  id: number;
  name: string;
  content: string;
  field: 'methodik' | 'befund' | 'beurteilung';
  formatRanges: RichTextFormatRange[];
  createdAt: string;
  updatedAt: string;
  /** 'private' | 'group' – woher dieser Template stammt */
  scope?: 'private' | 'group';
  /** Gruppenname, falls scope='group' */
  groupName?: string;
  /** Username, nur bei scope='private' relevant (für Admin-Ansicht) */
  username?: string;
  /** Ordner-ID für Ordner-Struktur */
  folderId?: number | null;
}

interface DbTemplate {
  id: number;
  username: string;
  name: string;
  content: string;
  field: 'methodik' | 'befund' | 'beurteilung';
  format_ranges?: string | null;
  created_at: Date;
  updated_at: Date;
}

function parseFormatRanges(content: string, raw: string | null | undefined): RichTextFormatRange[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeRichTextRanges(parsed, content.length);
  } catch {
    return [];
  }
}

function serializeFormatRanges(content: string, ranges: RichTextFormatRange[]): string {
  return JSON.stringify(normalizeRichTextRanges(ranges, content.length));
}

// Get all templates for a user
export async function getTemplates(username: string): Promise<Template[]> {
  try {
    const templates = await query<DbTemplate>(
      'SELECT id, name, content, field, created_at, updated_at FROM templates WHERE username = ? ORDER BY name ASC',
      [username]
    );
    
    return templates.map(t => ({
      id: t.id,
      name: t.name,
      content: t.content,
      field: t.field || 'befund',
      formatRanges: parseFormatRanges(t.content, t.format_ranges),
      createdAt: t.created_at?.toISOString() || new Date().toISOString(),
      updatedAt: t.updated_at?.toISOString() || new Date().toISOString()
    }));
  } catch (error) {
    console.error('[Templates] Get templates error:', error);
    return [];
  }
}

// Get templates with dynamic DB pool
export async function getTemplatesWithRequest(request: NextRequest, username: string): Promise<Template[]> {
  try {
    const pool = await getPoolForRequest(request);
    const [rows] = await pool.query<any[]>(
      'SELECT id, name, content, field, format_ranges, folder_id, created_at, updated_at FROM templates WHERE username = ? ORDER BY name ASC',
      [username]
    );
    
    return (rows || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      content: t.content,
      field: t.field || 'befund',
      formatRanges: parseFormatRanges(t.content, t.format_ranges),
      createdAt: t.created_at?.toISOString() || new Date().toISOString(),
      updatedAt: t.updated_at?.toISOString() || new Date().toISOString(),
      scope: 'private' as const,
      username,
      folderId: t.folder_id !== null && t.folder_id !== undefined ? Number(t.folder_id) : undefined,
    }));
  } catch (error) {
    console.error('[Templates] Get templates with request error:', error);
    return [];
  }
}

/**
 * Lädt Templates für einen User (privat + Gruppe) und merged sie.
 * Private Templates überschreiben Gruppen-Templates bei Namensgleichheit.
 */
export async function loadTemplatesForUserWithRequest(
  request: NextRequest,
  username: string
): Promise<{ templates: Template[] }> {
  const [privateEntries, groupEntries] = await Promise.all([
    getTemplatesWithRequest(request, username),
    getEntriesForUserTemplateGroupsWithRequest(request, username),
  ]);

  const templates: Template[] = [];
  const seen = new Set<string>();

  // Private zuerst (sie gewinnen bei Konflikten)
  for (const entry of privateEntries) {
    seen.add(entry.name.toLowerCase());
    templates.push(entry);
  }

  // Gruppen-Templates, die nicht bereits privat existieren
  for (const entry of groupEntries) {
    const key = entry.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    templates.push({
      id: entry.id,
      name: entry.name,
      content: entry.content,
      field: entry.field,
      formatRanges: entry.formatRanges,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      scope: 'group',
      groupName: entry.groupName,
    });
  }

  return { templates };
}

// Add new template
export async function addTemplateWithRequest(
  request: NextRequest, 
  username: string, 
  name: string, 
  content: string,
  field: 'methodik' | 'befund' | 'beurteilung' = 'befund',
  formatRanges: RichTextFormatRange[] = [],
  groupIds: boolean | number[] = false,
): Promise<{ success: boolean; error?: string; id?: number }> {
  if (!name?.trim() || !content?.trim()) {
    return { success: false, error: 'Name und Inhalt müssen ausgefüllt sein' };
  }

  const nameTrimmed = name.trim();
  const contentTrimmed = content.trim();

  try {
    const pool = await getPoolForRequest(request);
    
    // Check if template with same name exists
    const [existing] = await pool.query<any[]>(
      'SELECT id FROM templates WHERE username = ? AND name = ?',
      [username, nameTrimmed]
    );
    
    if (existing && existing.length > 0) {
      return { success: false, error: 'Ein Textbaustein mit diesem Namen existiert bereits' };
    }
    
    const [result] = await pool.execute<any>(
      'INSERT INTO templates (username, name, content, field, format_ranges) VALUES (?, ?, ?, ?, ?)',
      [username.toLowerCase(), nameTrimmed, contentTrimmed, field, serializeFormatRanges(contentTrimmed, formatRanges)]
    );
    
    console.log('[Templates] Added template for', username, ':', nameTrimmed);

    // Optional: in bestimmte Gruppen übernehmen
    const targetGroupIds = Array.isArray(groupIds) ? groupIds
      : groupIds ? await getUserTemplateGroupIds(request, username)
      : [];
    for (const groupId of targetGroupIds) {
      await upsertTemplateGroupEntryWithRequest(
        request,
        groupId,
        nameTrimmed,
        contentTrimmed,
        field,
        formatRanges,
        username
      );
    }

    return { success: true, id: result.insertId };
  } catch (error) {
    console.error('[Templates] Add template error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Update template
export async function updateTemplateWithRequest(
  request: NextRequest, 
  username: string, 
  id: number,
  name: string, 
  content: string,
  field: 'methodik' | 'befund' | 'beurteilung' = 'befund',
  formatRanges: RichTextFormatRange[] = [],
): Promise<{ success: boolean; error?: string }> {
  if (!name?.trim() || !content?.trim()) {
    return { success: false, error: 'Name und Inhalt müssen ausgefüllt sein' };
  }

  try {
    const pool = await getPoolForRequest(request);
    
    // Check if template belongs to user
    const [existing] = await pool.query<any[]>(
      'SELECT id FROM templates WHERE id = ? AND username = ?',
      [id, username]
    );
    
    if (!existing || existing.length === 0) {
      return { success: false, error: 'Textbaustein nicht gefunden' };
    }
    
    // Check if new name conflicts with another template
    const [conflict] = await pool.query<any[]>(
      'SELECT id FROM templates WHERE username = ? AND name = ? AND id != ?',
      [username, name.trim(), id]
    );
    
    if (conflict && conflict.length > 0) {
      return { success: false, error: 'Ein anderer Textbaustein mit diesem Namen existiert bereits' };
    }
    
    await pool.execute(
      'UPDATE templates SET name = ?, content = ?, field = ?, format_ranges = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name.trim(), content.trim(), field, serializeFormatRanges(content.trim(), formatRanges), id]
    );
    
    console.log('[Templates] Updated template', id, 'for', username);
    return { success: true };
  } catch (error) {
    console.error('[Templates] Update template error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Delete template
export async function deleteTemplateWithRequest(
  request: NextRequest, 
  username: string, 
  id: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const pool = await getPoolForRequest(request);
    
    const [result] = await pool.execute<any>(
      'DELETE FROM templates WHERE id = ? AND username = ?',
      [id, username]
    );
    
    if (result.affectedRows === 0) {
      return { success: false, error: 'Textbaustein nicht gefunden' };
    }
    
    console.log('[Templates] Deleted template', id, 'for', username);
    return { success: true };
  } catch (error) {
    console.error('[Templates] Delete template error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Ensure templates table exists
export async function ensureTemplatesTable(request: NextRequest): Promise<void> {
  try {
    const pool = await getPoolForRequest(request);
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        name VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        field ENUM('methodik', 'befund', 'beurteilung') DEFAULT 'befund',
        format_ranges TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_template (username, name)
      )
    `);
    try {
      await pool.execute('ALTER TABLE templates ADD COLUMN format_ranges TEXT NULL');
    } catch (alterError: any) {
      if (!String(alterError?.message || '').includes('Duplicate column')) {
        throw alterError;
      }
    }
    console.log('[Templates] Table ensured');
  } catch (error) {
    console.error('[Templates] Ensure table error:', error);
  }
}
