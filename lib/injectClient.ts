export type InjectMode = 'sendinput' | 'uia' | 'clipboard';
export type InjectPostKey = 'F4';

export interface InjectRequest {
  text: string;
  mode?: InjectMode;
  restorePreviousWindow?: boolean;
  delayMs?: number;
  charDelayMs?: number;
  postKey?: InjectPostKey;
  fallbackToClipboard?: boolean;
}

export interface InjectResult {
  ok: boolean;
  fallback?: 'clipboard';
  error?: string;
}

const MESSAGE_SOURCE = 'schreibdienst-pwa';
const RESPONSE_SOURCE = 'schreibdienst-extension';
const RESPONSE_TIMEOUT_MS = 1500;

function logInjectorEvent(message: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`[Injector] ${message}`, details);
    return;
  }

  console.info(`[Injector] ${message}`);
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function copyToClipboard(text: string): Promise<InjectResult> {
  logInjectorEvent('Clipboard-Fallback wird verwendet', { textLength: text.length });
  await navigator.clipboard.writeText(text);
  return { ok: true, fallback: 'clipboard' };
}

function sendToExtension(
  request: Required<Pick<InjectRequest, 'text' | 'mode' | 'restorePreviousWindow' | 'delayMs' | 'charDelayMs'>> & Pick<InjectRequest, 'postKey'>,
  requestId: string,
): Promise<InjectResult> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ ok: false, error: 'Browserfenster nicht verfügbar' });
      return;
    }

    logInjectorEvent('Sende Anfrage an Extension', {
      requestId,
      mode: request.mode,
      restorePreviousWindow: request.restorePreviousWindow,
      delayMs: request.delayMs,
      charDelayMs: request.charDelayMs,
      postKey: request.postKey ?? null,
      textLength: request.text.length,
    });

    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleResponse);
      logInjectorEvent('Extension-Timeout', { requestId, timeoutMs: RESPONSE_TIMEOUT_MS });
      resolve({ ok: false, error: 'Schreibdienst-Injector nicht erreichbar' });
    }, RESPONSE_TIMEOUT_MS);

    function handleResponse(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== RESPONSE_SOURCE || data.requestId !== requestId) return;

      window.clearTimeout(timeout);
      window.removeEventListener('message', handleResponse);
      const result = data.result ?? { ok: false, error: 'Ungültige Injector-Antwort' };
      logInjectorEvent('Antwort von Extension erhalten', {
        requestId,
        ok: result.ok,
        fallback: result.fallback ?? null,
        error: result.error ?? null,
      });
      resolve(result);
    }

    window.addEventListener('message', handleResponse);
    window.postMessage({
      source: MESSAGE_SOURCE,
      type: 'inject-text',
      requestId,
      payload: request,
    }, window.location.origin);
  });
}

export async function injectToActiveWindow({
  text,
  mode = 'sendinput',
  restorePreviousWindow = true,
  delayMs = 120,
  charDelayMs = 2,
  postKey,
  fallbackToClipboard = true,
}: InjectRequest): Promise<InjectResult> {
  if (!text.trim()) {
    return { ok: false, error: 'Kein Text zum Einfügen vorhanden' };
  }

  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { ok: false, error: 'Nur im Browser verfügbar' };
  }

  const requestId = createRequestId();

  logInjectorEvent('Starte Inject-Vorgang', {
    requestId,
    mode,
    restorePreviousWindow,
    delayMs,
    charDelayMs,
    postKey: postKey ?? null,
    fallbackToClipboard,
    textLength: text.length,
  });

  const extensionResult = await sendToExtension({
    text,
    mode,
    restorePreviousWindow,
    delayMs,
    charDelayMs,
    postKey,
  }, requestId);

  if (extensionResult.ok || !fallbackToClipboard) {
    logInjectorEvent('Inject-Vorgang abgeschlossen', {
      requestId,
      ok: extensionResult.ok,
      fallback: extensionResult.fallback ?? null,
      error: extensionResult.error ?? null,
      via: 'extension',
    });
    return extensionResult;
  }

  logInjectorEvent('Falle auf Clipboard zurück', {
    requestId,
    extensionError: extensionResult.error ?? null,
  });
  return copyToClipboard(text);
}

export function isClipboardFallback(result: InjectResult): boolean {
  return result.ok && result.fallback === 'clipboard';
}
