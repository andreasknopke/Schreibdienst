import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { parseBasicAuth } from '@/lib/apiHelpers';
import { getPoolForRequest } from '@/lib/db';
import {
  ensureComplexTemplatesTable,
  getComplexTemplates,
  addComplexTemplate,
  updateComplexTemplate,
  deleteComplexTemplate,
  moveComplexTemplateToFolder,
} from '@/lib/complexTemplatesDb';

interface AuthResult {
  username: string;
  canViewAllDictations: boolean;
}

async function getAuthenticatedUser(request: NextRequest): Promise<AuthResult | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) return null;
  try {
    const parsed = parseBasicAuth(authHeader);
    if (!parsed) return null;
    const { username, password } = parsed;
    const result = await authenticateUserWithRequest(request, username, password);
    if (result.success && result.user) {
      return { username: result.user.username, canViewAllDictations: result.user.canViewAllDictations || false };
    }
  } catch {
    // ignore
  }
  return null;
}

// GET /api/templates/complex - List complex templates (with resolved template names)
export async function GET(request: NextRequest) {
  try {
    await ensureComplexTemplatesTable(request);
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const complexTemplates = await getComplexTemplates(request, auth.username);

    // Template-Namen auflösen
    const pool = await getPoolForRequest(request);
    const result = await Promise.all(complexTemplates.map(async (ct) => {
      let templateNames: { id: number; name: string }[] = [];
      if (ct.templateIds.length > 0) {
        const placeholders = ct.templateIds.map(() => '?').join(',');
        const [rows] = await pool.query<any[]>(
          `SELECT id, name FROM templates WHERE id IN (${placeholders})`,
          ct.templateIds
        );
        templateNames = (rows || []).map((r: any) => ({ id: r.id, name: r.name }));
      }
      return { ...ct, templateNames };
    }));

    return NextResponse.json({ success: true, complexTemplates: result });
  } catch (error) {
    console.error('[ComplexTemplates GET] Error:', error);
    return NextResponse.json({ success: false, error: 'Fehler beim Laden', complexTemplates: [] }, { status: 500 });
  }
}

// POST /api/templates/complex - Create complex template
export async function POST(request: NextRequest) {
  try {
    await ensureComplexTemplatesTable(request);
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const body = await request.json();
    const { name, field, templateIds } = body;

    if (!name || !Array.isArray(templateIds) || templateIds.length === 0) {
      return NextResponse.json({ error: 'Name und mindestens ein Baustein erforderlich' }, { status: 400 });
    }

    const result = await addComplexTemplate(request, auth.username, name, field || 'befund', templateIds);
    if (result.success) {
      return NextResponse.json({ success: true, id: result.id });
    }
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('[ComplexTemplates POST] Error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

// PUT /api/templates/complex - Update complex template
export async function PUT(request: NextRequest) {
  try {
    await ensureComplexTemplatesTable(request);
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const body = await request.json();
    const { id, name, field, templateIds } = body;

    if (!id || !name || !Array.isArray(templateIds)) {
      return NextResponse.json({ error: 'ID, Name und templateIds erforderlich' }, { status: 400 });
    }

    const result = await updateComplexTemplate(request, auth.username, id, name, field || 'befund', templateIds);
    if (result.success) {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('[ComplexTemplates PUT] Error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

// PATCH /api/templates/complex - Complex-Template in Ordner verschieben
export async function PATCH(request: NextRequest) {
  try {
    await ensureComplexTemplatesTable(request);
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const body = await request.json();
    const { id, folderId } = body;
    if (!id) {
      return NextResponse.json({ error: 'ID erforderlich' }, { status: 400 });
    }

    const result = await moveComplexTemplateToFolder(request, id, folderId ?? null);
    if (result.success) {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('[ComplexTemplates PATCH] Error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}

// DELETE /api/templates/complex - Delete complex template
export async function DELETE(request: NextRequest) {
  try {
    await ensureComplexTemplatesTable(request);
    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const body = await request.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ error: 'ID erforderlich' }, { status: 400 });
    }

    const result = await deleteComplexTemplate(request, auth.username, id);
    if (result.success) {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  } catch (error) {
    console.error('[ComplexTemplates DELETE] Error:', error);
    return NextResponse.json({ success: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
}
