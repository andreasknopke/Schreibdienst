const PAGE_SOURCE = 'schreibdienst-pwa';
const EXTENSION_SOURCE = 'schreibdienst-extension';

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;

  const data = event.data;
  if (!data || data.source !== PAGE_SOURCE) return;

  if (data.type === 'register-global-hotkeys' || data.type === 'unregister-global-hotkeys') {
    try {
      const result = await chrome.runtime.sendMessage({
        type: data.type,
      });

      window.postMessage({
        source: EXTENSION_SOURCE,
        type: 'global-hotkeys-registration',
        result,
      }, window.location.origin);
    } catch (error) {
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
    const result = await chrome.runtime.sendMessage({
      type: 'inject-text',
      requestId: data.requestId,
      payload: data.payload,
    });

    window.postMessage({
      source: EXTENSION_SOURCE,
      requestId: data.requestId,
      result,
    }, window.location.origin);
  } catch (error) {
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

  window.postMessage({
    source: EXTENSION_SOURCE,
    type: 'global-hotkey',
    payload: message.payload,
  }, window.location.origin);
});
