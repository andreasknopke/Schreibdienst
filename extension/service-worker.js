const HOST_NAME = 'com.schreibdienst.injector';
const hotkeyClients = new Set();

function logServiceWorkerEvent(message, details) {
  if (details) {
    console.info(`[Schreibdienst Native Bridge] ${message}`, details);
    return;
  }

  console.info(`[Schreibdienst Native Bridge] ${message}`);
}

let hotkeyPort = null;
let hotkeyReadyPromise = null;
let hotkeyReadyResolve = null;
let hotkeyReadyReject = null;

function sendNative(payload) {
  return new Promise((resolve) => {
    let port;

    try {
      logServiceWorkerEvent('Verbinde für Inject mit Native Host', {
        mode: payload?.mode,
        textLength: typeof payload?.text === 'string' ? payload.text.length : null,
      });
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (error) {
      logServiceWorkerEvent('Native Host für Inject nicht erreichbar', {
        error: error instanceof Error ? error.message : String(error),
      });
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : 'Native Host nicht registriert',
      });
      return;
    }

    let settled = false;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch (_) {
      }
      resolve(result);
    };

    const timeout = setTimeout(() => {
      logServiceWorkerEvent('Timeout beim Warten auf Native-Inject-Antwort');
      settle({ ok: false, error: 'Native Host antwortet nicht' });
    }, 8000);

    port.onMessage.addListener((response) => {
      clearTimeout(timeout);
      logServiceWorkerEvent('Native-Inject-Antwort erhalten', response || { ok: false, error: 'Leere Host-Antwort' });
      settle(response || { ok: false, error: 'Leere Host-Antwort' });
    });

    port.onDisconnect.addListener(() => {
      clearTimeout(timeout);
      if (!settled) {
        logServiceWorkerEvent('Native Host für Inject getrennt', {
          error: chrome.runtime.lastError?.message || 'Native Host getrennt',
        });
        settle({ ok: false, error: chrome.runtime.lastError?.message || 'Native Host getrennt' });
      }
    });

    port.postMessage({
      type: 'inject-text',
      payload,
    });
  });
}

function cleanupHotkeyPort(error) {
  logServiceWorkerEvent('Bereinige Hotkey-Port', {
    error: error || null,
    clients: hotkeyClients.size,
  });
  if (hotkeyPort) {
    try {
      hotkeyPort.disconnect();
    } catch (_) {
    }
  }

  hotkeyPort = null;

  if (hotkeyReadyReject) {
    hotkeyReadyReject(new Error(error || 'Native Hotkey-Host getrennt'));
  }

  hotkeyReadyPromise = null;
  hotkeyReadyResolve = null;
  hotkeyReadyReject = null;
}

async function broadcastHotkeyEvent(payload) {
  logServiceWorkerEvent('Verteile globales Hotkey-Event an Tabs', {
    payload,
    clients: hotkeyClients.size,
  });
  for (const tabId of Array.from(hotkeyClients)) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'global-hotkey',
        payload,
      });
    } catch (_error) {
      hotkeyClients.delete(tabId);
    }
  }

  if (hotkeyClients.size === 0 && hotkeyPort) {
    cleanupHotkeyPort();
  }
}

function ensureHotkeyListener() {
  if (hotkeyReadyPromise) {
    logServiceWorkerEvent('Hotkey-Listener bereits aktiv oder im Start');
    return hotkeyReadyPromise;
  }

  hotkeyReadyPromise = new Promise((resolve, reject) => {
    hotkeyReadyResolve = resolve;
    hotkeyReadyReject = reject;

    try {
      logServiceWorkerEvent('Verbinde Native Host für globale Hotkeys');
      hotkeyPort = chrome.runtime.connectNative(HOST_NAME);
    } catch (error) {
      cleanupHotkeyPort(error instanceof Error ? error.message : 'Native Host nicht registriert');
      return;
    }

    hotkeyPort.onMessage.addListener((message) => {
      if (!message) {
        return;
      }

      logServiceWorkerEvent('Nachricht vom Native Hotkey-Host', message);

      if (message.type === 'hotkey-event') {
        void broadcastHotkeyEvent(message.event || null);
        return;
      }

      if (message.type === 'hotkey-listener-ready') {
        if (message.ok) {
          if (hotkeyReadyResolve) {
            hotkeyReadyResolve({ ok: true });
            hotkeyReadyResolve = null;
            hotkeyReadyReject = null;
          }
        } else if (hotkeyReadyReject) {
          cleanupHotkeyPort(message.error || 'Globaler Hotkey-Listener konnte nicht gestartet werden');
        }
      }
    });

    hotkeyPort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || 'Native Hotkey-Host getrennt';
      logServiceWorkerEvent('Native Hotkey-Host getrennt', { error });
      cleanupHotkeyPort(error);
    });

    logServiceWorkerEvent('Fordere Native Hotkey-Registrierung an');
    hotkeyPort.postMessage({
      type: 'listen-hotkeys',
    });
  });

  return hotkeyReadyPromise;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  hotkeyClients.delete(tabId);
  if (hotkeyClients.size === 0 && hotkeyPort) {
    cleanupHotkeyPort();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  if (message.type === 'inject-text') {
    logServiceWorkerEvent('Inject-Anfrage vom Content-Script empfangen', {
      requestId: message.requestId,
      senderTabId: sender.tab?.id ?? null,
    });
    sendNative(message.payload).then(sendResponse);
    return true;
  }

  if (message.type === 'register-global-hotkeys') {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false, error: 'Kein Tab-Kontext für Hotkey-Registrierung' });
      return false;
    }

    hotkeyClients.add(tabId);
    logServiceWorkerEvent('Registriere Tab für globale Hotkeys', {
      tabId,
      clients: hotkeyClients.size,
    });
    ensureHotkeyListener()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Globaler Hotkey-Listener konnte nicht gestartet werden',
      }));
    return true;
  }

  if (message.type === 'unregister-global-hotkeys') {
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      hotkeyClients.delete(tabId);
    }

    logServiceWorkerEvent('Entferne Tab aus globalen Hotkeys', {
      tabId: typeof tabId === 'number' ? tabId : null,
      clients: hotkeyClients.size,
    });

    if (hotkeyClients.size === 0 && hotkeyPort) {
      cleanupHotkeyPort();
    }

    sendResponse({ ok: true });
    return false;
  }

  return false;
});
