export type InjectMode = 'sendinput' | 'uia' | 'clipboard';

export interface InjectRequest {
  text: string;
  mode?: InjectMode;
  restorePreviousWindow?: boolean;
  delayMs?: number;
}

export interface InjectResult {
  ok: boolean;
  fallback?: 'clipboard';
  error?: string;
}

const MESSAGE_SOURCE = 'schreibdienst-pwa';
const RESPONSE_SOURCE = 'schreibdienst-extension';
const RESPONSE_TIMEOUT_MS = 1500;

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

function sendToExtension(request: Required<Pick<InjectRequest, 'text' | 'mode' | 'restorePreviousWindow' | 'delayMs'>>): Promise<InjectResult> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ ok: false, error: 'Browserfenster nicht verfügbar' });
      return;
    }

    const requestId = createRequestId();
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleResponse);
      resolve({ ok: false, error: 'Schreibdienst-Injector nicht erreichbar' });
    }, RESPONSE_TIMEOUT_MS);

    function handleResponse(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== RESPONSE_SOURCE || data.requestId !== requestId) return;

      window.clearTimeout(timeout);
      window.removeEventListener('message', handleResponse);
      resolve(data.result ?? { ok: false, error: 'Ungültige Injector-Antwort' });
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
}: InjectRequest): Promise<InjectResult> {
  const trimmedText = text.trim();
  if (!trimmedText) {
    return { ok: false, error: 'Kein Text zum Einfügen vorhanden' };
  }

  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { ok: false, error: 'Nur im Browser verfügbar' };
  }

  const extensionResult = await sendToExtension({
    text: trimmedText,
    mode,
    restorePreviousWindow,
    delayMs,
  });

  if (extensionResult.ok) {
    return extensionResult;
  }

  return copyToClipboard(trimmedText);
}

export function isClipboardFallback(result: InjectResult): boolean {
  return result.ok && result.fallback === 'clipboard';
}
