import { NextRequest, NextResponse } from 'next/server';
import { addEntryWithRequest, removeEntryWithRequest, getEntriesWithRequest, updateEntryOptionsWithRequest, loadDictionaryWithRequest, increaseEntryPhoneticMinSimilarityWithRequest } from '@/lib/dictionaryDb';
import { removeDictionaryGroupEntryWithRequest, increaseDictionaryGroupEntryPhoneticMinSimilarityWithRequest } from '@/lib/groupDictionaryDb';
import { removeStandardDictEntry, increaseStandardDictPhoneticMinSimilarity } from '@/lib/standardDictionaryDb';
import { getUserGroupIds, upsertDictionaryGroupEntryWithRequest } from '@/lib/groupDictionaryDb';
import { authenticateUserWithRequest } from '@/lib/usersDb';

interface AuthResult {
  username: string;
  canViewAllDictations: boolean;
}

// Extract username and permissions from auth header
async function getAuthenticatedUser(request: NextRequest): Promise<AuthResult | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }
  
  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    const result = await authenticateUserWithRequest(request, username, password);
    
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
    const auth = await getAuthenticatedUser(request);
    
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Nicht authentifiziert - bitte erneut anmelden' }, { status: 401 });
    }

    // Secretariat users can view other users' dictionaries
    const { searchParams } = new URL(request.url);
    const targetUser = searchParams.get('user');
    const username = (auth.canViewAllDictations && targetUser) ? targetUser : auth.username;

    const scope = searchParams.get('scope');
    const entries = scope === 'private'
      ? await getEntriesWithRequest(request, username)
      : (await loadDictionaryWithRequest(request, username)).entries;
    return NextResponse.json({ entries });
  } catch (error) {
    console.error('[Dictionary GET] Error:', error);
    return NextResponse.json({ success: false, error: 'Fehler beim Laden des Wörterbuchs', entries: [] }, { status: 500 });
  }
}

// POST /api/dictionary - Add entry to dictionary
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Nicht authentifiziert - bitte erneut anmelden' }, { status: 401 });
    }

    const body = await request.json();
    const { wrong, correct, username: targetUsername, useInPrompt = false, matchStem = false, addToGroup = false } = body;
    
    if (!wrong || !correct) {
      return NextResponse.json({ success: false, error: 'Beide Felder müssen ausgefüllt sein' }, { status: 400 });
    }
    
    // Secretariat users can add to other users' dictionaries
    const username = (auth.canViewAllDictations && targetUsername) ? targetUsername : auth.username;
    
    const result = await addEntryWithRequest(request, username, wrong, correct, useInPrompt, matchStem);
    
    if (result.success) {
      let response = NextResponse.json({ success: true, message: 'Eintrag hinzugefügt' });

      if (addToGroup) {
        try {
          const groupIds = await getUserGroupIds(request, username);
          let groupInsertFailed = false;

          for (const groupId of groupIds) {
            const groupResult = await upsertDictionaryGroupEntryWithRequest(
              request,
              groupId,
              wrong,
              correct,
              useInPrompt,
              matchStem,
              auth.username
            );

            if (!groupResult.success) {
              groupInsertFailed = true;
              console.error('[Dictionary POST] Group insert failed:', {
                username,
                groupId,
                wrong,
                error: groupResult.error,
              });
            }
          }

          if (groupInsertFailed) {
            response.headers.set('X-Warning', 'GroupInsertFailed');
          }
        } catch (error) {
          console.error('[Dictionary POST] Group insert lookup failed:', {
            username,
            wrong,
            error,
          });
          response.headers.set('X-Warning', 'GroupInsertFailed');
        }
      }

      return response;
    }
    
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('Dictionary POST error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

// PATCH /api/dictionary - Update entry options
export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);

    if (!auth) {
      return NextResponse.json({ success: false, error: 'Nicht authentifiziert - bitte erneut anmelden' }, { status: 401 });
    }

    const body = await request.json();
    const { wrong, username: targetUsername, useInPrompt, matchStem, weakenPhonetic, scope, groupId } = body;

    if (!wrong) {
      return NextResponse.json({ success: false, error: 'Kein Wort angegeben' }, { status: 400 });
    }

    // Phonetic-Matching für diesen Eintrag abschwächen (Schwelle heraufsetzen)
    if (weakenPhonetic) {
      const entryScope: 'standard' | 'private' | 'group' =
        scope === 'standard' || scope === 'group' ? scope : 'private';
      const username = (auth.canViewAllDictations && targetUsername && entryScope === 'private')
        ? targetUsername : auth.username;

      if (entryScope === 'standard') {
        const result = await increaseStandardDictPhoneticMinSimilarity(request, wrong);
        if (!result.success) {
          return NextResponse.json({ success: false, error: result.error || 'Abschwächen fehlgeschlagen' }, { status: 400 });
        }
        return NextResponse.json({
          success: true,
          message: `Standard-Eintrag "${wrong}" abgeschwächt`,
          oldValue: result.oldValue,
          newValue: result.newValue,
        });
      }
      if (entryScope === 'group') {
        if (!Number.isInteger(groupId) || groupId <= 0) {
          return NextResponse.json({ success: false, error: 'groupId ist für Gruppen-Einträge erforderlich' }, { status: 400 });
        }
        const result = await increaseDictionaryGroupEntryPhoneticMinSimilarityWithRequest(request, groupId, wrong);
        if (!result.success) {
          return NextResponse.json({ success: false, error: result.error || 'Abschwächen fehlgeschlagen' }, { status: 400 });
        }
        return NextResponse.json({
          success: true,
          message: `Gruppen-Eintrag "${wrong}" abgeschwächt`,
          oldValue: result.oldValue,
          newValue: result.newValue,
        });
      }

      const result = await increaseEntryPhoneticMinSimilarityWithRequest(request, username, wrong);
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error || 'Abschwächen fehlgeschlagen' }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        message: `Benutzer-Eintrag "${wrong}" für ${username} abgeschwächt`,
        oldValue: result.oldValue,
        newValue: result.newValue,
      });
    }

    if (useInPrompt === undefined && matchStem === undefined) {
      return NextResponse.json({ success: false, error: 'Keine Änderungen angegeben' }, { status: 400 });
    }

    // Secretariat users can update other users' dictionaries
    const username = (auth.canViewAllDictations && targetUsername) ? targetUsername : auth.username;

    const result = await updateEntryOptionsWithRequest(request, username, wrong, useInPrompt ?? false, matchStem ?? false);

    if (result.success) {
      return NextResponse.json({ success: true, message: 'Eintrag aktualisiert' });
    }

    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('Dictionary PATCH error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

// DELETE /api/dictionary - Remove entry from dictionary
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);

    if (!auth) {
      return NextResponse.json({ success: false, error: 'Nicht authentifiziert - bitte erneut anmelden' }, { status: 401 });
    }

    const body = await request.json();
    const { wrong, username: targetUsername, scope, groupId } = body;

    if (!wrong) {
      return NextResponse.json({ success: false, error: 'Kein Wort zum Löschen angegeben' }, { status: 400 });
    }

    const entryScope: 'standard' | 'private' | 'group' =
      scope === 'standard' || scope === 'group' ? scope : 'private';

    // Standard-Wörterbuch: nur root darf löschen
    if (entryScope === 'standard') {
      if (auth.username.toLowerCase() !== 'root') {
        return NextResponse.json({ success: false, error: 'Nur root darf Standard-Einträge löschen' }, { status: 403 });
      }
      const result = await removeStandardDictEntry(request, wrong);
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error || 'Löschen fehlgeschlagen' }, { status: 400 });
      }
      return NextResponse.json({ success: true, message: `Standard-Eintrag "${wrong}" gelöscht` });
    }

    // Gruppen-Wörterbuch: Mitgliedschaft wird in der DB-Schicht geprüft
    if (entryScope === 'group') {
      if (!Number.isInteger(groupId) || groupId <= 0) {
        return NextResponse.json({ success: false, error: 'groupId ist für Gruppen-Einträge erforderlich' }, { status: 400 });
      }
      const result = await removeDictionaryGroupEntryWithRequest(request, groupId, wrong);
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error || 'Löschen fehlgeschlagen' }, { status: 400 });
      }
      return NextResponse.json({ success: true, message: `Gruppen-Eintrag "${wrong}" gelöscht` });
    }

    // Privat-Eintrag: Secretariat darf alle Benutzer bearbeiten
    const username = (auth.canViewAllDictations && targetUsername) ? targetUsername : auth.username;

    const result = await removeEntryWithRequest(request, username, wrong);

    if (result.success) {
      return NextResponse.json({ success: true, message: 'Eintrag gelöscht' });
    }

    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('Dictionary DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}
