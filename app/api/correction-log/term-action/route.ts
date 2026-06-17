import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { parseBasicAuth } from '@/lib/apiHelpers';
import { removeEntryWithRequest, increaseEntryPhoneticMinSimilarityWithRequest } from '@/lib/dictionaryDb';
import { increaseDictionaryGroupEntryPhoneticMinSimilarityWithRequest, removeDictionaryGroupEntryWithRequest } from '@/lib/groupDictionaryDb';
import { removeStandardDictEntry, increaseStandardDictPhoneticMinSimilarity } from '@/lib/standardDictionaryDb';

type TermActionScope = 'standard' | 'private' | 'group';
type TermActionType = 'remove' | 'weaken';

async function getAuthenticatedRoot(request: NextRequest): Promise<{ username: string } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  try {
    const parsed = parseBasicAuth(authHeader);
    if (!parsed) return null;
    const result = await authenticateUserWithRequest(request, parsed.username, parsed.password);

    if (result.success && result.user && result.user.username.toLowerCase() === 'root') {
      return { username: result.user.username };
    }
  } catch {
    // Invalid auth header.
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedRoot(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Nur root darf diese Aktion ausfuehren' }, { status: 403 });
    }

    const body = await request.json();
    const action = body.action as TermActionType | undefined;
    const scope = body.scope as TermActionScope | undefined;
    const wrong = typeof body.wrong === 'string' ? body.wrong.trim() : '';
    const targetUsername = typeof body.targetUsername === 'string' ? body.targetUsername.trim() : '';
    const groupId = Number(body.groupId);

    if (!action || !scope || !wrong) {
      return NextResponse.json({ success: false, error: 'action, scope und wrong sind erforderlich' }, { status: 400 });
    }

    if (scope === 'private' && !targetUsername) {
      return NextResponse.json({ success: false, error: 'targetUsername ist fuer private Eintraege erforderlich' }, { status: 400 });
    }

    if (scope === 'group' && (!Number.isInteger(groupId) || groupId <= 0)) {
      return NextResponse.json({ success: false, error: 'groupId ist fuer Gruppen-Eintraege erforderlich' }, { status: 400 });
    }

    if (action === 'remove') {
      if (scope === 'standard') {
        const result = await removeStandardDictEntry(request, wrong);
        if (!result.success) {
          return NextResponse.json({ success: false, error: result.error || 'Loeschen fehlgeschlagen' }, { status: 400 });
        }
        return NextResponse.json({ success: true, message: `Standard-Woerterbuch-Eintrag "${wrong}" geloescht` });
      }

      if (scope === 'group') {
        const result = await removeDictionaryGroupEntryWithRequest(request, groupId, wrong);
        if (!result.success) {
          return NextResponse.json({ success: false, error: result.error || 'Loeschen fehlgeschlagen' }, { status: 400 });
        }
        return NextResponse.json({ success: true, message: `Gruppen-Woerterbuch-Eintrag "${wrong}" geloescht` });
      }

      const result = await removeEntryWithRequest(request, targetUsername, wrong);
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error || 'Loeschen fehlgeschlagen' }, { status: 400 });
      }
      return NextResponse.json({ success: true, message: `Benutzer-Woerterbuch-Eintrag "${wrong}" fuer ${targetUsername} geloescht` });
    }

    if (action === 'weaken') {
      if (scope === 'standard') {
        const result = await increaseStandardDictPhoneticMinSimilarity(request, wrong);
        if (!result.success) {
          return NextResponse.json({ success: false, error: result.error || 'Abschwaechung fehlgeschlagen' }, { status: 400 });
        }
        return NextResponse.json({
          success: true,
          message: `Phonetisches Matching fuer "${wrong}" abgeschwaecht`,
          oldValue: result.oldValue,
          newValue: result.newValue,
        });
      }

      if (scope === 'group') {
        const result = await increaseDictionaryGroupEntryPhoneticMinSimilarityWithRequest(request, groupId, wrong);
        if (!result.success) {
          return NextResponse.json({ success: false, error: result.error || 'Abschwaechung fehlgeschlagen' }, { status: 400 });
        }
        return NextResponse.json({
          success: true,
          message: `Phonetisches Matching fuer "${wrong}" im Gruppen-Woerterbuch abgeschwaecht`,
          oldValue: result.oldValue,
          newValue: result.newValue,
        });
      }

      const result = await increaseEntryPhoneticMinSimilarityWithRequest(request, targetUsername, wrong);
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error || 'Abschwaechung fehlgeschlagen' }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        message: `Phonetisches Matching fuer "${wrong}" im Benutzer-Woerterbuch von ${targetUsername} abgeschwaecht`,
        oldValue: result.oldValue,
        newValue: result.newValue,
      });
    }

    return NextResponse.json({ success: false, error: 'Unbekannte Aktion' }, { status: 400 });
  } catch (error) {
    console.error('[CorrectionLog TermAction] Error:', error);
    return NextResponse.json({ success: false, error: 'Aktion fehlgeschlagen' }, { status: 500 });
  }
}