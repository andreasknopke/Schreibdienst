import { NextRequest } from 'next/server';
import { query, execute, getPoolForRequest } from './db';

export interface CustomAction {
  id: number;
  name: string;
  icon: string;
  prompt: string;
  targetField: 'current' | 'methodik' | 'befund' | 'beurteilung' | 'all';
  createdAt: string;
  updatedAt: string;
}

interface DbCustomAction {
  id: number;
  username: string;
  name: string;
  icon: string;
  prompt: string;
  target_field: 'current' | 'methodik' | 'befund' | 'beurteilung' | 'all';
  created_at: Date;
  updated_at: Date;
}

// Get all custom actions for a user
export async function getCustomActions(username: string): Promise<CustomAction[]> {
  try {
    const actions = await query<DbCustomAction>(
      'SELECT id, name, icon, prompt, target_field, created_at, updated_at FROM custom_actions WHERE LOWER(username) = LOWER(?) ORDER BY name ASC',
      [username]
    );
    
    return actions.map(a => ({
      id: a.id,
      name: a.name,
      icon: a.icon || '⚡',
      prompt: a.prompt,
      targetField: a.target_field || 'current',
      createdAt: a.created_at?.toISOString() || new Date().toISOString(),
      updatedAt: a.updated_at?.toISOString() || new Date().toISOString()
    }));
  } catch (error) {
    console.error('[CustomActions] Get actions error:', error);
    return [];
  }
}

// Get custom actions with dynamic DB pool
export async function getCustomActionsWithRequest(request: NextRequest, username: string): Promise<CustomAction[]> {
  try {
    const pool = await getPoolForRequest(request);
    const [rows] = await pool.query<any[]>(
      'SELECT id, name, icon, prompt, target_field, created_at, updated_at FROM custom_actions WHERE LOWER(username) = LOWER(?) ORDER BY name ASC',
      [username]
    );
    
    return (rows || []).map((a: DbCustomAction) => ({
      id: a.id,
      name: a.name,
      icon: a.icon || '⚡',
      prompt: a.prompt,
      targetField: a.target_field || 'current',
      createdAt: a.created_at?.toISOString() || new Date().toISOString(),
      updatedAt: a.updated_at?.toISOString() || new Date().toISOString()
    }));
  } catch (error) {
    console.error('[CustomActions] Get actions with request error:', error);
    return [];
  }
}

// Add new custom action
export async function addCustomActionWithRequest(
  request: NextRequest, 
  username: string, 
  name: string, 
  icon: string,
  prompt: string,
  targetField: 'current' | 'methodik' | 'befund' | 'beurteilung' | 'all' = 'current'
): Promise<{ success: boolean; error?: string; id?: number }> {
  if (!name?.trim() || !prompt?.trim()) {
    return { success: false, error: 'Name und Prompt müssen ausgefüllt sein' };
  }

  const nameTrimmed = name.trim();
  const promptTrimmed = prompt.trim();
  const iconTrimmed = icon?.trim() || '⚡';

  try {
    const pool = await getPoolForRequest(request);
    
    // Check if action with same name exists
    const [existing] = await pool.query<any[]>(
      'SELECT id FROM custom_actions WHERE LOWER(username) = LOWER(?) AND LOWER(name) = LOWER(?)',
      [username, nameTrimmed]
    );
    
    if (existing && existing.length > 0) {
      return { success: false, error: 'Eine Aktion mit diesem Namen existiert bereits' };
    }
    
    const [result] = await pool.execute<any>(
      'INSERT INTO custom_actions (username, name, icon, prompt, target_field) VALUES (?, ?, ?, ?, ?)',
      [username.toLowerCase(), nameTrimmed, iconTrimmed, promptTrimmed, targetField]
    );
    
    console.log('[CustomActions] Added action:', nameTrimmed, 'for user:', username);
    return { success: true, id: result.insertId };
  } catch (error: any) {
    console.error('[CustomActions] Add action error:', error);
    return { success: false, error: error.message || 'Datenbankfehler' };
  }
}

// Update custom action
export async function updateCustomActionWithRequest(
  request: NextRequest,
  username: string,
  id: number,
  name: string,
  icon: string,
  prompt: string,
  targetField: 'current' | 'methodik' | 'befund' | 'beurteilung' | 'all'
): Promise<{ success: boolean; error?: string }> {
  if (!name?.trim() || !prompt?.trim()) {
    return { success: false, error: 'Name und Prompt müssen ausgefüllt sein' };
  }

  const nameTrimmed = name.trim();
  const promptTrimmed = prompt.trim();
  const iconTrimmed = icon?.trim() || '⚡';

  try {
    const pool = await getPoolForRequest(request);
    
    // Check if action exists and belongs to user
    const [existing] = await pool.query<any[]>(
      'SELECT id FROM custom_actions WHERE id = ? AND LOWER(username) = LOWER(?)',
      [id, username]
    );
    
    if (!existing || existing.length === 0) {
      return { success: false, error: 'Aktion nicht gefunden' };
    }
    
    // Check if another action with same name exists
    const [duplicate] = await pool.query<any[]>(
      'SELECT id FROM custom_actions WHERE LOWER(username) = LOWER(?) AND LOWER(name) = LOWER(?) AND id != ?',
      [username, nameTrimmed, id]
    );
    
    if (duplicate && duplicate.length > 0) {
      return { success: false, error: 'Eine andere Aktion mit diesem Namen existiert bereits' };
    }
    
    await pool.execute(
      'UPDATE custom_actions SET name = ?, icon = ?, prompt = ?, target_field = ?, updated_at = NOW() WHERE id = ?',
      [nameTrimmed, iconTrimmed, promptTrimmed, targetField, id]
    );
    
    console.log('[CustomActions] Updated action:', id, nameTrimmed);
    return { success: true };
  } catch (error: any) {
    console.error('[CustomActions] Update action error:', error);
    return { success: false, error: error.message || 'Datenbankfehler' };
  }
}

// Delete custom action
export async function deleteCustomActionWithRequest(
  request: NextRequest,
  username: string,
  id: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const pool = await getPoolForRequest(request);
    
    const [result] = await pool.execute<any>(
      'DELETE FROM custom_actions WHERE id = ? AND LOWER(username) = LOWER(?)',
      [id, username]
    );
    
    if (result.affectedRows === 0) {
      return { success: false, error: 'Aktion nicht gefunden oder keine Berechtigung' };
    }
    
    console.log('[CustomActions] Deleted action:', id);
    return { success: true };
  } catch (error: any) {
    console.error('[CustomActions] Delete action error:', error);
    return { success: false, error: error.message || 'Datenbankfehler' };
  }
}
