import { NextRequest, NextResponse } from 'next/server';

const CORRECT_PASSWORD = process.env.AUTH_PASSWORD || "";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username?.trim()) {
      return NextResponse.json({ success: false, error: "Benutzername erforderlich" }, { status: 400 });
    }

    if (!password) {
      return NextResponse.json({ success: false, error: "Passwort erforderlich" }, { status: 400 });
    }

    if (password === CORRECT_PASSWORD) {
      return NextResponse.json({ success: true, username: username.trim() });
    }

    return NextResponse.json({ success: false, error: "Falsches Passwort" }, { status: 401 });
  } catch {
    return NextResponse.json({ success: false, error: "Ungültige Anfrage" }, { status: 400 });
  }
}
