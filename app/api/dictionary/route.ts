import { NextRequest, NextResponse } from 'next/server';
import { addEntry, removeEntry, getEntries } from '@/lib/dictionaryDb';
import { authenticateUser } from '@/lib/usersDb';

interface AuthResult {
  username: string;
  canViewAllDictations: boolean;
}

// Extract username and permissions from auth header
async function getAuthenticatedUser(authHeader: string | null): Promise<AuthResult | null> {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }
  
  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    const result = await authenticateUser(username, password);
    
    if (result.success && result.user) {
      return {
        username: result.user.username,
        canViewAllDictations: result.user.canViewAllDictations || false,
      };
    }
  } catch {
    // Invalid auth header
  }
  
  return null;
}

// GET /api/dictionary - Get user's dictionary entries
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const auth = await getAuthenticatedUser(authHeader);
    
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Nicht authentifiziert - bitte erneut anmelden' }, { status: 401 });
    }

    // Secretariat users can view other users' dictionaries
    const { searchParams } = new URL(request.url);
    const targetUser = searchParams.get('user');
    const username = (auth.canViewAllDictations && targetUser) ? targetUser : auth.username;

    const entries = await getEntries(username);
    return NextResponse.json({ entries });
  } catch (error) {
    console.error('[Dictionary GET] Error:', error);
    return NextResponse.json({ success: false, error: 'Fehler beim Laden des Wörterbuchs', entries: [] }, { status: 500 });
  }
}

// POST /api/dictionary - Add entry to dictionary
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const auth = await getAuthenticatedUser(authHeader);
    
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Nicht authentifiziert - bitte erneut anmelden' }, { status: 401 });
    }

    const body = await request.json();
    const { wrong, correct, username: targetUsername } = body;
    
    if (!wrong || !correct) {
      return NextResponse.json({ success: false, error: 'Beide Felder müssen ausgefüllt sein' }, { status: 400 });
    }
    
    // Secretariat users can add to other users' dictionaries
    const username = (auth.canViewAllDictations && targetUsername) ? targetUsername : auth.username;
    
    const result = await addEntry(username, wrong, correct);
    
    if (result.success) {
      return NextResponse.json({ success: true, message: 'Eintrag hinzugefügt' });
    }
    
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('Dictionary POST error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

// DELETE /api/dictionary - Remove entry from dictionary
export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const auth = await getAuthenticatedUser(authHeader);
    
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Nicht authentifiziert - bitte erneut anmelden' }, { status: 401 });
    }

    const body = await request.json();
    const { wrong, username: targetUsername } = body;
    
    if (!wrong) {
      return NextResponse.json({ success: false, error: 'Kein Wort zum Löschen angegeben' }, { status: 400 });
    }
    
    // Secretariat users can delete from other users' dictionaries
    const username = (auth.canViewAllDictations && targetUsername) ? targetUsername : auth.username;
    
    const result = await removeEntry(username, wrong);
    
    if (result.success) {
      return NextResponse.json({ success: true, message: 'Eintrag gelöscht' });
    }
    
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('Dictionary DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}
