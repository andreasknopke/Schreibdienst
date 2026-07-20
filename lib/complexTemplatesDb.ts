import { NextRequest } from 'next/server';
import { getPoolForRequest } from './db';

export interface ComplexTemplate {
  id: number;
  name: string;
  field: 'methodik' | 'befund' | 'beurteilung';
  templateIds: number[];
  folderId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface DbComplexTemplate {
  id: number;
  username: string;
  name: string;
  field: 'methodik' | 'befund' | 'beurteilung';
  template_ids: string;
  folder_id: number | null;
  created_at: Date;
  updated_at: Date;
}

export async function ensureComplexTemplatesTable(request: NextRequest): Promise<void> {
  const pool = await getPoolForRequest(request);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS complex_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      field VARCHAR(50) NOT NULL DEFAULT 'befund',
      template_ids TEXT NOT NULL,
      folder_id INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // folder_id hinzufügen falls Tabelle bereits ohne diese Spalte existiert
  try {
    await pool.query(`ALTER TABLE complex_templates ADD COLUMN folder_id INT DEFAULT NULL`);
  } catch { /* bereits vorhanden */ }
}

export async function getComplexTemplates(request: NextRequest, username: string): Promise<ComplexTemplate[]> {
  try {
    const pool = await getPoolForRequest(request);
    const [rows] = await pool.query<any[]>(
      'SELECT id, name, field, template_ids, folder_id, created_at, updated_at FROM complex_templates WHERE username = ? ORDER BY name ASC',
      [username]
    );
    return (rows || []).map((t: DbComplexTemplate) => ({
      id: t.id,
      name: t.name,
      field: t.field || 'befund',
      templateIds: parseTemplateIds(t.template_ids),
      folderId: t.folder_id ?? null,
      createdAt: t.created_at?.toISOString() || new Date().toISOString(),
      updatedAt: t.updated_at?.toISOString() || new Date().toISOString(),
    }));
  } catch (error) {
    console.error('[ComplexTemplates] Get error:', error);
    return [];
  }
}

export async function addComplexTemplate(
  request: NextRequest,
  username: string,
  name: string,
  field: string,
  templateIds: number[],
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    const pool = await getPoolForRequest(request);
    const [result] = await pool.query<any>(
      'INSERT INTO complex_templates (username, name, field, template_ids) VALUES (?, ?, ?, ?)',
      [username, name, field, JSON.stringify(templateIds)]
    );
    return { success: true, id: result.insertId };
  } catch (error) {
    console.error('[ComplexTemplates] Add error:', error);
    return { success: false, error: 'Fehler beim Anlegen des Komplexbausteins' };
  }
}

export async function updateComplexTemplate(
  request: NextRequest,
  username: string,
  id: number,
  name: string,
  field: string,
  templateIds: number[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const pool = await getPoolForRequest(request);
    await pool.query(
      'UPDATE complex_templates SET name = ?, field = ?, template_ids = ? WHERE id = ? AND username = ?',
      [name, field, JSON.stringify(templateIds), id, username]
    );
    return { success: true };
  } catch (error) {
    console.error('[ComplexTemplates] Update error:', error);
    return { success: false, error: 'Fehler beim Aktualisieren des Komplexbausteins' };
  }
}

export async function deleteComplexTemplate(
  request: NextRequest,
  username: string,
  id: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const pool = await getPoolForRequest(request);
    await pool.query(
      'DELETE FROM complex_templates WHERE id = ? AND username = ?',
      [id, username]
    );
    return { success: true };
  } catch (error) {
    console.error('[ComplexTemplates] Delete error:', error);
    return { success: false, error: 'Fehler beim Löschen des Komplexbausteins' };
  }
}

function parseTemplateIds(raw: string): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(Number).filter((n) => !isNaN(n));
  } catch {
    // ignore
  }
  return [];
}

export async function moveComplexTemplateToFolder(
  request: NextRequest,
  templateId: number,
  folderId: number | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const pool = await getPoolForRequest(request);
    await pool.query(
      'UPDATE complex_templates SET folder_id = ? WHERE id = ?',
      [folderId, templateId],
    );
    return { success: true };
  } catch (error) {
    console.error('[ComplexTemplates] Move error:', error);
    return { success: false, error: 'Fehler beim Verschieben' };
  }
}
