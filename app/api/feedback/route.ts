import http from 'http';
import https from 'https';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest } from '@/lib/usersDb';

export const runtime = 'nodejs';

type TicketType = 'bug' | 'feature';

interface TicketRequestBody {
  type?: string;
  title?: string;
  subject?: string;
  description?: string;
  contactEmail?: string;
  reporterEmail?: string;
  reporterName?: string;
  reporterId?: string | number;
  userName?: string;
  softwareInfo?: unknown;
  consoleLogs?: string;
}

interface TicketResponseBody {
  message?: string;
  id?: string | number;
}

interface AuthResult {
  username: string;
}

async function getAuthenticatedUser(request: NextRequest): Promise<AuthResult | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    const result = await authenticateUserWithRequest(request, username, password);

    if (result.success && result.user) {
      return { username: result.user.username };
    }
  } catch {
    return null;
  }

  return null;
}

function getConfiguredEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function normalizeTicketType(value?: string): TicketType | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'bug') {
    return 'bug';
  }

  if (normalized === 'feature') {
    return 'feature';
  }

  return null;
}

function parseSoftwareInfo(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return { raw: value };
    }
  }

  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }

  return {};
}

function buildTicketEndpoint(baseUrl: string): URL {
  const url = new URL(baseUrl);
  const trimmedPath = url.pathname.replace(/\/$/, '');

  if (trimmedPath.endsWith('/api/tickets')) {
    url.pathname = trimmedPath;
    return url;
  }

  if (trimmedPath.endsWith('/api')) {
    url.pathname = `${trimmedPath}/tickets`;
    return url;
  }

  url.pathname = trimmedPath ? `${trimmedPath}/api/tickets` : '/api/tickets';
  return url;
}

function postJson(url: URL, apiKey: string | undefined, body: Record<string, unknown>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);

    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
      },
      (response) => {
        let responseBody = '';

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          resolve({ status: response.statusCode || 500, body: responseBody });
        });
      }
    );

    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser(request);
  if (!auth) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  }

  try {
    const {
      type,
      title,
      subject,
      description,
      contactEmail,
      reporterEmail,
      reporterName,
      reporterId,
      userName,
      softwareInfo,
      consoleLogs,
    } = (await request.json()) as TicketRequestBody;

    const normalizedType = normalizeTicketType(type);
    const normalizedTitle = (title || subject || '').trim();
    const normalizedDescription = (description || '').trim();

    if (!normalizedType || !normalizedTitle || !normalizedDescription) {
      return NextResponse.json({ error: 'Typ, Titel und Beschreibung sind erforderlich.' }, { status: 400 });
    }

    const ticketSystemUrl = getConfiguredEnv(
      'TICKET_SYSTEM_URL',
      'NEXT_PUBLIC_TICKET_SYSTEM_URL',
      'VITE_TICKET_SYSTEM_URL',
      'VITE_TICKE_SYSTEM_URL'
    );
    const ticketApiKey = getConfiguredEnv(
      'TICKET_API_KEY',
      'NEXT_PUBLIC_TICKET_API_KEY',
      'VITE_TICKET_API_KEY',
      'VITE_API_KEY'
    );
    const ticketSystemId = Number(
      getConfiguredEnv('TICKET_SYSTEM_ID', 'NEXT_PUBLIC_TICKET_SYSTEM_ID', 'VITE_TICKET_SYSTEM_ID') || '1'
    );

    if (!ticketSystemUrl) {
      return NextResponse.json(
        { error: 'Ticketsystem ist nicht konfiguriert. Bitte TICKET_SYSTEM_URL setzen.' },
        { status: 503 }
      );
    }

    const resolvedSoftwareInfo = parseSoftwareInfo(softwareInfo);
    const resolvedUserName = userName || auth.username || 'Unbekannt';
    const resolvedReporterEmail = reporterEmail || contactEmail || '';
    const resolvedDescription = `${normalizedDescription}\n\n--- Automatisch übermittelte Informationen ---\n${JSON.stringify(
      resolvedSoftwareInfo,
      null,
      2
    )}`;

    const payload = {
      type: normalizedType,
      title: normalizedTitle,
      subject: normalizedTitle,
      description: resolvedDescription,
      username: resolvedUserName,
      reporter_name: reporterName || auth.username,
      reporter_id: reporterId || null,
      reporter_email: resolvedReporterEmail || null,
      system_id: Number.isFinite(ticketSystemId) ? ticketSystemId : 1,
      software_info: JSON.stringify(resolvedSoftwareInfo),
      console_logs: consoleLogs || '',
      location: typeof resolvedSoftwareInfo.url === 'string' ? resolvedSoftwareInfo.url : '',
      contact_email: contactEmail || resolvedReporterEmail || null,
      urgency: 'normal',
    };

    const response = await postJson(buildTicketEndpoint(ticketSystemUrl), ticketApiKey, payload);

    if (response.status < 200 || response.status >= 300) {
      console.error('[API/Feedback] Ticketsystem-Fehler:', response.status, response.body);
      return NextResponse.json(
        {
          error: `Ticketsystem antwortete mit Status ${response.status}.`,
          details: response.body || 'Keine Fehlerdetails vom Ticketsystem verfügbar.',
        },
        { status: 502 }
      );
    }

    let parsedResponse: TicketResponseBody | null = null;
    if (response.body) {
      try {
        parsedResponse = JSON.parse(response.body) as TicketResponseBody;
      } catch {
        parsedResponse = null;
      }
    }

    return NextResponse.json({
      message: parsedResponse?.message || 'Ticket erfolgreich an das Ticketsystem übermittelt.',
      id: parsedResponse?.id,
    });
  } catch (error: any) {
    console.error('[API/Feedback] Fehler:', error);
    return NextResponse.json({ error: 'Interner Fehler beim Senden des Tickets.' }, { status: 500 });
  }
}