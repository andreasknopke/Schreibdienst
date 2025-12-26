import crypto from 'crypto';
import { query, execute } from './db';

export interface User {
  username: string;
  password_hash: string;
  is_admin: boolean;
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
export async function authenticateUser(username: string, password: string): Promise<{ success: boolean; user?: { username: string; isAdmin: boolean }; error?: string }> {
  // Check for root user first
  if (username.toLowerCase() === 'root') {
    const rootPassword = getRootPassword();
    if (!rootPassword) {
      return { success: false, error: 'Root-Passwort nicht konfiguriert' };
    }
    if (password === rootPassword) {
      return { success: true, user: { username: 'root', isAdmin: true } };
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
    
    return { success: true, user: { username: user.username, isAdmin: user.is_admin } };
  } catch (error) {
    console.error('[Users] Auth error:', error);
    return { success: false, error: 'Datenbankfehler' };
  }
}

// Create a new user
export async function createUser(username: string, password: string, isAdmin: boolean, createdBy: string): Promise<{ success: boolean; error?: string }> {
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
      'INSERT INTO users (username, password_hash, is_admin, created_by) VALUES (?, ?, ?, ?)',
      [username, hashPassword(password), isAdmin, createdBy]
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
export async function listUsers(): Promise<{ username: string; isAdmin: boolean; createdAt: string; createdBy: string }[]> {
  try {
    const users = await query<User>(
      'SELECT username, is_admin, created_at, created_by FROM users ORDER BY created_at DESC'
    );
    
    return users.map(u => ({
      username: u.username,
      isAdmin: u.is_admin,
      createdAt: u.created_at?.toISOString() || new Date().toISOString(),
      createdBy: u.created_by || 'system'
    }));
  } catch (error) {
    console.error('[Users] List error:', error);
    return [];
  }
}
