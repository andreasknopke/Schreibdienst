import { NextRequest, NextResponse } from 'next/server';
import { createUser, deleteUser, changePassword, listUsers, authenticateUser } from '@/lib/users';

// Middleware to check if request is from admin
function isAdmin(authHeader: string | null): { valid: boolean; username?: string } {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return { valid: false };
  }
  
  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    const result = authenticateUser(username, password);
    
    if (result.success && result.user?.isAdmin) {
      return { valid: true, username: result.user.username };
    }
  } catch {
    // Invalid auth header
  }
  
  return { valid: false };
}

// GET /api/users - List all users (admin only)
export async function GET(request: NextRequest) {
  const auth = isAdmin(request.headers.get('Authorization'));
  
  if (!auth.valid) {
    return NextResponse.json({ error: 'Nur für Administratoren' }, { status: 403 });
  }

  const users = listUsers();
  return NextResponse.json({ users });
}

// POST /api/users - Create a new user (admin only)
export async function POST(request: NextRequest) {
  const auth = isAdmin(request.headers.get('Authorization'));
  
  if (!auth.valid) {
    return NextResponse.json({ error: 'Nur für Administratoren' }, { status: 403 });
  }

  try {
    const { username, password, isAdmin: makeAdmin = false } = await request.json();
    
    const result = createUser(username, password, makeAdmin, auth.username!);
    
    if (result.success) {
      return NextResponse.json({ success: true, message: 'Benutzer erstellt' });
    }
    
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch {
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

// DELETE /api/users - Delete a user (admin only)
export async function DELETE(request: NextRequest) {
  const auth = isAdmin(request.headers.get('Authorization'));
  
  if (!auth.valid) {
    return NextResponse.json({ error: 'Nur für Administratoren' }, { status: 403 });
  }

  try {
    const { username } = await request.json();
    
    const result = deleteUser(username);
    
    if (result.success) {
      return NextResponse.json({ success: true, message: 'Benutzer gelöscht' });
    }
    
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch {
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

// PATCH /api/users - Change user password (admin only)
export async function PATCH(request: NextRequest) {
  const auth = isAdmin(request.headers.get('Authorization'));
  
  if (!auth.valid) {
    return NextResponse.json({ error: 'Nur für Administratoren' }, { status: 403 });
  }

  try {
    const { username, newPassword } = await request.json();
    
    const result = changePassword(username, newPassword);
    
    if (result.success) {
      return NextResponse.json({ success: true, message: 'Passwort geändert' });
    }
    
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch {
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}
