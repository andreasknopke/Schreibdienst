import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { parseBasicAuth } from '@/lib/apiHelpers';
import { getUserTemplateGroupsWithNames } from '@/lib/templateGroupDb';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return NextResponse.json({ success: false, error: 'Nicht authentifiziert' }, { status: 401 });
    }

    const parsed = parseBasicAuth(authHeader);
    if (!parsed) {
      return NextResponse.json({ success: false, error: 'Ungültige Authentifizierung' }, { status: 401 });
    }

    const result = await authenticateUserWithRequest(request, parsed.username, parsed.password);
    if (!result.success || !result.user) {
      return NextResponse.json({ success: false, error: 'Authentifizierung fehlgeschlagen' }, { status: 401 });
    }

    const groups = await getUserTemplateGroupsWithNames(request, result.user.username);
    return NextResponse.json({ success: true, groups });
  } catch (error) {
    console.error('[MyGroups GET] Error:', error);
    return NextResponse.json({ success: false, error: 'Fehler beim Laden der Gruppen' }, { status: 500 });
  }
}
