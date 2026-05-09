export type HidMediaControlAction = 'play' | 'pause' | 'record' | 'fast-forward' | 'rewind' | 'stop';

export type HidMediaControlPhase = 'keydown' | 'keyup';

export type HidMediaControlSource = 'keyboard' | 'webhid';

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
}

export interface HidMediaControlsOptions {
  target?: Window;
  enabled?: boolean;
  onEvent?: (detail: HidMediaControlEventDetail) => void;
}

export const HID_MEDIA_CONTROL_EVENT = 'schreibdienst:hid-media-control';
export const HID_MEDIA_CONTROL_STATUS_EVENT = 'schreibdienst:hid-media-control-status';

const GRUNDIG_SONICMIC_VENDOR_ID = 0x15d8;
const GRUNDIG_SONICMIC_PRODUCT_ID = 0x0025;
const GRUNDIG_SONICMIC_RECORD_REPORT_ID = 0x01;

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
  requestDevice: (options: { filters: Array<{ vendorId: number; productId?: number }> }) => Promise<WebHidDevice[]>;
}

interface ConnectedWebHidDevice {
  removeListener: () => void;
  recordPressed: boolean;
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

function isGrundigRecordReport(reportId: number, bytes: number[]): boolean {
  if (reportId !== GRUNDIG_SONICMIC_RECORD_REPORT_ID) {
    return false;
  }

  const payload = normalizeGrundigReportPayload(reportId, bytes);

  return (
    payload.length >= 8 &&
    payload[0] === 0x01 &&
    payload[1] === 0x00 &&
    payload[2] === 0x00 &&
    payload[3] === 0x00 &&
    payload[4] === 0x00 &&
    payload[5] === 0x00 &&
    payload[6] === 0x40 &&
    payload[7] === 0x02
  );
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
  if (!isGrundigSonicMic(device)) {
    return false;
  }

  if (connectedWebHidDevices.has(device)) {
    return true;
  }

  if (!device.opened) {
    await device.open();
  }

  const state: ConnectedWebHidDevice = {
    recordPressed: false,
    removeListener: () => undefined,
  };

  const handleInputReport = (event: Event) => {
    const inputEvent = event as WebHidInputReportEvent;
    const recordPressed = isGrundigRecordReport(inputEvent.reportId, inputReportBytes(inputEvent.data));

    if (recordPressed && !state.recordPressed) {
      state.recordPressed = true;
      dispatchActionEvent(target, {
        action: 'record',
        hidUsage: '0xFF00:0x0001/0x01',
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
        hidUsage: '0xFF00:0x0001/0x01',
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
  const matches = devices.filter(isGrundigSonicMic);
  await Promise.all(matches.map((device) => connectWebHidDevice(device, target, onEvent)));
  dispatchStatusEvent(target);

  return matches.length;
}

export function stopHidMediaControls(): void {
  removeListeners?.();
  removeListeners = null;
  connectedWebHidDevices.forEach((deviceState) => deviceState.removeListener());
  connectedWebHidDevices.clear();
  activeWindow = null;
}

export function getHidMediaControlStatus(): HidMediaControlStatusDetail {
  const firstDevice = connectedWebHidDevices.keys().next().value as WebHidDevice | undefined;
  return {
    supported: getWebHidApi() !== null,
    connected: connectedWebHidDevices.size > 0,
    deviceName: firstDevice?.productName,
  };
}

export async function connectGrundigSonicMic(options: HidMediaControlsOptions = {}): Promise<number> {
  if (typeof window === 'undefined') {
    return 0;
  }

  const hid = getWebHidApi();
  if (!hid) {
    throw new Error('WebHID wird von diesem Browser nicht unterstützt.');
  }

  const target = options.target ?? window;
  const devices = await hid.requestDevice({
    filters: [{ vendorId: GRUNDIG_SONICMIC_VENDOR_ID, productId: GRUNDIG_SONICMIC_PRODUCT_ID }],
  });

  await Promise.all(devices.map((device) => connectWebHidDevice(device, target, options.onEvent)));
  dispatchStatusEvent(target);

  return devices.length;
}

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

  const hid = getWebHidApi();
  const handleDisconnect = (event: Event) => {
    const device = (event as WebHidConnectionEvent).device;
    const deviceState = connectedWebHidDevices.get(device);
    if (!deviceState) {
      return;
    }

    deviceState.removeListener();
    connectedWebHidDevices.delete(device);
    dispatchStatusEvent(target);
  };

  target.addEventListener('keydown', handleKeyDown);
  target.addEventListener('keyup', handleKeyUp);
  hid?.addEventListener('disconnect', handleDisconnect);
  void connectGrantedWebHidDevices(target, options.onEvent).catch(() => undefined);

  activeWindow = target;
  removeListeners = () => {
    target.removeEventListener('keydown', handleKeyDown);
    target.removeEventListener('keyup', handleKeyUp);
    hid?.removeEventListener('disconnect', handleDisconnect);
  };
}
