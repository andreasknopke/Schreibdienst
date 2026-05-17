const HOST_NAME = 'com.schreibdienst.injector';

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'inject-text') return false;

  sendNative(message.payload).then(sendResponse);
  return true;
});
