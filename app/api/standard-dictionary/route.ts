import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { getStandardDictEntries, addStandardDictEntry, removeStandardDictEntry, resetStandardDict } from '@/lib/standardDictionaryDb';

// Auth-Prüfung: nur Admins dürfen das Standard-Wörterbuch bearbeiten
async function getAuthenticatedAdmin(request: NextRequest): Promise<{ username: string; isAdmin: boolean } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) return null;

  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    const result = await authenticateUserWithRequest(request, username, password);

    if (result.success && result.user) {
      return { username: result.user.username, isAdmin: result.user.isAdmin };
    }
  } catch {
    // Invalid auth
  }
  return null;
}

// GET /api/standard-dictionary — Alle Einträge laden (jeder authentifizierte User)
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const entries = await getStandardDictEntries(request);
    return NextResponse.json({ entries });
  } catch (error) {
    console.error('[StandardDict API] GET error:', error);
    return NextResponse.json({ error: 'Fehler beim Laden' }, { status: 500 });
  }
}

// POST /api/standard-dictionary — Eintrag hinzufügen (nur Admin)
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    }
    if (!auth.isAdmin) {
      return NextResponse.json({ error: 'Nur Administratoren können das Standard-Wörterbuch bearbeiten' }, { status: 403 });
    }

    const body = await request.json();
    const { wrong, correct, category } = body;

    if (!wrong || !correct) {
      return NextResponse.json({ error: 'Beide Felder müssen ausgefüllt sein' }, { status: 400 });
    }

    const result = await addStandardDictEntry(request, wrong.trim(), correct.trim(), category?.trim() || '');
    if (result.success) {
      return NextResponse.json({ success: true, createdSelfMapping: result.createdSelfMapping ?? false });
    }
    return NextResponse.json({ error: result.error }, { status: 500 });
  } catch (error) {
    console.error('[StandardDict API] POST error:', error);
    return NextResponse.json({ error: 'Fehler beim Hinzufügen' }, { status: 500 });
  }
}

// DELETE /api/standard-dictionary — Eintrag löschen (nur Admin)
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthenticatedAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    }
    if (!auth.isAdmin) {
      return NextResponse.json({ error: 'Nur Administratoren können das Standard-Wörterbuch bearbeiten' }, { status: 403 });
    }

    const body = await request.json();
    const { wrong } = body;

    if (!wrong) {
      return NextResponse.json({ error: 'Kein Wort angegeben' }, { status: 400 });
    }

    const result = await removeStandardDictEntry(request, wrong);
    if (result.success) {
      return NextResponse.json({ success: true, removedAutoSelfMapping: result.removedAutoSelfMapping ?? false });
    }
    return NextResponse.json({ error: result.error }, { status: 500 });
  } catch (error) {
    console.error('[StandardDict API] DELETE error:', error);
    return NextResponse.json({ error: 'Fehler beim Löschen' }, { status: 500 });
  }
}

// PATCH /api/standard-dictionary — Spezialaktionen (z.B. Reset)
export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthenticatedAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    }
    if (!auth.isAdmin) {
      return NextResponse.json({ error: 'Nur Administratoren' }, { status: 403 });
    }

    const body = await request.json();

    if (body.action === 'reset') {
      const result = await resetStandardDict(request);
      if (result.success) {
        return NextResponse.json({ success: true, count: result.count, message: 'Standard-Wörterbuch zurückgesetzt' });
      }
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ error: 'Unbekannte Aktion' }, { status: 400 });
  } catch (error) {
    console.error('[StandardDict API] PATCH error:', error);
    return NextResponse.json({ error: 'Fehler' }, { status: 500 });
  }
}
