import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const USERS_FILE = path.join(process.cwd(), 'cache', 'users.json');

export interface User {
  username: string;
  passwordHash: string;
  isAdmin: boolean;
  createdAt: string;
  createdBy: string;
}

interface UsersData {
  users: User[];
}

// Hash password with SHA-256
export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Verify password against hash
export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

// Load users from file
function loadUsers(): UsersData {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading users:', error);
  }
  return { users: [] };
}

// Save users to file
function saveUsers(data: UsersData): void {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Get root password from environment - read fresh each time
function getRootPassword(): string {
  const password = process.env.AUTH_PASSWORD;
  console.log('[Auth] AUTH_PASSWORD configured:', !!password);
  return password || '';
}

// Authenticate user - returns user info if successful
export function authenticateUser(username: string, password: string): { success: boolean; user?: { username: string; isAdmin: boolean }; error?: string } {
  console.log('[Auth] Attempting login for user:', username);
  
  // Check for root user first
  if (username.toLowerCase() === 'root') {
    const rootPassword = getRootPassword();
    if (!rootPassword) {
      console.log('[Auth] ERROR: AUTH_PASSWORD environment variable is not set');
      return { success: false, error: 'Root-Passwort nicht konfiguriert - AUTH_PASSWORD fehlt in Umgebungsvariablen' };
    }
    if (password === rootPassword) {
      console.log('[Auth] Root login successful');
      return { success: true, user: { username: 'root', isAdmin: true } };
    }
    console.log('[Auth] Root login failed - wrong password');
    return { success: false, error: 'Falsches Passwort' };
  }

  // Check regular users
  const data = loadUsers();
  const user = data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  
  if (!user) {
    return { success: false, error: 'Benutzer nicht gefunden' };
  }

  if (!verifyPassword(password, user.passwordHash)) {
    return { success: false, error: 'Falsches Passwort' };
  }

  return { success: true, user: { username: user.username, isAdmin: user.isAdmin } };
}

// Create a new user (admin only)
export function createUser(username: string, password: string, isAdmin: boolean, createdBy: string): { success: boolean; error?: string } {
  if (!username?.trim()) {
    return { success: false, error: 'Benutzername erforderlich' };
  }

  if (!password || password.length < 4) {
    return { success: false, error: 'Passwort muss mindestens 4 Zeichen haben' };
  }

  if (username.toLowerCase() === 'root') {
    return { success: false, error: 'Benutzername "root" ist reserviert' };
  }

  const data = loadUsers();
  
  if (data.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return { success: false, error: 'Benutzer existiert bereits' };
  }

  data.users.push({
    username: username.trim(),
    passwordHash: hashPassword(password),
    isAdmin,
    createdAt: new Date().toISOString(),
    createdBy
  });

  saveUsers(data);
  return { success: true };
}

// Delete a user (admin only)
export function deleteUser(username: string): { success: boolean; error?: string } {
  if (username.toLowerCase() === 'root') {
    return { success: false, error: 'Root-Benutzer kann nicht gelöscht werden' };
  }

  const data = loadUsers();
  const index = data.users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
  
  if (index === -1) {
    return { success: false, error: 'Benutzer nicht gefunden' };
  }

  data.users.splice(index, 1);
  saveUsers(data);
  return { success: true };
}

// Change user password
export function changePassword(username: string, newPassword: string): { success: boolean; error?: string } {
  if (username.toLowerCase() === 'root') {
    return { success: false, error: 'Root-Passwort kann nur in .env.local geändert werden' };
  }

  if (!newPassword || newPassword.length < 4) {
    return { success: false, error: 'Passwort muss mindestens 4 Zeichen haben' };
  }

  const data = loadUsers();
  const user = data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  
  if (!user) {
    return { success: false, error: 'Benutzer nicht gefunden' };
  }

  user.passwordHash = hashPassword(newPassword);
  saveUsers(data);
  return { success: true };
}

// List all users (admin only)
export function listUsers(): { username: string; isAdmin: boolean; createdAt: string; createdBy: string }[] {
  const data = loadUsers();
  return data.users.map(u => ({
    username: u.username,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
    createdBy: u.createdBy
  }));
}
