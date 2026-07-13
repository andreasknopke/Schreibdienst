export type HidMediaControlAction = 'play' | 'pause' | 'record' | 'fast-forward' | 'rewind' | 'stop';

export type HidMediaControlPhase = 'keydown' | 'keyup';

export type HidMediaControlSource = 'keyboard' | 'webhid' | 'native-host';

export interface HidMediaControlEventDetail {
  action: HidMediaControlAction;
  hidUsage: string;
  key: string;
  code: string;
  phase: HidMediaControlPhase;
  source: HidMediaControlSource;
  deviceName?: string;
  originalEvent?: KeyboardEvent;
}

export interface HidMediaControlStatusDetail {
  supported: boolean;
  connected: boolean;
  deviceName?: string;
  connectedDeviceCount: number;
  source?: HidMediaControlSource;
}

export interface HidMediaControlsOptions {
  target?: Window;
  enabled?: boolean;
  onEvent?: (detail: HidMediaControlEventDetail) => void;
}

export const HID_MEDIA_CONTROL_EVENT = 'schreibdienst:hid-media-control';
export const HID_MEDIA_CONTROL_STATUS_EVENT = 'schreibdienst:hid-media-control-status';

// Native-Host-HID-Integration (kein Chrome-Permission-Dialog nötig)
import {
  connectNativeHid,
  disconnectNativeHid,
  onNativeHidEvent,
  onNativeHidStatus,
  isNativeHidConnected,
} from './hidNativeClient';

let g_nativeHidCleanup: (() => void) | null = null;

const GRUNDIG_SONICMIC_VENDOR_ID = 0x15d8;
const GRUNDIG_SONICMIC_PRODUCT_ID = 0x0025;
const GRUNDIG_SONICMIC_RECORD_REPORT_ID = 0x01;
const PHILIPS_SPEECHMIKE_VENDOR_ID = 0x0911;
const PHILIPS_SPEECHMIKE_III_PRODUCT_ID = 0x0c1c;
const PHILIPS_SPEECHMIKE_III_RECORD_REPORT_ID = 0x00;

const NORDIC_DICTATION_VENDOR_ID = 0x1915;
const NORDIC_DICTATION_PRODUCT_ID = 0x1025;
const NORDIC_DICTATION_RECORD_REPORT_ID = 0x02;
const NORDIC_DICTATION_RECORD_USAGE = 0x00CF;

const HID_USAGE_BY_ACTION: Record<HidMediaControlAction, string> = {
  play: '0xB0',
  pause: '0xB1',
  record: '0xB2',
  'fast-forward': '0xB3',
  rewind: '0xB4',
  stop: '0xB7',
};

const ACTION_BY_IDENTIFIER: Record<string, HidMediaControlAction> = {
  mediaplay: 'play',
  mediaplaypause: 'play',
  '0xb0': 'play',
  '176': 'play',
  mediapause: 'pause',
  '0xb1': 'pause',
  '177': 'pause',
  mediarecord: 'record',
  '0xb2': 'record',
  '178': 'record',
  mediafastforward: 'fast-forward',
  mediatracknext: 'fast-forward',
  '0xb3': 'fast-forward',
  '179': 'fast-forward',
  mediarewind: 'rewind',
  mediatrackprevious: 'rewind',
  '0xb4': 'rewind',
  '180': 'rewind',
  mediastop: 'stop',
  '0xb7': 'stop',
  '183': 'stop',
};

interface WebHidDevice extends EventTarget {
  vendorId: number;
  productId: number;
  productName: string;
  opened: boolean;
  open: () => Promise<void>;
}

interface WebHidInputReportEvent extends Event {
  device: WebHidDevice;
  reportId: number;
  data: DataView;
}

interface WebHidConnectionEvent extends Event {
  device: WebHidDevice;
}

interface WebHidApi extends EventTarget {
  getDevices: () => Promise<WebHidDevice[]>;
  requestDevice: (options: { filters: Array<{ vendorId?: number; productId?: number; usagePage?: number; usage?: number }> }) => Promise<WebHidDevice[]>;
}

interface ConnectedWebHidDevice {
  removeListener: () => void;
  recordPressed: boolean;
}

interface SupportedWebHidDeviceDefinition {
  vendorId: number;
  productId: number;
  hidUsage: string;
  matchesRecordReport: (reportId: number, bytes: number[]) => boolean;
  /** Alternative Filter-Methode: usagePage (z.B. 0x000C für Consumer Control),
   *  falls das Gerät von Windows als Maus/Tastatur blockiert wird. */
  usagePage?: number;
}

const connectedWebHidDevices = new Map<WebHidDevice, ConnectedWebHidDevice>();

let activeWindow: Window | null = null;
let removeListeners: (() => void) | null = null;

function normalizeIdentifier(value: string | number | undefined): string {
  if (value === undefined) {
    return '';
  }

  return String(value).trim().toLowerCase();
}

function resolveAction(event: KeyboardEvent): HidMediaControlAction | null {
  const candidates = [
    normalizeIdentifier(event.key),
    normalizeIdentifier(event.code),
    normalizeIdentifier((event as KeyboardEvent & { keyCode?: number }).keyCode),
    normalizeIdentifier((event as KeyboardEvent & { which?: number }).which),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const action = ACTION_BY_IDENTIFIER[candidate];
    if (action) {
      return action;
    }
  }

  return null;
}

function getWebHidApi(): WebHidApi | null {
  if (typeof navigator === 'undefined' || !('hid' in navigator)) {
    return null;
  }

  return (navigator as Navigator & { hid: WebHidApi }).hid;
}

function isGrundigSonicMic(device: WebHidDevice): boolean {
  return device.vendorId === GRUNDIG_SONICMIC_VENDOR_ID && device.productId === GRUNDIG_SONICMIC_PRODUCT_ID;
}

function isPhilipsSpeechMikeIII(device: WebHidDevice): boolean {
  return device.vendorId === PHILIPS_SPEECHMIKE_VENDOR_ID && device.productId === PHILIPS_SPEECHMIKE_III_PRODUCT_ID;
}

function isNordicDictationDevice(device: WebHidDevice): boolean {
  return device.vendorId === NORDIC_DICTATION_VENDOR_ID && device.productId === NORDIC_DICTATION_PRODUCT_ID;
}

function isSupportedWebHidDevice(device: WebHidDevice): boolean {
  return isGrundigSonicMic(device) || isPhilipsSpeechMikeIII(device) || isNordicDictationDevice(device);
}

function inputReportBytes(data: DataView): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < data.byteLength; index += 1) {
    bytes.push(data.getUint8(index));
  }

  return bytes;
}

function normalizeGrundigReportPayload(reportId: number, bytes: number[]): number[] {
  if (bytes.length > 1 && bytes[0] === reportId && bytes[1] === 0x01) {
    return bytes.slice(1);
  }

  return bytes;
}

function matchesGrundigRecordPayload(payload: number[]): boolean {
  // Grundig SonicMic über WebHID (nach normalizeGrundigReportPayload):
  //   Record gedrueckt:  [01 00 00 00 00 00 00 40 03 00 ...]
  //   Record losgelassen: [01 00 00 00 00 00 00 00 03 00 ...]
  // Byte 0 = Report-ID (0x01) nach Normalisierung
  // Byte 6 = 0x40 (gedrueckt) / 0x00 (losgelassen)
  return (
    payload.length >= 7 &&
    payload[0] === 0x01 &&
    payload[6] === 0x40
  );
}

function isGrundigRecordReport(reportId: number, bytes: number[]): boolean {
  if (reportId !== GRUNDIG_SONICMIC_RECORD_REPORT_ID) {
    return false;
  }

  const normalizedPayload = normalizeGrundigReportPayload(reportId, bytes);
  const payloads = [normalizedPayload, bytes];

  for (const payload of payloads) {
    for (let offset = 0; offset <= payload.length - 8; offset += 1) {
      if (matchesGrundigRecordPayload(payload.slice(offset, offset + 8))) {
        return true;
      }
    }
  }

  return false;
}

function matchesPhilipsSpeechMikeRecordPayload(payload: number[]): boolean {
  return (
    payload.length >= 9 &&
    payload[0] === 0x80 &&
    payload[1] === 0x00 &&
    payload[2] === 0x00 &&
    payload[3] === 0x00 &&
    payload[4] === 0x00 &&
    payload[5] === 0x00 &&
    payload[6] === 0x00 &&
    payload[7] === 0x00 &&
    payload[8] === 0x01
  );
}

function isPhilipsSpeechMikeRecordReport(reportId: number, bytes: number[]): boolean {
  if (reportId !== PHILIPS_SPEECHMIKE_III_RECORD_REPORT_ID) {
    return false;
  }

  const payloads = bytes.length > 1 && bytes[0] === reportId
    ? [bytes, bytes.slice(1)]
    : [bytes];

  for (const payload of payloads) {
    for (let offset = 0; offset <= payload.length - 9; offset += 1) {
      if (matchesPhilipsSpeechMikeRecordPayload(payload.slice(offset, offset + 9))) {
        return true;
      }
    }
  }

  return false;
}

function isNordicDictationRecordReport(reportId: number, bytes: number[]): boolean {
  // Consumer Control report 0x02: 16-bit little-endian usage value
  // Record-Taste gedrueckt = Usage 0x00CF
  //
  // WICHTIG: Auf Windows enthaelt event.data KEIN Report-ID-Byte!
  // Chrome/Win liefert nur die Payload: [0xCF, 0x00] (2 Bytes)
  // Chrome/Linux/Mac KANN das Report-ID-Byte enthalten: [0x02, 0xCF, 0x00] (3 Bytes)
  // Wir pruefen beide Varianten.
  if (reportId !== NORDIC_DICTATION_RECORD_REPORT_ID) {
    return false;
  }

  if (bytes.length === 0) return false;

  // Fall 1: Report-ID ist im ersten Byte enthalten (Linux/Mac, manchmal Win)
  if (bytes[0] === 0x02 && bytes.length >= 3) {
    const usage = bytes[1] | (bytes[2] << 8);
    if (usage === NORDIC_DICTATION_RECORD_USAGE) return true;
  }

  // Fall 2: Reine Payload ohne Report-ID (Windows, haeufigster Fall)
  if (bytes.length >= 2) {
    const usage = bytes[0] | (bytes[1] << 8);
    if (usage === NORDIC_DICTATION_RECORD_USAGE) return true;
  }

  return false;
}

const SUPPORTED_WEBHID_DEVICES: SupportedWebHidDeviceDefinition[] = [
  {
    vendorId: GRUNDIG_SONICMIC_VENDOR_ID,
    productId: GRUNDIG_SONICMIC_PRODUCT_ID,
    hidUsage: '0xFF00:0x0001/0x01',
    matchesRecordReport: isGrundigRecordReport,
  },
  {
    vendorId: PHILIPS_SPEECHMIKE_VENDOR_ID,
    productId: PHILIPS_SPEECHMIKE_III_PRODUCT_ID,
    hidUsage: '0xFFA1:0x0003/0x0004',
    matchesRecordReport: isPhilipsSpeechMikeRecordReport,
  },
  {
    vendorId: NORDIC_DICTATION_VENDOR_ID,
    productId: NORDIC_DICTATION_PRODUCT_ID,
    hidUsage: '0x000C:0x0001/0x02',
    matchesRecordReport: isNordicDictationRecordReport,
    usagePage: 0x000C, // Consumer Control – umgeht Windows-Maus-Blockierung
  },
];

function getSupportedWebHidDeviceDefinition(device: WebHidDevice): SupportedWebHidDeviceDefinition | null {
  return SUPPORTED_WEBHID_DEVICES.find((definition) => (
    definition.vendorId === device.vendorId && definition.productId === device.productId
  )) ?? null;
}

function dispatchActionEvent(
  target: Window,
  detail: HidMediaControlEventDetail,
  onEvent?: (detail: HidMediaControlEventDetail) => void,
): void {
  target.dispatchEvent(new CustomEvent<HidMediaControlEventDetail>(HID_MEDIA_CONTROL_EVENT, { detail }));
  target.dispatchEvent(new CustomEvent<HidMediaControlEventDetail>(`${HID_MEDIA_CONTROL_EVENT}:${detail.action}`, { detail }));
  onEvent?.(detail);
}

function dispatchStatusEvent(target: Window): void {
  target.dispatchEvent(new CustomEvent<HidMediaControlStatusDetail>(HID_MEDIA_CONTROL_STATUS_EVENT, {
    detail: getHidMediaControlStatus(),
  }));
}

function dispatchControlEvent(
  target: Window,
  event: KeyboardEvent,
  phase: HidMediaControlPhase,
  onEvent?: (detail: HidMediaControlEventDetail) => void,
): void {
  if (phase === 'keydown' && event.repeat) {
    return;
  }

  const action = resolveAction(event);
  if (!action) {
    return;
  }

  dispatchActionEvent(target, {
    action,
    hidUsage: HID_USAGE_BY_ACTION[action],
    key: event.key,
    code: event.code,
    phase,
    source: 'keyboard',
    originalEvent: event,
  }, onEvent);
}

async function connectWebHidDevice(
  device: WebHidDevice,
  target: Window,
  onEvent?: (detail: HidMediaControlEventDetail) => void,
): Promise<boolean> {
  const deviceDefinition = getSupportedWebHidDeviceDefinition(device);
  if (!deviceDefinition) {
    return false;
  }

  if (connectedWebHidDevices.has(device)) {
    return true;
  }

  if (!device.opened) {
    await device.open();
    console.info('[HID] Device geöffnet: %s (VID=0x%04X PID=0x%04X)',
      device.productName, device.vendorId, device.productId);
  }

  const state: ConnectedWebHidDevice = {
    recordPressed: false,
    removeListener: () => undefined,
  };

  const handleInputReport = (event: Event) => {
    const inputEvent = event as WebHidInputReportEvent;
    const rawBytes = inputReportBytes(inputEvent.data);
    console.debug(
      '[HID] inputreport: device=%s reportId=0x%02X bytes=[%s] (%d bytes)',
      inputEvent.device.productName,
      inputEvent.reportId,
      rawBytes.map(b => b.toString(16).padStart(2, '0')).join(' '),
      rawBytes.length,
    );
    const recordPressed = deviceDefinition.matchesRecordReport(inputEvent.reportId, rawBytes);

    if (recordPressed && !state.recordPressed) {
      state.recordPressed = true;
      dispatchActionEvent(target, {
        action: 'record',
        hidUsage: deviceDefinition.hidUsage,
        key: 'MediaRecord',
        code: 'MediaRecord',
        phase: 'keydown',
        source: 'webhid',
        deviceName: inputEvent.device.productName,
      }, onEvent);
      return;
    }

    if (!recordPressed && state.recordPressed) {
      state.recordPressed = false;
      dispatchActionEvent(target, {
        action: 'record',
        hidUsage: deviceDefinition.hidUsage,
        key: 'MediaRecord',
        code: 'MediaRecord',
        phase: 'keyup',
        source: 'webhid',
        deviceName: inputEvent.device.productName,
      }, onEvent);
    }
  };

  device.addEventListener('inputreport', handleInputReport);
  state.removeListener = () => device.removeEventListener('inputreport', handleInputReport);
  connectedWebHidDevices.set(device, state);
  dispatchStatusEvent(target);

  return true;
}

async function connectGrantedWebHidDevices(
  target: Window,
  onEvent?: (detail: HidMediaControlEventDetail) => void,
): Promise<number> {
  const hid = getWebHidApi();
  if (!hid) {
    return 0;
  }

  const devices = await hid.getDevices();
  const matches = devices.filter(isSupportedWebHidDevice);
  await Promise.all(matches.map((device) => connectWebHidDevice(device, target, onEvent)));
  dispatchStatusEvent(target);

  return matches.length;
}

export function stopHidMediaControls(): void {
  removeListeners?.();
  removeListeners = null;
  connectedWebHidDevices.forEach((deviceState) => deviceState.removeListener());
  connectedWebHidDevices.clear();
  stopNativeHidCleanup();
  disconnectNativeHid();
  activeWindow = null;
}

export function getHidMediaControlStatus(): HidMediaControlStatusDetail {
  const firstDevice = connectedWebHidDevices.keys().next().value as WebHidDevice | undefined;
  const nativeConnected = isNativeHidConnected();

  // Native Host hat Vorrang
  if (nativeConnected) {
    return {
      supported: true,
      connected: true,
      deviceName: undefined,
      connectedDeviceCount: 1,
      source: 'native-host',
    };
  }

  return {
    supported: getWebHidApi() !== null,
    connected: connectedWebHidDevices.size > 0,
    deviceName: firstDevice?.productName,
    connectedDeviceCount: connectedWebHidDevices.size,
  };
}

export async function connectDictationMicrophone(options: HidMediaControlsOptions = {}): Promise<number> {
  if (typeof window === 'undefined') {
    return 0;
  }

  const hid = getWebHidApi();
  if (!hid) {
    throw new Error('WebHID wird von diesem Browser nicht unterstützt.');
  }

  const target = options.target ?? window;

  // Baue Filter: vendorId+productId (Standard) UND vendorId+usagePage (Fallback
  // für Geräte, die von Windows als Maus/Tastatur blockiert werden).
  // Beide Filter-Typen für jedes Gerät, damit Chrome über beide Collections
  // matchen kann.
  const filters: Array<{ vendorId?: number; productId?: number; usagePage?: number }> = [];
  for (const def of SUPPORTED_WEBHID_DEVICES) {
    // Primär-Filter: vendorId + productId
    filters.push({ vendorId: def.vendorId, productId: def.productId });
    // Fallback-Filter: vendorId + usagePage (umgeht Windows-Maus-Blockierung)
    if (def.usagePage !== undefined) {
      filters.push({ vendorId: def.vendorId, usagePage: def.usagePage });
    }
  }

  console.info('[HID] requestDevice mit %d Filtern: %o', filters.length, filters);
  const selectedDevices = await hid.requestDevice({ filters });
  console.info('[HID] requestDevice zurück: %d Gerät(e)', selectedDevices.length);

  if (selectedDevices.length === 0) {
    console.warn('[HID] Kein Gerät ausgewählt. Mögliche Ursachen:');
    console.warn('[HID]  - Gerät wird von Windows als Maus/Tastatur blockiert → Native Host nutzen');
    console.warn('[HID]  - chrome://device-log prüfen');
  }

  const grantedDevices = await hid.getDevices();
  const devices = grantedDevices.filter(isSupportedWebHidDevice);
  console.info('[HID] Bereits genehmigte Geräte: %d, davon unterstützt: %d',
    grantedDevices.length, devices.length);

  await Promise.all(devices.map((device) => connectWebHidDevice(device, target, options.onEvent)));
  dispatchStatusEvent(target);

  return selectedDevices.length;
}

export const connectGrundigSonicMic = connectDictationMicrophone;

export function startHidMediaControls(options: HidMediaControlsOptions = {}): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (options.enabled === false) {
    stopHidMediaControls();
    return;
  }

  const target = options.target ?? window;

  if (activeWindow === target && removeListeners) {
    return;
  }

  stopHidMediaControls();

  const handleKeyDown = (event: KeyboardEvent) => {
    dispatchControlEvent(target, event, 'keydown', options.onEvent);
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    dispatchControlEvent(target, event, 'keyup', options.onEvent);
  };

  target.addEventListener('keydown', handleKeyDown);
  target.addEventListener('keyup', handleKeyUp);

  // ── Native-Host-HID (primär) ──
  // Versuche zuerst die HID-Steuerung über den Native Host – kein Chrome-Dialog nötig.
  connectNativeHid().then((ok) => {
    if (!ok) {
      // Alter Injector oder Native Host nicht erreichbar → WebHID-Fallback
      console.info('[HID] Native Host nicht erreichbar – verwende WebHID-Fallback');
      startWebHidFallback(target, options);
      return;
    }

    // Native HID Event → HidMediaControlEventDetail konvertieren
    const unsubEvent = onNativeHidEvent((nativeEvent) => {
      dispatchActionEvent(target, {
        action: 'record',
        hidUsage: '0xFF00:0x0001/0x01',
        key: 'MediaRecord',
        code: 'MediaRecord',
        phase: nativeEvent.phase === 'keydown' ? 'keydown' : 'keyup',
        source: 'native-host',
        deviceName: nativeEvent.deviceName,
      }, options.onEvent);
    });

    // Status-Propagation von Native Host ins HidMediaControlStatusDetail
    const unsubStatus = onNativeHidStatus((status) => {
      // Native-Host-Infrastruktur ist bereit – melde connected: true,
      // auch wenn gerade kein physikalisches Geraet aktiv ist.
      // Der Native Host hoert via Raw Input auf HID-Geraete und meldet
      // sich, sobald ein Record-Event eingeht.
      const detail: HidMediaControlStatusDetail = {
        supported: status.supported || getWebHidApi() !== null,
        connected: true, // Native Host ist bereit
        deviceName: status.deviceName,
        connectedDeviceCount: status.connected ? 1 : 0,
        source: 'native-host',
      };
      target.dispatchEvent(new CustomEvent<HidMediaControlStatusDetail>(
        HID_MEDIA_CONTROL_STATUS_EVENT,
        { detail },
      ));
    });

    g_nativeHidCleanup = () => {
      unsubEvent();
      unsubStatus();
    };

    console.info('[HID] Native-Host-HID aktiv – kein WebHID-Fallback nötig');
  }).catch(() => {
    // Unerwarteter Fehler in der then()-Kette – Fallback
    console.info('[HID] Unerwarteter Fehler – verwende WebHID-Fallback');
    startWebHidFallback(target, options);
  });

  activeWindow = target;
  removeListeners = () => {
    target.removeEventListener('keydown', handleKeyDown);
    target.removeEventListener('keyup', handleKeyUp);
    stopWebHidListeners();
    stopNativeHidCleanup();
  };
}

/**
 * WebHID-Fallback: Registriert Keyboard- und WebHID-Listener wie bisher.
 */
function startWebHidFallback(target: Window, options: HidMediaControlsOptions): void {
  const hid = getWebHidApi();

  const handleDisconnect = (event: Event) => {
    const device = (event as WebHidConnectionEvent).device;
    const deviceState = connectedWebHidDevices.get(device);
    if (!deviceState) return;

    deviceState.removeListener();
    connectedWebHidDevices.delete(device);
    dispatchStatusEvent(target);
  };

  hid?.addEventListener('disconnect', handleDisconnect);

  // Bestehende WebHID-Listener-Registrierung in removeListeners übernehmen
  const prevRemove = removeListeners;
  removeListeners = () => {
    prevRemove?.();
    hid?.removeEventListener('disconnect', handleDisconnect);
  };

  void connectGrantedWebHidDevices(target, options.onEvent).catch(() => undefined);
}

/**
 * Cleanup für WebHID-Listener (wird beim Umschalten auf Native Host aufgerufen).
 */
function stopWebHidListeners(): void {
  connectedWebHidDevices.forEach((deviceState) => deviceState.removeListener());
  connectedWebHidDevices.clear();
}

function stopNativeHidCleanup(): void {
  g_nativeHidCleanup?.();
  g_nativeHidCleanup = null;
}
