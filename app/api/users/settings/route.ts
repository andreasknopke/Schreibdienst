import { NextRequest, NextResponse } from 'next/server';
import { 
  authenticateUserWithRequest,
  getUserSettingsWithRequest,
  updateUserSettingsWithRequest
} from '@/lib/usersDb';

// Authenticate request and return username
async function authenticateRequest(request: NextRequest): Promise<{ valid: boolean; username?: string }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return { valid: false };
  }
  
  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    const result = await authenticateUserWithRequest(request, username, password);
    
    if (result.success && result.user) {
      return { valid: true, username: result.user.username };
    }
  } catch {
    // Invalid auth header
  }
  
  return { valid: false };
}

// GET /api/users/settings - Get current user's settings
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    
    if (!auth.valid || !auth.username) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const settings = await getUserSettingsWithRequest(request, auth.username);
    
    if (!settings) {
      // Return defaults for root user or if not found
      return NextResponse.json({ autoCorrect: true, dictionarySet: 'alltag' });
    }
    
    return NextResponse.json(settings);
  } catch (error) {
    console.error('[Settings GET] Error:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Einstellungen', autoCorrect: true, dictionarySet: 'alltag' }, { status: 500 });
  }
}

// PATCH /api/users/settings - Update current user's settings
export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    
    if (!auth.valid || !auth.username) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const body = await request.json();
    const { autoCorrect, dictionarySet } = body as {
      autoCorrect?: unknown;
      dictionarySet?: unknown;
    };
    const hasAutoCorrect = autoCorrect !== undefined;
    const hasDictionarySet = dictionarySet !== undefined;
    const normalizedDictionarySet =
      dictionarySet === 'alltag' || dictionarySet === 'medical' || dictionarySet === 'abteilung'
        ? dictionarySet
        : undefined;
    
    // Validate input
    if (!hasAutoCorrect && !hasDictionarySet) {
      return NextResponse.json({ success: false, error: 'Keine Einstellung angegeben' }, { status: 400 });
    }

    if (hasAutoCorrect && typeof autoCorrect !== 'boolean') {
      return NextResponse.json({ success: false, error: 'Ungültige Einstellung' }, { status: 400 });
    }

    if (hasDictionarySet && !normalizedDictionarySet) {
      return NextResponse.json({ success: false, error: 'Ungültiges dictionarySet' }, { status: 400 });
    }

    const result = await updateUserSettingsWithRequest(request, auth.username, {
      autoCorrect: hasAutoCorrect ? (autoCorrect as boolean) : undefined,
      dictionarySet: normalizedDictionarySet,
    });
    
    if (result.success) {
      return NextResponse.json({
        success: true,
        ...(hasAutoCorrect ? { autoCorrect } : {}),
        ...(hasDictionarySet ? { dictionarySet: normalizedDictionarySet } : {}),
      });
    }
    
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('[Settings PATCH] Error:', error);
    return NextResponse.json({ success: false, error: 'Fehler beim Speichern der Einstellungen' }, { status: 500 });
  }
}
