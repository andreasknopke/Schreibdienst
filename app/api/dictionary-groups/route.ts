import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest, listUsersWithRequest } from '@/lib/usersDb';
import {
  createDictionaryGroupWithRequest,
  deleteDictionaryGroupWithRequest,
  getDictionaryGroupEntriesWithRequest,
  getDictionaryGroupMembersWithRequest,
  getGroupImportCandidatesWithRequest,
  importEntriesToGroupWithRequest,
  listDictionaryGroupsWithRequest,
  removeDictionaryGroupEntryWithRequest,
  setDictionaryGroupMembersWithRequest,
  upsertDictionaryGroupEntryWithRequest,
} from '@/lib/groupDictionaryDb';

async function getAdmin(request: NextRequest): Promise<{ valid: boolean; username?: string }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) return { valid: false };

  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    const result = await authenticateUserWithRequest(request, username, password);
    if (result.success && result.user?.isAdmin) {
      return { valid: true, username: result.user.username };
    }
  } catch {
    // Invalid auth header.
  }

  return { valid: false };
}

function parseGroupId(value: string | null): number | null {
  const groupId = Number(value);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : null;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAdmin(request);
    if (!auth.valid) return NextResponse.json({ success: false, error: 'Nur für Administratoren' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const groupId = parseGroupId(searchParams.get('groupId'));
    const include = searchParams.get('include') || 'summary';

    if (!groupId) {
      const [groups, users] = await Promise.all([
        listDictionaryGroupsWithRequest(request),
        listUsersWithRequest(request),
      ]);
      return NextResponse.json({ success: true, groups, users });
    }

    if (include === 'import-candidates') {
      const candidates = await getGroupImportCandidatesWithRequest(request, groupId);
      return NextResponse.json({ success: true, candidates });
    }

    const [entries, members] = await Promise.all([
      getDictionaryGroupEntriesWithRequest(request, groupId),
      getDictionaryGroupMembersWithRequest(request, groupId),
    ]);
    return NextResponse.json({ success: true, entries, members });
  } catch (error) {
    console.error('[DictionaryGroups GET] Error:', error);
    return NextResponse.json({ success: false, error: 'Fehler beim Laden der Gruppenwörterbücher' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAdmin(request);
    if (!auth.valid) return NextResponse.json({ success: false, error: 'Nur für Administratoren' }, { status: 403 });

    const body = await request.json();
    const action = body.action || 'create-group';

    if (action === 'create-group') {
      const result = await createDictionaryGroupWithRequest(request, body.name, body.description || '', auth.username!);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (action === 'add-entry') {
      const result = await upsertDictionaryGroupEntryWithRequest(
        request,
        Number(body.groupId),
        body.wrong,
        body.correct,
        Boolean(body.useInPrompt),
        Boolean(body.matchStem),
        auth.username!
      );
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (action === 'import-entries') {
      const result = await importEntriesToGroupWithRequest(
        request,
        Number(body.groupId),
        Array.isArray(body.entries) ? body.entries : [],
        Boolean(body.overwriteExisting),
        auth.username!
      );
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    return NextResponse.json({ success: false, error: 'Unbekannte Aktion' }, { status: 400 });
  } catch (error) {
    console.error('[DictionaryGroups POST] Error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAdmin(request);
    if (!auth.valid) return NextResponse.json({ success: false, error: 'Nur für Administratoren' }, { status: 403 });

    const body = await request.json();
    if (body.action === 'set-members') {
      const result = await setDictionaryGroupMembersWithRequest(
        request,
        Number(body.groupId),
        Array.isArray(body.usernames) ? body.usernames : []
      );
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    return NextResponse.json({ success: false, error: 'Unbekannte Aktion' }, { status: 400 });
  } catch (error) {
    console.error('[DictionaryGroups PATCH] Error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAdmin(request);
    if (!auth.valid) return NextResponse.json({ success: false, error: 'Nur für Administratoren' }, { status: 403 });

    const body = await request.json();
    const action = body.action || 'delete-group';

    if (action === 'delete-entry') {
      const result = await removeDictionaryGroupEntryWithRequest(request, Number(body.groupId), body.wrong);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    const result = await deleteDictionaryGroupWithRequest(request, Number(body.groupId));
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error('[DictionaryGroups DELETE] Error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}