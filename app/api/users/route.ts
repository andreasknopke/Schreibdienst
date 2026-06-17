import { NextRequest, NextResponse } from 'next/server';
import { 
  createUserWithRequest, 
  deleteUserWithRequest, 
  changePasswordWithRequest, 
  listUsersWithRequest, 
  authenticateUserWithRequest, 
  updateUserPermissionsWithRequest,
  renameUserWithRequest
} from '@/lib/usersDb';
import { parseBasicAuth } from '@/lib/apiHelpers';

// Middleware to check if request is from admin
async function isAdmin(request: NextRequest): Promise<{ valid: boolean; username?: string }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return { valid: false };
  }
  
  try {
    const parsed = parseBasicAuth(authHeader);
    if (!parsed) return { valid: false };
    const result = await authenticateUserWithRequest(request, parsed.username, parsed.password);
    
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
  try {
    const auth = await isAdmin(request);
    
    if (!auth.valid) {
      return NextResponse.json({ error: 'Nur für Administratoren' }, { status: 403 });
    }

    const users = await listUsersWithRequest(request);
    return NextResponse.json({ users });
  } catch (error) {
    console.error('[Users GET] Error:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Benutzer', users: [] }, { status: 500 });
  }
}

// POST /api/users - Create a new user (admin only)
export async function POST(request: NextRequest) {
  try {
    const auth = await isAdmin(request);
    
    if (!auth.valid) {
      return NextResponse.json({ error: 'Nur für Administratoren' }, { status: 403 });
    }

    const { username, password, isAdmin: makeAdmin = false, canViewAllDictations = false } = await request.json();
    
    const result = await createUserWithRequest(request, username, password, makeAdmin, auth.username!, canViewAllDictations);
    
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
  try {
    const auth = await isAdmin(request);
    
    if (!auth.valid) {
      return NextResponse.json({ error: 'Nur für Administratoren' }, { status: 403 });
    }

    const { username } = await request.json();
    
    const result = await deleteUserWithRequest(request, username);
    
    if (result.success) {
      return NextResponse.json({ success: true, message: 'Benutzer gelöscht' });
    }
    
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch {
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

// PATCH /api/users - Change user password, permissions, or rename (admin only)
export async function PATCH(request: NextRequest) {
  try {
    const auth = await isAdmin(request);
    
    if (!auth.valid) {
      return NextResponse.json({ error: 'Nur für Administratoren' }, { status: 403 });
    }

    const { username, newPassword, newUsername, permissions } = await request.json();
    
    // Rename user (all references: dictations, dictionary, templates, groups, etc.)
    if (newUsername) {
      const result = await renameUserWithRequest(request, username, newUsername);
      
      if (result.success) {
        return NextResponse.json({ success: true, message: `Benutzer umbenannt in "${newUsername}"` });
      }
      
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }
    
    // If permissions update
    if (permissions) {
      const result = await updateUserPermissionsWithRequest(request, username, permissions);
      
      if (result.success) {
        return NextResponse.json({ success: true, message: 'Berechtigungen aktualisiert' });
      }
      
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }
    
    // Password change
    const result = await changePasswordWithRequest(request, username, newPassword);
    
    if (result.success) {
      return NextResponse.json({ success: true, message: 'Passwort geändert' });
    }
    
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch {
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}
