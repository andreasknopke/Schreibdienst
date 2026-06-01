const PAGE_SOURCE = 'schreibdienst-pwa';
const EXTENSION_SOURCE = 'schreibdienst-extension';

function logExtensionEvent(message, details) {
  if (details) {
    console.info(`[Schreibdienst Extension] ${message}`, details);
    return;
  }

  console.info(`[Schreibdienst Extension] ${message}`);
}

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;

  const data = event.data;
  if (!data || data.source !== PAGE_SOURCE) return;

  if (data.type === 'register-global-hotkeys' || data.type === 'unregister-global-hotkeys') {
    try {
      logExtensionEvent('Leite Hotkey-Registrierung an Service Worker weiter', { type: data.type });
      const result = await chrome.runtime.sendMessage({
        type: data.type,
      });

      logExtensionEvent('Antwort zur Hotkey-Registrierung erhalten', { type: data.type, result });

      window.postMessage({
        source: EXTENSION_SOURCE,
        type: 'global-hotkeys-registration',
        result,
      }, window.location.origin);
    } catch (error) {
      logExtensionEvent('Hotkey-Registrierung fehlgeschlagen', {
        type: data.type,
        error: error instanceof Error ? error.message : String(error),
      });
      window.postMessage({
        source: EXTENSION_SOURCE,
        type: 'global-hotkeys-registration',
        result: {
          ok: false,
          error: error instanceof Error ? error.message : 'Schreibdienst-Extension nicht erreichbar',
        },
      }, window.location.origin);
    }
    return;
  }

  if (data.type !== 'inject-text') return;

  try {
    logExtensionEvent('Leite Inject-Anfrage an Service Worker weiter', {
      requestId: data.requestId,
      mode: data.payload?.mode,
      textLength: typeof data.payload?.text === 'string' ? data.payload.text.length : null,
    });
    const result = await chrome.runtime.sendMessage({
      type: 'inject-text',
      requestId: data.requestId,
      payload: data.payload,
    });

    logExtensionEvent('Inject-Antwort vom Service Worker erhalten', {
      requestId: data.requestId,
      result,
    });

    window.postMessage({
      source: EXTENSION_SOURCE,
      requestId: data.requestId,
      result,
    }, window.location.origin);
  } catch (error) {
    logExtensionEvent('Inject-Anfrage fehlgeschlagen', {
      requestId: data.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    window.postMessage({
      source: EXTENSION_SOURCE,
      requestId: data.requestId,
      result: {
        ok: false,
        error: error instanceof Error ? error.message : 'Schreibdienst-Extension nicht erreichbar',
      },
    }, window.location.origin);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'global-hotkey') {
    return;
  }

  logExtensionEvent('Globalen Hotkey vom Service Worker empfangen', {
    payload: message.payload,
  });

  window.postMessage({
    source: EXTENSION_SOURCE,
    type: 'global-hotkey',
    payload: message.payload,
  }, window.location.origin);
});
