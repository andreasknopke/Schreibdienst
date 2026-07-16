import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { parseBasicAuth } from '@/lib/apiHelpers';
import {
  getFolderTree,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  type TemplateFolder,
} from '@/lib/templateFoldersDb';
import { getUserGroupIds } from '@/lib/groupDictionaryDb';

async function getAuth(request: NextRequest): Promise<{ username: string; error?: NextResponse }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return { username: '', error: NextResponse.json({ success: false, error: 'Nicht authentifiziert' }, { status: 401 }) };
  }
  const parsed = parseBasicAuth(authHeader);
  if (!parsed) return { username: '', error: NextResponse.json({ success: false, error: 'Ungültige Authentifizierung' }, { status: 401 }) };
  const result = await authenticateUserWithRequest(request, parsed.username, parsed.password);
  if (!result.success || !result.user) {
    return { username: '', error: NextResponse.json({ success: false, error: 'Authentifizierung fehlgeschlagen' }, { status: 401 }) };
  }
  return { username: result.user.username };
}

// GET /api/templates/folders - Ordner-Struktur abrufen
export async function GET(request: NextRequest) {
  const { username, error } = await getAuth(request);
  if (error) return error;

  try {
    const groupIds = await getUserGroupIds(request, username);
    const tree = await getFolderTree(request, username, groupIds);
    return NextResponse.json({ success: true, tree });
  } catch (err: any) {
    console.error('[Folders GET] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// POST /api/templates/folders - Ordner erstellen
export async function POST(request: NextRequest) {
  const { username, error } = await getAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { name, parentId, groupId } = body;
    const result = await createFolder(request, username, { name, parentId: parentId ?? null, groupId: groupId ?? null });
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true, folder: result.folder });
  } catch (err: any) {
    console.error('[Folders POST] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// PUT /api/templates/folders - Ordner umbenennen/verschieben
export async function PUT(request: NextRequest) {
  const { username, error } = await getAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { id, name, parentId } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'id erforderlich' }, { status: 400 });
    }

    if (name) {
      const result = await renameFolder(request, id, name);
      if (!result.success) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    if (parentId !== undefined) {
      const result = await moveFolder(request, id, parentId ?? null);
      if (!result.success) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Folders PUT] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// DELETE /api/templates/folders - Ordner löschen
export async function DELETE(request: NextRequest) {
  const { username, error } = await getAuth(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ success: false, error: 'id erforderlich' }, { status: 400 });

    const result = await deleteFolder(request, id);
    if (!result.success) return NextResponse.json({ success: false, error: result.error }, { status: 400 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Folders DELETE] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
