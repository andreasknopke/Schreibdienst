import { NextRequest, NextResponse } from 'next/server';
import { addEntry, removeEntry, getEntries } from '@/lib/dictionary';
import { authenticateUser } from '@/lib/users';

// Extract username from auth header
function getAuthenticatedUser(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }
  
  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    const result = authenticateUser(username, password);
    
    if (result.success && result.user) {
      return result.user.username;
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
    const username = getAuthenticatedUser(authHeader);
    
    if (!username) {
      return NextResponse.json({ success: false, error: 'Nicht authentifiziert - bitte erneut anmelden' }, { status: 401 });
    }

    const entries = getEntries(username);
    return NextResponse.json({ entries });
  } catch (error) {
    console.error('[Dictionary GET] Error:', error);
    return NextResponse.json({ success: false, error: 'Fehler beim Laden des Wörterbuchs', entries: [] }, { status: 500 });
  }
}

// POST /api/dictionary - Add entry to dictionary
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const username = getAuthenticatedUser(authHeader);
  
  if (!username) {
    return NextResponse.json({ success: false, error: 'Nicht authentifiziert - bitte erneut anmelden' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { wrong, correct } = body;
    
    if (!wrong || !correct) {
      return NextResponse.json({ success: false, error: 'Beide Felder müssen ausgefüllt sein' }, { status: 400 });
    }
    
    const result = addEntry(username, wrong, correct);
    
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
  const authHeader = request.headers.get('Authorization');
  const username = getAuthenticatedUser(authHeader);
  
  if (!username) {
    return NextResponse.json({ success: false, error: 'Nicht authentifiziert - bitte erneut anmelden' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { wrong } = body;
    
    if (!wrong) {
      return NextResponse.json({ success: false, error: 'Kein Wort zum Löschen angegeben' }, { status: 400 });
    }
    
    const result = removeEntry(username, wrong);
    
    if (result.success) {
      return NextResponse.json({ success: true, message: 'Eintrag gelöscht' });
    }
    
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('Dictionary DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}
