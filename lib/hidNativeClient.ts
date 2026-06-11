/**
 * Native-Host-HID-Client – Diktiermikrofon-Steuerung über den Schreibdienst-Injector.
 *
 * Ersetzt WebHID-Permission-Dialoge in Chrome: Der Native Host (C++) liest
 * Grundig SonicMic / Philips SpeechMike III via Windows Raw-Input-API und
 * sendet Record-Events per WebSocket an den Browser.
 *
 * Fallback: Wenn der Native Host nicht läuft, wird transparent auf WebHID
 * zurückgefallen (siehe hidMediaControls.ts).
 */

export type NativeHidAction = 'record';
export type NativeHidPhase = 'keydown' | 'keyup';

export interface NativeHidEvent {
  action: NativeHidAction;
  phase: NativeHidPhase;
  deviceName: string;
  vendorId: number;
  productId: number;
}

export interface NativeHidDeviceStatus {
  connected: boolean;
  deviceName?: string;
  vendorId?: number;
  productId?: number;
  supported: boolean;
}

const WS_URL = 'ws://localhost:58765';
const WS_CONNECT_TIMEOUT_MS = 2000;
const HID_CONFIRM_TIMEOUT_MS = 2000;
const WS_PING_INTERVAL_MS = 30000;

type HidEventCallback = (event: NativeHidEvent) => void;
type DeviceStatusCallback = (status: NativeHidDeviceStatus) => void;

let g_ws: WebSocket | null = null;
let g_wsReady: Promise<WebSocket> | null = null;
let g_hidConfirmed = false;
let g_deviceStatus: NativeHidDeviceStatus = { connected: false, supported: false };
let g_eventCallbacks = new Set<HidEventCallback>();
let g_statusCallbacks = new Set<DeviceStatusCallback>();
let g_pingTimer: ReturnType<typeof setInterval> | null = null;

function isSecureContext(): boolean {
  try {
    return typeof window !== 'undefined' && window.location.protocol === 'https:';
  } catch {
    return false;
  }
}

function updateDeviceStatus(partial: Partial<NativeHidDeviceStatus>) {
  g_deviceStatus = { ...g_deviceStatus, ...partial };
  g_statusCallbacks.forEach(cb => {
    try { cb(g_deviceStatus); } catch {}
  });
}

function startPing(ws: WebSocket) {
  stopPing();
  g_pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'hid-status' }));
    }
  }, WS_PING_INTERVAL_MS);
}

function stopPing() {
  if (g_pingTimer !== null) {
    clearInterval(g_pingTimer);
    g_pingTimer = null;
  }
}

/**
 * Richtet den dauerhaften Message-Handler für HID-Events ein.
 * Wird erst NACH erfolgreichem hid-status-Confirmation-Handshake aufgerufen.
 */
function setupMessageHandler(ws: WebSocket): void {
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'hid-event' && data.event) {
        const hidEvent: NativeHidEvent = {
          action: data.event.action,
          phase: data.event.phase,
          deviceName: data.event.deviceName || 'Unbekanntes Gerät',
          vendorId: data.event.vendorId ?? 0,
          productId: data.event.productId ?? 0,
        };
        g_eventCallbacks.forEach(cb => {
          try { cb(hidEvent); } catch {}
        });
      } else if (data.type === 'hid-device-connected') {
        updateDeviceStatus({
          connected: data.connected === true,
          deviceName: data.deviceName,
          vendorId: data.vendorId,
          productId: data.productId,
        });
      } else if (data.type === 'hid-status') {
        updateDeviceStatus({
          connected: data.connected === true,
          deviceName: data.deviceName,
          vendorId: data.vendorId,
          productId: data.productId,
          supported: true,
        });
      }
    } catch {
      // Not JSON or unknown format — ignore
    }
  };
}

function getSharedWs(): Promise<WebSocket> {
  if (g_ws && g_ws.readyState === WebSocket.OPEN) {
    return Promise.resolve(g_ws);
  }

  if (g_ws) {
    try { g_ws.close(); } catch {}
    g_ws = null;
  }

  if (g_wsReady) {
    return g_wsReady;
  }

  g_wsReady = new Promise<WebSocket>((resolve, reject) => {
    console.info('[HID-Native] Verbinde mit Injector WebSocket', { url: WS_URL });
    const ws = new WebSocket(WS_URL);

    const connectTimeout = setTimeout(() => {
      console.warn('[HID-Native] Verbindungs-Timeout');
      g_ws = null;
      g_wsReady = null;
      try { ws.close(); } catch {}
      reject(new Error('Injector-WebSocket nicht erreichbar (Timeout)'));
    }, WS_CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(connectTimeout);
      console.info('[HID-Native] WebSocket verbunden');

      // HID beim Native Host aktivieren und auf Bestätigung warten.
      // Alter Injector (v0.1.12) hat noch kein HID-Support und antwortet
      // nicht auf start-hid → Timeout → Fallback auf WebHID.
      let confirmTimeout: ReturnType<typeof setTimeout> | null = null;
      let confirmed = false;

      const confirmHandler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'hid-status') {
            confirmed = true;
            if (confirmTimeout !== null) clearTimeout(confirmTimeout);
            // Listener für Bestätigung entfernen, regulären Handler set up
            ws.removeEventListener('message', confirmHandler);
            setupMessageHandler(ws);
            g_ws = ws;
            g_wsReady = null;
            g_hidConfirmed = true;
            updateDeviceStatus({
              supported: true,
              connected: data.connected === true,
              deviceName: data.deviceName,
            });
            startPing(ws);
            resolve(ws);
            console.info('[HID-Native] HID-Unterstützung bestätigt (neuer Injector)');
          }
        } catch {
          // Not JSON — ignore during handshake
        }
      };

      ws.addEventListener('message', confirmHandler);

      confirmTimeout = setTimeout(() => {
        if (confirmed) return;
        ws.removeEventListener('message', confirmHandler);
        console.warn('[HID-Native] Keine HID-Bestätigung – alter Injector erkannt, Fallback auf WebHID');
        try { ws.close(); } catch {}
        g_ws = null;
        g_wsReady = null;
        g_hidConfirmed = false;
        updateDeviceStatus({ supported: false, connected: false });
        reject(new Error('Alter Injector (kein HID-Support)'));
      }, HID_CONFIRM_TIMEOUT_MS);

      ws.send(JSON.stringify({ type: 'start-hid' }));
    };

    ws.onerror = () => {
      clearTimeout(connectTimeout);
      console.warn('[HID-Native] WebSocket Fehler');
      g_ws = null;
      g_wsReady = null;
      reject(new Error('Schreibdienst-Injector nicht erreichbar'));
    };

    ws.onclose = (ev) => {
      clearTimeout(connectTimeout);
      console.info('[HID-Native] WebSocket geschlossen', { code: ev.code, wasClean: ev.wasClean });
      stopPing();
      g_ws = null;
      g_wsReady = null;
      g_hidConfirmed = false;
      updateDeviceStatus({ connected: false, supported: false });
    };
  });

  return g_wsReady;
}

/**
 * Versucht, die HID-Steuerung über den Native Host zu aktivieren.
 * Kehrt sofort zurück – die Verbindung wird im Hintergrund aufgebaut.
 *
 * @returns true wenn der Native Host erreichbar ist, false sonst
 */
export async function connectNativeHid(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    await getSharedWs();
    return true;
  } catch {
    console.info('[HID-Native] Nicht verfügbar – Fallback auf WebHID');
    return false;
  }
}

/**
 * Registriert einen Callback für HID-Events vom Diktiermikrofon.
 * Wird sowohl für Record-Keydown als auch Keyup aufgerufen.
 */
export function onNativeHidEvent(callback: HidEventCallback): () => void {
  g_eventCallbacks.add(callback);
  return () => {
    g_eventCallbacks.delete(callback);
  };
}

/**
 * Registriert einen Callback für Geräte-Status-Änderungen.
 */
export function onNativeHidStatus(callback: DeviceStatusCallback): () => void {
  g_statusCallbacks.add(callback);
  // Sofort aktuellen Status melden
  try { callback(g_deviceStatus); } catch {}
  return () => {
    g_statusCallbacks.delete(callback);
  };
}

/**
 * Liefert den aktuellen Status der Native-HID-Verbindung.
 */
export function getNativeHidStatus(): NativeHidDeviceStatus {
  return { ...g_deviceStatus };
}

/**
 * Prüft, ob der Native-Host-HID-Modus aktiv ist.
 * Liefert true, sobald der Handshake mit dem Native Host erfolgreich war –
 * unabhängig davon, ob aktuell ein physikalisches Gerät Daten sendet.
 * Der Native Host hat HID Raw Input registriert und ist empfangsbereit.
 */
export function isNativeHidConnected(): boolean {
  return g_hidConfirmed;
}

/**
 * Liefert true, wenn ein physikalisches HID-Gerät am Native Host
 * erkannt wurde und aktiv Daten sendet.
 */
export function isNativeHidDevicePresent(): boolean {
  return g_hidConfirmed && g_deviceStatus.connected;
}

/**
 * Trennt die Native-HID-Verbindung (z. B. beim App-Shutdown).
 */
export function disconnectNativeHid(): void {
  stopPing();
  if (g_ws) {
    try {
      g_ws.send(JSON.stringify({ type: 'stop-hid' }));
    } catch {}
    try { g_ws.close(); } catch {}
    g_ws = null;
    g_wsReady = null;
  }
  g_hidConfirmed = false;
  updateDeviceStatus({ connected: false, supported: false });
}
