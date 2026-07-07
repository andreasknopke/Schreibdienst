import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { parseBasicAuth } from '@/lib/apiHelpers';
import {
  getPromptTemplateList,
  getPromptOverridesFromDb,
  savePromptOverride,
} from '@/lib/promptOverrides';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

async function authenticateAdmin(
  request: NextRequest
): Promise<{ success: boolean; username?: string }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Basic ')) return { success: false };
  const parsed = parseBasicAuth(authHeader);
  if (!parsed) return { success: false };
  const result = await authenticateUserWithRequest(request, parsed.username, parsed.password);
  if (result.success && result.user) {
    return { success: true, username: result.user.username };
  }
  return { success: false };
}

/**
 * Liest den Default-Content aus einer Prompt-Datei.
 * Extrahiert den Text zwischen `= ` und dem schließenden Backtick.
 */
function readDefaultContent(relativePath: string): string {
  try {
    const fullPath = path.join(process.cwd(), relativePath);
    const raw = fs.readFileSync(fullPath, 'utf-8');
    // Match the first template literal after `= `
    const match = raw.match(/=\s*`([\s\S]*?)`\s*(?:;|$)/);
    return match ? match[1].trim() : '(Konnte nicht gelesen werden)';
  } catch {
    return '(Datei nicht gefunden)';
  }
}

/**
 * GET /api/prompts — Listet alle Prompt-Vorlagen mit Default-Content und Overrides (Admin)
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateAdmin(request);
  if (!auth.success) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  }
  // Nur root darf Prompts sehen/bearbeiten
  if (auth.username?.toLowerCase() !== 'root') {
    return NextResponse.json({ error: 'Nur root darf Prompts verwalten' }, { status: 403 });
  }

  const templates = getPromptTemplateList();
  const overrides = await getPromptOverridesFromDb(request);

  const result = templates.map((t) => ({
    ...t,
    defaultContent: readDefaultContent(t.file),
    overrideContent: overrides[t.id] || '',
  }));

  return NextResponse.json({ templates: result });
}

/**
 * POST /api/prompts — Speichert einen Prompt-Override (Admin)
 * Body: { id: string, content: string }
 * Wenn content leer ist, wird der Override gelöscht (Reset auf Default).
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateAdmin(request);
  if (!auth.success) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  }
  if (auth.username?.toLowerCase() !== 'root') {
    return NextResponse.json({ error: 'Nur root darf Prompts verwalten' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, content } = body as { id?: string; content?: string };

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ success: false, error: 'Keine ID angegeben' }, { status: 400 });
    }

    // Validate that it's a known prompt ID
    const validIds = getPromptTemplateList().map((t) => t.id);
    if (!validIds.includes(id)) {
      return NextResponse.json({ success: false, error: 'Unbekannte Prompt-ID' }, { status: 400 });
    }

    await savePromptOverride(request, id, content || '');

    return NextResponse.json({
      success: true,
      id,
      saved: !!content?.trim(),
    });
  } catch (error) {
    console.error('[Prompts] Save error:', error);
    return NextResponse.json({ success: false, error: 'Fehler beim Speichern' }, { status: 500 });
  }
}
