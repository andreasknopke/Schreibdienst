import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest, listUsersWithRequest } from '@/lib/usersDb';
import { parseBasicAuth } from '@/lib/apiHelpers';
import {
  createTemplateGroupWithRequest,
  deleteTemplateGroupWithRequest,
  getTemplateGroupEntriesWithRequest,
  getTemplateGroupMembersWithRequest,
  getTemplateImportCandidatesWithRequest,
  importTemplatesToGroupWithRequest,
  listTemplateGroupsWithRequest,
  removeTemplateGroupEntryWithRequest,
  setTemplateGroupMembersWithRequest,
  upsertTemplateGroupEntryWithRequest,
} from '@/lib/templateGroupDb';

async function getAdmin(request: NextRequest): Promise<{ valid: boolean; username?: string }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) return { valid: false };

  try {
    const parsed = parseBasicAuth(authHeader);
    if (!parsed) return { valid: false };
    const result = await authenticateUserWithRequest(request, parsed.username, parsed.password);
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
        listTemplateGroupsWithRequest(request),
        listUsersWithRequest(request),
      ]);
      return NextResponse.json({ success: true, groups, users });
    }

    if (include === 'import-candidates') {
      const candidates = await getTemplateImportCandidatesWithRequest(request, groupId);
      return NextResponse.json({ success: true, candidates });
    }

    const [entries, members] = await Promise.all([
      getTemplateGroupEntriesWithRequest(request, groupId),
      getTemplateGroupMembersWithRequest(request, groupId),
    ]);
    return NextResponse.json({ success: true, entries, members });
  } catch (error) {
    console.error('[TemplateGroups GET] Error:', error);
    return NextResponse.json({ success: false, error: 'Fehler beim Laden der Gruppenbausteine' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAdmin(request);
    if (!auth.valid) return NextResponse.json({ success: false, error: 'Nur für Administratoren' }, { status: 403 });

    const body = await request.json();
    const action = body.action || 'create-group';

    if (action === 'create-group') {
      const result = await createTemplateGroupWithRequest(request, body.name, body.description || '', auth.username!);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (action === 'add-entry') {
      const result = await upsertTemplateGroupEntryWithRequest(
        request,
        Number(body.groupId),
        body.name,
        body.content,
        body.field || 'befund',
        body.formatRanges || [],
        auth.username!
      );
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (action === 'import-entries') {
      const result = await importTemplatesToGroupWithRequest(
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
    console.error('[TemplateGroups POST] Error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAdmin(request);
    if (!auth.valid) return NextResponse.json({ success: false, error: 'Nur für Administratoren' }, { status: 403 });

    const body = await request.json();
    if (body.action === 'set-members') {
      const result = await setTemplateGroupMembersWithRequest(
        request,
        Number(body.groupId),
        Array.isArray(body.usernames) ? body.usernames : []
      );
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    return NextResponse.json({ success: false, error: 'Unbekannte Aktion' }, { status: 400 });
  } catch (error) {
    console.error('[TemplateGroups PATCH] Error:', error);
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
      const result = await removeTemplateGroupEntryWithRequest(request, Number(body.groupId), body.name);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    const result = await deleteTemplateGroupWithRequest(request, Number(body.groupId));
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error('[TemplateGroups DELETE] Error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}
