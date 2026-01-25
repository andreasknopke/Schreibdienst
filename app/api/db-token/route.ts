import { NextRequest, NextResponse } from 'next/server';
import { encryptToken } from '@/lib/crypto';
import { authenticateUserWithRequest } from '@/lib/usersDb';

/**
 * API-Endpunkt für DB-Token-Generierung
 * 
 * POST: Generiert ein verschlüsseltes DB-Token aus Zugangsdaten
 * Nur für Root-User verfügbar
 */
export async function POST(request: NextRequest) {
  try {
    // Authentifizierung prüfen - nur Root-User dürfen Tokens generieren
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return NextResponse.json(
        { error: 'Authentifizierung erforderlich' },
        { status: 401 }
      );
    }

    // Basic Auth dekodieren
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
    const [username, password] = credentials.split(':');

    // User authentifizieren
    const authResult = await authenticateUserWithRequest(request, username, password);
    if (!authResult.success || !authResult.user) {
      return NextResponse.json(
        { error: 'Ungültige Anmeldedaten' },
        { status: 401 }
      );
    }

    // Nur Root-User dürfen Tokens generieren
    if (authResult.user.username !== 'root') {
      return NextResponse.json(
        { error: 'Nur Root-Benutzer dürfen DB-Tokens generieren' },
        { status: 403 }
      );
    }

    // Request Body parsen
    const body = await request.json();
    const { host, user, password: dbPassword, database, port, ssl } = body;

    // Validierung
    if (!host || !user || !dbPassword || !database) {
      return NextResponse.json(
        { error: 'Host, User, Password und Database sind erforderlich' },
        { status: 400 }
      );
    }

    // DB-Konfiguration als JSON
    const dbConfig = JSON.stringify({
      host: host.trim(),
      user: user.trim(),
      password: dbPassword,
      database: database.trim(),
      port: parseInt(port) || 3306,
      ssl: ssl !== false
    });

    // Token verschlüsseln
    const encryptedToken = encryptToken(dbConfig);

    return NextResponse.json({
      success: true,
      token: encryptedToken,
      info: {
        host: host.trim(),
        database: database.trim(),
        user: user.trim(),
        port: parseInt(port) || 3306,
        ssl: ssl !== false
      }
    });

  } catch (error) {
    console.error('[DB-Token] Generierung fehlgeschlagen:', error);
    return NextResponse.json(
      { error: 'Token-Generierung fehlgeschlagen' },
      { status: 500 }
    );
  }
}

/**
 * GET: Prüft ob JWT_SECRET konfiguriert ist
 */
export async function GET() {
  const hasSecret = !!process.env.JWT_SECRET;
  return NextResponse.json({
    encryptionEnabled: hasSecret,
    message: hasSecret 
      ? 'Verschlüsselung ist aktiv' 
      : 'JWT_SECRET nicht konfiguriert - Verschlüsselung nicht verfügbar'
  });
}
