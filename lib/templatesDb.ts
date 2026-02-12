import { NextRequest } from 'next/server';
import { query, execute, getPoolForRequest } from './db';

export interface Template {
  id: number;
  name: string;
  content: string;
  field: 'methodik' | 'befund' | 'beurteilung';
  createdAt: string;
  updatedAt: string;
}

interface DbTemplate {
  id: number;
  username: string;
  name: string;
  content: string;
  field: 'methodik' | 'befund' | 'beurteilung';
  created_at: Date;
  updated_at: Date;
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
      'SELECT id, name, content, field, created_at, updated_at FROM templates WHERE username = ? ORDER BY name ASC',
      [username]
    );
    
    return (rows || []).map((t: DbTemplate) => ({
      id: t.id,
      name: t.name,
      content: t.content,
      field: t.field || 'befund',
      createdAt: t.created_at?.toISOString() || new Date().toISOString(),
      updatedAt: t.updated_at?.toISOString() || new Date().toISOString()
    }));
  } catch (error) {
    console.error('[Templates] Get templates with request error:', error);
    return [];
  }
}

// Add new template
export async function addTemplateWithRequest(
  request: NextRequest, 
  username: string, 
  name: string, 
  content: string,
  field: 'methodik' | 'befund' | 'beurteilung' = 'befund'
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
      'INSERT INTO templates (username, name, content, field) VALUES (?, ?, ?, ?)',
      [username.toLowerCase(), nameTrimmed, contentTrimmed, field]
    );
    
    console.log('[Templates] Added template for', username, ':', nameTrimmed);
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
  field: 'methodik' | 'befund' | 'beurteilung' = 'befund'
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
      'UPDATE templates SET name = ?, content = ?, field = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name.trim(), content.trim(), field, id]
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_template (username, name)
      )
    `);
    console.log('[Templates] Table ensured');
  } catch (error) {
    console.error('[Templates] Ensure table error:', error);
  }
}
