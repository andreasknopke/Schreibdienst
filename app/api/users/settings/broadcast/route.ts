import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { parseBasicAuth } from '@/lib/apiHelpers';
import { getPoolForRequest } from '@/lib/db';

// POST /api/users/settings/broadcast – Root überträgt Formatierungseinstellungen an alle User
export async function POST(request: NextRequest) {
  try {
    // Authentifiziere als root
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const parsed = parseBasicAuth(authHeader);
    if (!parsed || parsed.username.toLowerCase() !== 'root') {
      return NextResponse.json({ error: 'Nur root darf Einstellungen broadcasten' }, { status: 403 });
    }

    const authResult = await authenticateUserWithRequest(request, parsed.username, parsed.password);
    if (!authResult.success) {
      return NextResponse.json({ error: 'Authentifizierung fehlgeschlagen' }, { status: 401 });
    }

    const body = await request.json();
    const { disabledFormattings, disabledAbbreviations } = body as {
      disabledFormattings?: unknown;
      disabledAbbreviations?: unknown;
    };

    const hasFormattings = disabledFormattings !== undefined;
    const hasAbbreviations = disabledAbbreviations !== undefined;

    if (!hasFormattings && !hasAbbreviations) {
      return NextResponse.json({ success: false, error: 'Keine Einstellungen angegeben' }, { status: 400 });
    }

    const normalizedFormattings =
      Array.isArray(disabledFormattings) && disabledFormattings.every((v) => typeof v === 'string')
        ? JSON.stringify(disabledFormattings)
        : null;
    const normalizedAbbreviations =
      Array.isArray(disabledAbbreviations) && disabledAbbreviations.every((v) => typeof v === 'string')
        ? JSON.stringify(disabledAbbreviations)
        : null;

    const db = await getPoolForRequest(request);
    const updates: string[] = [];
    const params: string[] = [];

    if (normalizedFormattings !== null) {
      updates.push('disabled_formattings = ?');
      params.push(normalizedFormattings);
    }
    if (normalizedAbbreviations !== null) {
      updates.push('disabled_abbreviations = ?');
      params.push(normalizedAbbreviations);
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'Keine gültigen Einstellungen' }, { status: 400 });
    }

    // Update ALL non-root users
    try {
      const [result] = await db.execute(
        `UPDATE users SET ${updates.join(', ')} WHERE LOWER(username) != 'root'`,
        params
      );
      const count = (result as any).affectedRows || 0;
      console.log(`[Broadcast] Updated settings for ${count} users`);
      return NextResponse.json({ success: true, updatedUsers: count });
    } catch (updateError: any) {
      if (updateError?.code === 'ER_BAD_FIELD_ERROR') {
        // Column might not exist yet – try with safe columns only
        const safeUpdates = updates.filter(u =>
          !u.startsWith('disabled_formattings') && !u.startsWith('disabled_abbreviations')
        );
        if (safeUpdates.length === 0) {
          return NextResponse.json({ success: true, updatedUsers: 0, note: 'Spalten noch nicht migriert' });
        }
        const safeParams = params.filter((_, i) => safeUpdates.includes(updates[i]));
        const [safeResult] = await db.execute(
          `UPDATE users SET ${safeUpdates.join(', ')} WHERE LOWER(username) != 'root'`,
          safeParams
        );
        return NextResponse.json({ success: true, updatedUsers: (safeResult as any).affectedRows || 0 });
      }
      throw updateError;
    }
  } catch (error) {
    console.error('[Broadcast] Error:', error);
    return NextResponse.json({ success: false, error: 'Fehler beim Broadcast' }, { status: 500 });
  }
}
