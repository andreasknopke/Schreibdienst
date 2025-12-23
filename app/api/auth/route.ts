import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/users';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username?.trim()) {
      return NextResponse.json({ success: false, error: "Benutzername erforderlich" }, { status: 400 });
    }

    if (!password) {
      return NextResponse.json({ success: false, error: "Passwort erforderlich" }, { status: 400 });
    }

    const result = authenticateUser(username.trim(), password);
    
    if (result.success && result.user) {
      return NextResponse.json({ 
        success: true, 
        username: result.user.username,
        isAdmin: result.user.isAdmin
      });
    }

    return NextResponse.json({ success: false, error: result.error || "Falsches Passwort" }, { status: 401 });
  } catch {
    return NextResponse.json({ success: false, error: "Ungültige Anfrage" }, { status: 400 });
  }
}
