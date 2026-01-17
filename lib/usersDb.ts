import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { query, execute, getPoolForRequest } from './db';

export interface User {
  username: string;
  password_hash: string;
  is_admin: boolean;
  can_view_all_dictations: boolean;
  auto_correct: boolean;
  default_mode: 'befund' | 'arztbrief';
  created_at: Date;
  created_by: string;
}

// Hash password with SHA-256
export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Verify password against hash
export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

// Get root password from environment
function getRootPassword(): string {
  return process.env.AUTH_PASSWORD || '';
}

// Authenticate user - returns user info if successful
export async function authenticateUser(username: string, password: string): Promise<{ success: boolean; user?: { username: string; isAdmin: boolean; canViewAllDictations: boolean; autoCorrect: boolean; defaultMode: 'befund' | 'arztbrief' }; error?: string }> {
  // Check for root user first
  if (username.toLowerCase() === 'root') {
    const rootPassword = getRootPassword();
    if (!rootPassword) {
      return { success: false, error: 'Root-Passwort nicht konfiguriert' };
    }
    if (password === rootPassword) {
      return { success: true, user: { username: 'root', isAdmin: true, canViewAllDictations: true, autoCorrect: true, defaultMode: 'befund' } };
    }
    return { success: false, error: 'Falsches Passwort' };
  }

  // Check database users
  try {
    const users = await query<User>(
      'SELECT * FROM users WHERE LOWER(username) = LOWER(?)',
      [username]
    );
    
    if (users.length === 0) {
      return { success: false, error: 'Benutzer nicht gefunden' };
    }
    
    const user = users[0];
    
    if (!verifyPassword(password, user.password_hash)) {
      return { success: false, error: 'Falsches Passwort' };
    }
    
    return { success: true, user: { username: user.username, isAdmin: user.is_admin, canViewAllDictations: user.can_view_all_dictations || user.is_admin, autoCorrect: user.auto_correct !== false, defaultMode: user.default_mode || 'befund' } };
  } catch (error) {
    console.error('[Users] Auth error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Create a new user
export async function createUser(username: string, password: string, isAdmin: boolean, createdBy: string, canViewAllDictations: boolean = false): Promise<{ success: boolean; error?: string }> {
  if (!username || !password) {
    return { success: false, error: 'Benutzername und Passwort erforderlich' };
  }

  if (username.toLowerCase() === 'root') {
    return { success: false, error: 'Benutzername "root" ist reserviert' };
  }

  if (password.length < 4) {
    return { success: false, error: 'Passwort muss mindestens 4 Zeichen haben' };
  }

  try {
    // Check if user exists
    const existing = await query<User>(
      'SELECT username FROM users WHERE LOWER(username) = LOWER(?)',
      [username]
    );
    
    if (existing.length > 0) {
      return { success: false, error: 'Benutzer existiert bereits' };
    }
    
    // Create user
    await execute(
      'INSERT INTO users (username, password_hash, is_admin, can_view_all_dictations, created_by) VALUES (?, ?, ?, ?, ?)',
      [username, hashPassword(password), isAdmin, canViewAllDictations || isAdmin, createdBy]
    );
    
    console.log('[Users] Created user:', username);
    return { success: true };
  } catch (error) {
    console.error('[Users] Create error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Delete a user
export async function deleteUser(username: string): Promise<{ success: boolean; error?: string }> {
  if (username.toLowerCase() === 'root') {
    return { success: false, error: 'Root-Benutzer kann nicht gelöscht werden' };
  }

  try {
    const result = await execute(
      'DELETE FROM users WHERE LOWER(username) = LOWER(?)',
      [username]
    );
    
    if (result.affectedRows === 0) {
      return { success: false, error: 'Benutzer nicht gefunden' };
    }
    
    // Also delete user's dictionary entries
    await execute(
      'DELETE FROM dictionary_entries WHERE LOWER(username) = LOWER(?)',
      [username]
    );
    
    console.log('[Users] Deleted user:', username);
    return { success: true };
  } catch (error) {
    console.error('[Users] Delete error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Change user password
export async function changePassword(username: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  if (username.toLowerCase() === 'root') {
    return { success: false, error: 'Root-Passwort kann nur über Umgebungsvariable geändert werden' };
  }

  if (newPassword.length < 4) {
    return { success: false, error: 'Passwort muss mindestens 4 Zeichen haben' };
  }

  try {
    const result = await execute(
      'UPDATE users SET password_hash = ? WHERE LOWER(username) = LOWER(?)',
      [hashPassword(newPassword), username]
    );
    
    if (result.affectedRows === 0) {
      return { success: false, error: 'Benutzer nicht gefunden' };
    }
    
    console.log('[Users] Changed password for:', username);
    return { success: true };
  } catch (error) {
    console.error('[Users] Change password error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// List all users (for admin)
export async function listUsers(): Promise<{ username: string; isAdmin: boolean; canViewAllDictations: boolean; createdAt: string; createdBy: string }[]> {
  try {
    const users = await query<User>(
      'SELECT username, is_admin, can_view_all_dictations, created_at, created_by FROM users ORDER BY created_at DESC'
    );
    
    return users.map(u => ({
      username: u.username,
      isAdmin: u.is_admin,
      canViewAllDictations: u.can_view_all_dictations || u.is_admin,
      createdAt: u.created_at?.toISOString() || new Date().toISOString(),
      createdBy: u.created_by || 'system'
    }));
  } catch (error) {
    console.error('[Users] List error:', error);
    return [];
  }
}

// Update user permissions
export async function updateUserPermissions(username: string, permissions: { isAdmin?: boolean; canViewAllDictations?: boolean }): Promise<{ success: boolean; error?: string }> {
  if (username.toLowerCase() === 'root') {
    return { success: false, error: 'Root-Benutzer kann nicht geändert werden' };
  }

  try {
    const updates: string[] = [];
    const params: any[] = [];
    
    if (permissions.isAdmin !== undefined) {
      updates.push('is_admin = ?');
      params.push(permissions.isAdmin);
    }
    if (permissions.canViewAllDictations !== undefined) {
      updates.push('can_view_all_dictations = ?');
      params.push(permissions.canViewAllDictations);
    }
    
    if (updates.length === 0) {
      return { success: false, error: 'Keine Änderungen angegeben' };
    }
    
    params.push(username);
    
    const result = await execute(
      `UPDATE users SET ${updates.join(', ')} WHERE LOWER(username) = LOWER(?)`,
      params
    );
    
    if (result.affectedRows === 0) {
      return { success: false, error: 'Benutzer nicht gefunden' };
    }
    
    console.log('[Users] Updated permissions for:', username, permissions);
    return { success: true };
  } catch (error) {
    console.error('[Users] Update permissions error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// ============================================================
// Request-basierte Funktionen (für dynamische DB über Token)
// ============================================================

// Authenticate user with Request context (uses dynamic DB if token present)
export async function authenticateUserWithRequest(
  request: NextRequest,
  username: string, 
  password: string
): Promise<{ success: boolean; user?: { username: string; isAdmin: boolean; canViewAllDictations: boolean; autoCorrect: boolean; defaultMode: 'befund' | 'arztbrief' }; error?: string }> {
  const start = Date.now();
  
  // Check for root user first (no DB needed)
  if (username.toLowerCase() === 'root') {
    const rootPassword = getRootPassword();
    if (!rootPassword) {
      return { success: false, error: 'Root-Passwort nicht konfiguriert' };
    }
    if (password === rootPassword) {
      return { success: true, user: { username: 'root', isAdmin: true, canViewAllDictations: true, autoCorrect: true, defaultMode: 'befund' } };
    }
    return { success: false, error: 'Falsches Passwort' };
  }

  // Check database users with dynamic pool
  try {
    const poolStart = Date.now();
    const db = await getPoolForRequest(request);
    const poolTime = Date.now() - poolStart;
    
    const queryStart = Date.now();
    const [rows] = await db.execute<any[]>(
      'SELECT * FROM users WHERE LOWER(username) = LOWER(?)',
      [username]
    );
    const queryTime = Date.now() - queryStart;
    
    const totalTime = Date.now() - start;
    if (totalTime > 100) {
      console.log(`[Users] Auth timing: pool=${poolTime}ms, query=${queryTime}ms, total=${totalTime}ms`);
    }
    
    if (rows.length === 0) {
      return { success: false, error: 'Benutzer nicht gefunden' };
    }
    
    const user = rows[0] as User;
    
    if (!verifyPassword(password, user.password_hash)) {
      return { success: false, error: 'Falsches Passwort' };
    }
    
    return { success: true, user: { username: user.username, isAdmin: user.is_admin, canViewAllDictations: user.can_view_all_dictations || user.is_admin, autoCorrect: user.auto_correct !== false, defaultMode: user.default_mode || 'befund' } };
  } catch (error) {
    console.error('[Users] Auth error (with request):', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Get user settings with Request context
export async function getUserSettingsWithRequest(
  request: NextRequest,
  username: string
): Promise<{ autoCorrect: boolean; defaultMode: 'befund' | 'arztbrief' } | null> {
  // Root user always has autoCorrect enabled
  if (username.toLowerCase() === 'root') {
    return { autoCorrect: true, defaultMode: 'befund' };
  }

  try {
    const db = await getPoolForRequest(request);
    const [rows] = await db.execute<any[]>(
      'SELECT auto_correct, default_mode FROM users WHERE LOWER(username) = LOWER(?)',
      [username]
    );
    
    if (rows.length === 0) {
      return null;
    }
    
    const user = rows[0];
    return { autoCorrect: user.auto_correct !== false, defaultMode: user.default_mode || 'befund' };
  } catch (error) {
    console.error('[Users] Get settings error:', error);
    return null;
  }
}

// Update user settings with Request context
export async function updateUserSettingsWithRequest(
  request: NextRequest,
  username: string,
  settings: { autoCorrect?: boolean }
): Promise<{ success: boolean; error?: string }> {
  if (username.toLowerCase() === 'root') {
    return { success: false, error: 'Root-Benutzer-Einstellungen können nicht geändert werden' };
  }

  try {
    const updates: string[] = [];
    const params: any[] = [];
    
    if (settings.autoCorrect !== undefined) {
      updates.push('auto_correct = ?');
      params.push(settings.autoCorrect);
    }
    
    if (updates.length === 0) {
      return { success: false, error: 'Keine Änderungen angegeben' };
    }
    
    params.push(username);
    
    const db = await getPoolForRequest(request);
    const [result] = await db.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE LOWER(username) = LOWER(?)`,
      params
    );
    
    if ((result as any).affectedRows === 0) {
      return { success: false, error: 'Benutzer nicht gefunden' };
    }
    
    console.log('[Users] Updated settings for:', username, settings);
    return { success: true };
  } catch (error) {
    console.error('[Users] Update settings error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// List users with Request context
export async function listUsersWithRequest(request: NextRequest): Promise<{ username: string; isAdmin: boolean; canViewAllDictations: boolean; defaultMode: 'befund' | 'arztbrief'; createdAt: string; createdBy: string }[]> {
  try {
    const db = await getPoolForRequest(request);
    const [rows] = await db.execute<any[]>(
      'SELECT username, is_admin, can_view_all_dictations, default_mode, created_at, created_by FROM users ORDER BY created_at DESC'
    );
    
    return (rows as User[]).map(u => ({
      username: u.username,
      isAdmin: u.is_admin,
      canViewAllDictations: u.can_view_all_dictations || u.is_admin,
      defaultMode: u.default_mode || 'befund',
      createdAt: u.created_at?.toISOString() || new Date().toISOString(),
      createdBy: u.created_by || 'system'
    }));
  } catch (error) {
    console.error('[Users] List error (with request):', error);
    return [];
  }
}

// Create user with Request context
export async function createUserWithRequest(
  request: NextRequest,
  username: string, 
  password: string, 
  isAdmin: boolean, 
  createdBy: string, 
  canViewAllDictations: boolean = false
): Promise<{ success: boolean; error?: string }> {
  if (!username || !password) {
    return { success: false, error: 'Benutzername und Passwort erforderlich' };
  }

  if (username.toLowerCase() === 'root') {
    return { success: false, error: 'Benutzername "root" ist reserviert' };
  }

  if (password.length < 4) {
    return { success: false, error: 'Passwort muss mindestens 4 Zeichen haben' };
  }

  try {
    const db = await getPoolForRequest(request);
    
    // Check if user exists
    const [existing] = await db.execute<any[]>(
      'SELECT username FROM users WHERE LOWER(username) = LOWER(?)',
      [username]
    );
    
    if ((existing as any[]).length > 0) {
      return { success: false, error: 'Benutzer existiert bereits' };
    }
    
    // Create user
    await db.execute(
      'INSERT INTO users (username, password_hash, is_admin, can_view_all_dictations, created_by) VALUES (?, ?, ?, ?, ?)',
      [username, hashPassword(password), isAdmin, canViewAllDictations || isAdmin, createdBy]
    );
    
    console.log('[Users] Created user (with request):', username);
    return { success: true };
  } catch (error) {
    console.error('[Users] Create error (with request):', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Delete user with Request context
export async function deleteUserWithRequest(request: NextRequest, username: string): Promise<{ success: boolean; error?: string }> {
  if (username.toLowerCase() === 'root') {
    return { success: false, error: 'Root-Benutzer kann nicht gelöscht werden' };
  }

  try {
    const db = await getPoolForRequest(request);
    
    const [result] = await db.execute(
      'DELETE FROM users WHERE LOWER(username) = LOWER(?)',
      [username]
    );
    
    if ((result as any).affectedRows === 0) {
      return { success: false, error: 'Benutzer nicht gefunden' };
    }
    
    // Also delete user's dictionary entries
    await db.execute(
      'DELETE FROM dictionary_entries WHERE LOWER(username) = LOWER(?)',
      [username]
    );
    
    console.log('[Users] Deleted user (with request):', username);
    return { success: true };
  } catch (error) {
    console.error('[Users] Delete error (with request):', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Change password with Request context
export async function changePasswordWithRequest(request: NextRequest, username: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  if (username.toLowerCase() === 'root') {
    return { success: false, error: 'Root-Passwort kann nur über Umgebungsvariable geändert werden' };
  }

  if (newPassword.length < 4) {
    return { success: false, error: 'Passwort muss mindestens 4 Zeichen haben' };
  }

  try {
    const db = await getPoolForRequest(request);
    
    const [result] = await db.execute(
      'UPDATE users SET password_hash = ? WHERE LOWER(username) = LOWER(?)',
      [hashPassword(newPassword), username]
    );
    
    if ((result as any).affectedRows === 0) {
      return { success: false, error: 'Benutzer nicht gefunden' };
    }
    
    console.log('[Users] Changed password (with request) for:', username);
    return { success: true };
  } catch (error) {
    console.error('[Users] Change password error (with request):', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Update permissions with Request context
export async function updateUserPermissionsWithRequest(
  request: NextRequest,
  username: string, 
  permissions: { isAdmin?: boolean; canViewAllDictations?: boolean; defaultMode?: 'befund' | 'arztbrief' }
): Promise<{ success: boolean; error?: string }> {
  if (username.toLowerCase() === 'root') {
    return { success: false, error: 'Root-Benutzer kann nicht geändert werden' };
  }

  try {
    const updates: string[] = [];
    const params: any[] = [];
    
    if (permissions.isAdmin !== undefined) {
      updates.push('is_admin = ?');
      params.push(permissions.isAdmin);
    }
    if (permissions.canViewAllDictations !== undefined) {
      updates.push('can_view_all_dictations = ?');
      params.push(permissions.canViewAllDictations);
    }
    if (permissions.defaultMode !== undefined) {
      updates.push('default_mode = ?');
      params.push(permissions.defaultMode);
    }
    
    if (updates.length === 0) {
      return { success: false, error: 'Keine Änderungen angegeben' };
    }
    
    params.push(username);
    
    const db = await getPoolForRequest(request);
    const [result] = await db.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE LOWER(username) = LOWER(?)`,
      params
    );
    
    if ((result as any).affectedRows === 0) {
      return { success: false, error: 'Benutzer nicht gefunden' };
    }
    
    console.log('[Users] Updated permissions (with request) for:', username, permissions);
    return { success: true };
  } catch (error) {
    console.error('[Users] Update permissions error (with request):', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}
