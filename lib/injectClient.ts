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

const MESSAGE_SOURCE = 'schreibdienst-pwa';
const RESPONSE_SOURCE = 'schreibdienst-extension';
const RESPONSE_TIMEOUT_MS = 1500;

function logInjectorEvent(event: string, details: Record<string, unknown>): void {
  if (typeof console === 'undefined') return;

  const serialized = JSON.stringify(details, (_key, value) => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
      };
    }
    return value;
  });

  console.log(`[Injector] ${event} ${serialized}`);
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function copyToClipboard(text: string): Promise<InjectResult> {
  logInjectorEvent('Clipboard fallback write', {
    text,
    textLength: text.length,
  });
  await navigator.clipboard.writeText(text);
  return { ok: true, fallback: 'clipboard' };
}

function sendToExtension(
  request: Required<Pick<InjectRequest, 'text' | 'mode' | 'restorePreviousWindow' | 'delayMs' | 'charDelayMs'>>,
  requestId: string,
): Promise<InjectResult> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ ok: false, error: 'Browserfenster nicht verfügbar' });
      return;
    }

    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleResponse);
      logInjectorEvent('Extension timeout', {
        requestId,
        text: request.text,
        textLength: request.text.length,
      });
      resolve({ ok: false, error: 'Schreibdienst-Injector nicht erreichbar' });
    }, RESPONSE_TIMEOUT_MS);

    function handleResponse(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== RESPONSE_SOURCE || data.requestId !== requestId) return;

      window.clearTimeout(timeout);
      window.removeEventListener('message', handleResponse);
      const result = data.result ?? { ok: false, error: 'Ungültige Injector-Antwort' };
      logInjectorEvent('Extension response', {
        requestId,
        text: request.text,
        textLength: request.text.length,
        result,
      });
      resolve(result);
    }

    window.addEventListener('message', handleResponse);
    logInjectorEvent('Extension request', {
      requestId,
      ...request,
      textLength: request.text.length,
    });
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
  fallbackToClipboard = true,
}: InjectRequest): Promise<InjectResult> {
  if (!text.trim()) {
    return { ok: false, error: 'Kein Text zum Einfügen vorhanden' };
  }

  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { ok: false, error: 'Nur im Browser verfügbar' };
  }

  const requestId = createRequestId();
  logInjectorEvent('Inject request', {
    requestId,
    text,
    textLength: text.length,
    mode,
    restorePreviousWindow,
    delayMs,
    charDelayMs,
    fallbackToClipboard,
  });

  const extensionResult = await sendToExtension({
    text,
    mode,
    restorePreviousWindow,
    delayMs,
    charDelayMs,
  }, requestId);

  logInjectorEvent('Inject result', {
    requestId,
    text,
    textLength: text.length,
    result: extensionResult,
  });

  if (extensionResult.ok || !fallbackToClipboard) {
    return extensionResult;
  }

  logInjectorEvent('Inject fallback to clipboard', {
    requestId,
    text,
    textLength: text.length,
  });

  return copyToClipboard(text);
}

export function isClipboardFallback(result: InjectResult): boolean {
  return result.ok && result.fallback === 'clipboard';
}
