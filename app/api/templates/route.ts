import { NextRequest, NextResponse } from 'next/server';
import { 
  getTemplatesWithRequest, 
  addTemplateWithRequest, 
  updateTemplateWithRequest, 
  deleteTemplateWithRequest,
  ensureTemplatesTable,
  loadTemplatesForUserWithRequest,
} from '@/lib/templatesDb';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { parseBasicAuth } from '@/lib/apiHelpers';
import { getPoolForRequest } from '@/lib/db';
import {
  upsertTemplateGroupEntryWithRequest,
  removeTemplateGroupEntryWithRequest,
  getUserTemplateGroupIds,
} from '@/lib/templateGroupDb';

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
    const parsed = parseBasicAuth(authHeader);
    if (!parsed) return null;
    const { username, password } = parsed;
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

// GET /api/templates - Get user's templates
export async function GET(request: NextRequest) {
  try {
    // Ensure table exists
    await ensureTemplatesTable(request);
    
    const auth = await getAuthenticatedUser(request);
    
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const targetUser = searchParams.get('user');
    const scope = searchParams.get('scope'); // 'private' | 'group' | undefined (merged)
    const username = (auth.canViewAllDictations && targetUser) ? targetUser : auth.username;

    // Nur private Templates anzeigen
    if (scope === 'private') {
      const templates = await getTemplatesWithRequest(request, username);
      return NextResponse.json({ success: true, templates });
    }

    // Gemergte Ansicht (private + Gruppe)
    const result = await loadTemplatesForUserWithRequest(request, username);
    return NextResponse.json({ success: true, templates: result.templates });
  } catch (error) {
    console.error('[Templates GET] Error:', error);
    return NextResponse.json({ success: false, error: 'Fehler beim Laden der Textbausteine', templates: [] }, { status: 500 });
  }
}

// POST /api/templates - Add new template
export async function POST(request: NextRequest) {
  try {
    // Ensure table exists
    await ensureTemplatesTable(request);
    
    const auth = await getAuthenticatedUser(request);
    
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const body = await request.json();
    const { name, content, field, formatRanges, username: targetUsername, addToGroup } = body;
    
    if (!name || !content) {
      return NextResponse.json({ success: false, error: 'Name und Inhalt müssen ausgefüllt sein' }, { status: 400 });
    }
    
    // Secretariat users can add to other users' templates
    const username = (auth.canViewAllDictations && targetUsername) ? targetUsername : auth.username;
    
    const result = await addTemplateWithRequest(request, username, name, content, field || 'befund', formatRanges || [], Boolean(addToGroup));
    
    if (result.success) {
      return NextResponse.json({ success: true, message: 'Textbaustein hinzugefügt', id: result.id });
    }
    
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('[Templates POST] Error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

// PUT /api/templates - Update template
export async function PUT(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const body = await request.json();
    const { id, name, content, field, formatRanges, username: targetUsername, scope, addToGroup } = body;
    
    if (!id || !name || !content) {
      return NextResponse.json({ success: false, error: 'ID, Name und Inhalt erforderlich' }, { status: 400 });
    }
    
    const username = (auth.canViewAllDictations && targetUsername) ? targetUsername : auth.username;

    // Gruppen-Template: Mitglieder dürfen bearbeiten
    if (scope === 'group') {
      const pool = await getPoolForRequest(request);
      const [entries] = await pool.query<any[]>(
        `SELECT e.group_id FROM template_group_entries e
         JOIN dictionary_group_members m ON m.group_id = e.group_id
         WHERE e.id = ? AND m.username = ?`,
        [id, username]
      );
      if (!entries || entries.length === 0) {
        return NextResponse.json({ success: false, error: 'Textbaustein nicht gefunden' }, { status: 404 });
      }
      const groupId = entries[0].group_id;
      await upsertTemplateGroupEntryWithRequest(
        request, groupId, name, content, field || 'befund', formatRanges || [], username
      );
      return NextResponse.json({ success: true, message: 'Textbaustein aktualisiert' });
    }
    
    const result = await updateTemplateWithRequest(request, username, id, name, content, field || 'befund', formatRanges || []);
    
    if (result.success) {
      // Optional: auch in alle Gruppen des Users übernehmen
      if (addToGroup) {
        const groupIds = await getUserTemplateGroupIds(request, username);
        for (const groupId of groupIds) {
          await upsertTemplateGroupEntryWithRequest(
            request, groupId, name, content, field || 'befund', formatRanges || [], username
          );
        }
      }
      return NextResponse.json({ success: true, message: 'Textbaustein aktualisiert' });
    }
    
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('[Templates PUT] Error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

// DELETE /api/templates - Delete template
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const body = await request.json();
    const { id, username: targetUsername, scope } = body;
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID erforderlich' }, { status: 400 });
    }
    
    const username = (auth.canViewAllDictations && targetUsername) ? targetUsername : auth.username;

    // Gruppen-Template: Mitglieder dürfen löschen
    if (scope === 'group') {
      const pool = await getPoolForRequest(request);
      const [entries] = await pool.query<any[]>(
        `SELECT e.group_id, e.name FROM template_group_entries e
         JOIN dictionary_group_members m ON m.group_id = e.group_id
         WHERE e.id = ? AND m.username = ?`,
        [id, username]
      );
      if (!entries || entries.length === 0) {
        return NextResponse.json({ success: false, error: 'Textbaustein nicht gefunden' }, { status: 404 });
      }
      await removeTemplateGroupEntryWithRequest(request, entries[0].group_id, entries[0].name);
      return NextResponse.json({ success: true, message: 'Textbaustein gelöscht' });
    }
    
    const result = await deleteTemplateWithRequest(request, username, id);
    
    if (result.success) {
      return NextResponse.json({ success: true, message: 'Textbaustein gelöscht' });
    }
    
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('[Templates DELETE] Error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}
