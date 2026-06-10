export type InjectMode = 'sendinput' | 'uia' | 'clipboard';

export interface InjectRequest {
  text: string;
  mode?: InjectMode;
  restorePreviousWindow?: boolean;
  delayMs?: number;
  charDelayMs?: number;
  fallbackToClipboard?: boolean;
}

export interface InjectResult {
  ok: boolean;
  fallback?: 'clipboard';
  error?: string;
}

export interface InjectorAvailabilityResult {
  ok: boolean;
  error?: string;
}

const WS_URL = 'ws://localhost:58765';
const RESPONSE_TIMEOUT_MS = 1500;

// Client-seitige Deduplizierung: Derselbe Text darf nicht mehrmals innerhalb
// kurzer Zeit gesendet werden. Der Retry bei Timeout (original request + 220ms
// Pause + erneuter Versuch) dauert länger als RESPONSE_TIMEOUT_MS, sodass der
// erste Request bereits auf dem Native Host verarbeitet wurde – die Antwort
// ging nur verloren. Der Retry-Missbrauch wird hiermit blockiert.
// Verwendung eines Ringpuffers (3 Einträge), der Text + Timestamp speichert,
// um auch abwechselnde Duplikate zuverlässig zu erkennen.
const CLIENT_DEDUP_WINDOW_MS = 3000;
const CLIENT_DEDUP_HISTORY = 3;
const g_sentHistory: { text: string; time: number }[] = [];

function isDuplicateText(text: string): boolean {
  const now = Date.now();
  for (const entry of g_sentHistory) {
    if (entry.text === text && (now - entry.time) < CLIENT_DEDUP_WINDOW_MS) {
      return true;
    }
  }
  return false;
}

function recordSentText(text: string): void {
  // Ältesten Eintrag ersetzen (Ringpuffer)
  if (g_sentHistory.length >= CLIENT_DEDUP_HISTORY) {
    g_sentHistory.shift();
  }
  g_sentHistory.push({ text, time: Date.now() });
}

let g_ws: WebSocket | null = null;
let g_wsReady: Promise<WebSocket> | null = null;
let g_wsUnavailable = false;

function isSecureContext(): boolean {
  try {
    return typeof window !== 'undefined' && window.location.protocol === 'https:';
  } catch {
    return false;
  }
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function copyToClipboard(text: string): Promise<InjectResult> {
  await navigator.clipboard.writeText(text);
  return { ok: true, fallback: 'clipboard' };
}

function getWs(): Promise<WebSocket> {
  if (g_ws && g_ws.readyState === WebSocket.OPEN) {
    return Promise.resolve(g_ws);
  }

  // If we have a stale connection, clean it up
  if (g_ws) {
    try { g_ws.close(); } catch (_) {}
    g_ws = null;
  }

  if (g_wsReady) {
    return g_wsReady;
  }

  g_wsReady = new Promise<WebSocket>((resolve, reject) => {
    console.info('[Injector] Verbinde mit WebSocket', { url: WS_URL });
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.info('[Injector] WebSocket verbunden');
      g_ws = ws;
      g_wsReady = null;
      resolve(ws);
    };

    ws.onerror = (ev) => {
      console.warn('[Injector] WebSocket Fehler', { url: WS_URL, readyState: ws.readyState });
      g_ws = null;
      g_wsReady = null;
      reject(new Error('Schreibdienst-Injector nicht erreichbar (WebSocket)'));
    };

    ws.onclose = (ev) => {
      console.info('[Injector] WebSocket geschlossen', { code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
      g_ws = null;
      g_wsReady = null;
    };
  });

  return g_wsReady;
}

async function sendToHost(
  request: Required<Pick<InjectRequest, 'text' | 'mode' | 'restorePreviousWindow' | 'delayMs' | 'charDelayMs'>> & { requestId?: string },
  requestId: string,
): Promise<InjectResult> {
  const ws = await getWs();

  console.log(`[Injector] sendToHost START id=${requestId} text="${request.text.substring(0, 60)}${request.text.length > 60 ? '…' : ''}" mode=${request.mode} restorePrev=${request.restorePreviousWindow}`);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn(`[Injector] sendToHost TIMEOUT id=${requestId}`);
      resolve({ ok: false, error: 'Schreibdienst-Injector antwortet nicht' });
    }, RESPONSE_TIMEOUT_MS);

    function handleMessage(event: MessageEvent) {
      try {
        const data = JSON.parse(event.data);
        if (data.type && data.type !== 'inject-result') return;
        if (data.requestId && data.requestId !== requestId) return;

        clearTimeout(timeout);
        ws.removeEventListener('message', handleMessage);

        // Erfolgreiche Antwort im History-Ringpuffer vermerken,
        // damit ein Retry mit demselben Text erkannt wird.
        if (data.ok) {
          recordSentText(request.text);
        }

        console.log(`[Injector] sendToHost RESPONSE id=${requestId} ok=${data.ok} method=${data.mode ?? data.method ?? data.fallback ?? ''}`);
        resolve(data as InjectResult);
      } catch {
        // Not JSON — ignore
      }
    }

    ws.addEventListener('message', handleMessage);

    const payload = {
      type: 'inject-text',
      requestId,
      payload: request,
    };

    ws.send(JSON.stringify(payload));
  });
}

export async function injectToActiveWindow({
  text,
  mode = 'sendinput',
  restorePreviousWindow = true,
  delayMs = 120,
  charDelayMs = 2,
  fallbackToClipboard = true,
}: InjectRequest): Promise<InjectResult> {
  if (!text.trim()) {
    return { ok: false, error: 'Kein Text zum Einfügen vorhanden' };
  }

  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { ok: false, error: 'Nur im Browser verfügbar' };
  }

  // Client-seitige Deduplizierung: Derselbe Text wurde bereits innerhalb
  // des Zeitfensters erfolgreich gesendet → sofort ok zurückgeben.
  // Der Ringpuffer mit 3 Einträgen fängt auch abwechselnde Duplikate.
  if (isDuplicateText(text)) {
    console.log(`[Injector] DEDUP SUPPRESSED: same text already sent recently`);
    return { ok: true, fallback: undefined };
  }

  const requestId = createRequestId();
  console.log(`[Injector] injectToActiveWindow CALL id=${requestId} text="${text.substring(0, 60)}${text.length > 60 ? '…' : ''}" mode=${mode} restorePrev=${restorePreviousWindow} fallback=${fallbackToClipboard}`);

  try {
    const hostResult = await sendToHost({
      text,
      mode,
      restorePreviousWindow,
      delayMs,
      charDelayMs,
    }, requestId);

    console.log(`[Injector] injectToActiveWindow RESULT id=${requestId} ok=${hostResult.ok} fallback=${hostResult.fallback ?? ''} error=${hostResult.error ?? ''}`);

    if (hostResult.ok || !fallbackToClipboard) {
      return hostResult;
    }
  } catch (_error) {
    // WebSocket not available — fall through to clipboard fallback
  }

  console.warn(`[Injector] injectToActiveWindow FALLBACK clipboard id=${requestId}`);
  return copyToClipboard(text);
}

export function isClipboardFallback(result: InjectResult): boolean {
  return result.ok && result.fallback === 'clipboard';
}

export async function checkInjectorAvailability(): Promise<InjectorAvailabilityResult> {
  if (typeof window === 'undefined') {
    return { ok: false, error: 'Nur im Browser verfügbar' };
  }

  try {
    await getWs();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Schreibdienst-Injector nicht erreichbar';
    return { ok: false, error: message };
  }
}

// ─── Hotkey registration via WebSocket ─────────────────────────

type HotkeyCallback = (action: string, key: string) => void;

let g_hotkeyInitPromise: Promise<void> | null = null;
let g_hotkeyCallback: HotkeyCallback | null = null;

export async function registerGlobalHotkeys(callback: HotkeyCallback): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  g_hotkeyCallback = callback;

  if (g_hotkeyInitPromise) return g_hotkeyInitPromise.then(() => true);

  g_hotkeyInitPromise = (async () => {
    const ws = await getWs();

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'hotkey-event' && data.event) {
          g_hotkeyCallback?.(data.event.action, data.event.key);
        }
      } catch {
        // Not JSON — ignore
      }
    });

    // Request hotkey listener start
    ws.send(JSON.stringify({ type: 'listen-hotkeys' }));
  })();

  await g_hotkeyInitPromise;
  return true;
}

export async function reportInjectorRecordingState(active: boolean, frontendVisible: boolean): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const ws = await getWs();
    ws.send(JSON.stringify({ type: 'recording-status', active, frontendVisible }));
  } catch {
    // Injector not available — ignore silently.
  }
}
