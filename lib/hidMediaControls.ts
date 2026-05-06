export type HidMediaControlAction = 'play' | 'pause' | 'record' | 'fast-forward' | 'rewind' | 'stop';

export type HidMediaControlPhase = 'keydown' | 'keyup';

export interface HidMediaControlEventDetail {
  action: HidMediaControlAction;
  hidUsage: string;
  key: string;
  code: string;
  phase: HidMediaControlPhase;
  originalEvent: KeyboardEvent;
}

export interface HidMediaControlsOptions {
  target?: Window;
  enabled?: boolean;
  onEvent?: (detail: HidMediaControlEventDetail) => void;
}

export const HID_MEDIA_CONTROL_EVENT = 'schreibdienst:hid-media-control';

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

  const detail: HidMediaControlEventDetail = {
    action,
    hidUsage: HID_USAGE_BY_ACTION[action],
    key: event.key,
    code: event.code,
    phase,
    originalEvent: event,
  };

  target.dispatchEvent(new CustomEvent<HidMediaControlEventDetail>(HID_MEDIA_CONTROL_EVENT, { detail }));
  target.dispatchEvent(new CustomEvent<HidMediaControlEventDetail>(`${HID_MEDIA_CONTROL_EVENT}:${action}`, { detail }));
  onEvent?.(detail);
}

export function stopHidMediaControls(): void {
  removeListeners?.();
  removeListeners = null;
  activeWindow = null;
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

  target.addEventListener('keydown', handleKeyDown);
  target.addEventListener('keyup', handleKeyUp);

  activeWindow = target;
  removeListeners = () => {
    target.removeEventListener('keydown', handleKeyDown);
    target.removeEventListener('keyup', handleKeyUp);
  };
}