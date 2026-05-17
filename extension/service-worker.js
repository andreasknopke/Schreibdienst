const HOST_NAME = 'com.schreibdienst.injector';
const hotkeyClients = new Set();

let hotkeyPort = null;
let hotkeyReadyPromise = null;
let hotkeyReadyResolve = null;
let hotkeyReadyReject = null;

function sendNative(payload) {
  return new Promise((resolve) => {
    let port;

    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (error) {
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
      settle({ ok: false, error: 'Native Host antwortet nicht' });
    }, 8000);

    port.onMessage.addListener((response) => {
      clearTimeout(timeout);
      settle(response || { ok: false, error: 'Leere Host-Antwort' });
    });

    port.onDisconnect.addListener(() => {
      clearTimeout(timeout);
      if (!settled) {
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
    return hotkeyReadyPromise;
  }

  hotkeyReadyPromise = new Promise((resolve, reject) => {
    hotkeyReadyResolve = resolve;
    hotkeyReadyReject = reject;

    try {
      hotkeyPort = chrome.runtime.connectNative(HOST_NAME);
    } catch (error) {
      cleanupHotkeyPort(error instanceof Error ? error.message : 'Native Host nicht registriert');
      return;
    }

    hotkeyPort.onMessage.addListener((message) => {
      if (!message) {
        return;
      }

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
      cleanupHotkeyPort(error);
    });

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

    if (hotkeyClients.size === 0 && hotkeyPort) {
      cleanupHotkeyPort();
    }

    sendResponse({ ok: true });
    return false;
  }

  return false;
});
