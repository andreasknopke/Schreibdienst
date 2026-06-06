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

const WS_URL = 'ws://127.0.0.1:58765';
const RESPONSE_TIMEOUT_MS = 1500;

let g_ws: WebSocket | null = null;
let g_wsReady: Promise<WebSocket> | null = null;

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

  if (g_wsReady) {
    return g_wsReady;
  }

  g_wsReady = new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      g_ws = ws;
      g_wsReady = null;
      resolve(ws);
    };

    ws.onerror = () => {
      g_ws = null;
      g_wsReady = null;
      reject(new Error('Schreibdienst-Injector nicht erreichbar (WebSocket)'));
    };

    ws.onclose = () => {
      g_ws = null;
      g_wsReady = null;
    };
  });

  return g_wsReady;
}

async function sendToHost(
  request: Required<Pick<InjectRequest, 'text' | 'mode' | 'restorePreviousWindow' | 'delayMs' | 'charDelayMs'>>,
  requestId: string,
): Promise<InjectResult> {
  const ws = await getWs();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ok: false, error: 'Schreibdienst-Injector antwortet nicht' });
    }, RESPONSE_TIMEOUT_MS);

    function handleMessage(event: MessageEvent) {
      try {
        const data = JSON.parse(event.data);
        // Only handle inject responses, not hotkey events
        if (data.type === 'hotkey-event') return;

        clearTimeout(timeout);
        ws.removeEventListener('message', handleMessage);
        resolve(data as InjectResult);
      } catch {
        // Not JSON — ignore
      }
    }

    ws.addEventListener('message', handleMessage);

    const payload = {
      type: 'inject-text',
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

  const requestId = createRequestId();

  try {
    const hostResult = await sendToHost({
      text,
      mode,
      restorePreviousWindow,
      delayMs,
      charDelayMs,
    }, requestId);

    if (hostResult.ok || !fallbackToClipboard) {
      return hostResult;
    }
  } catch (_error) {
    // WebSocket not available — fall through to clipboard fallback
  }

  return copyToClipboard(text);
}

export function isClipboardFallback(result: InjectResult): boolean {
  return result.ok && result.fallback === 'clipboard';
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
