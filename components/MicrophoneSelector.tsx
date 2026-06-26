'use client';
import { useState, useRef, useEffect } from 'react';
import { useMicrophone } from '@/lib/MicrophoneContext';
import {
  getHidMediaControlStatus,
  HID_MEDIA_CONTROL_STATUS_EVENT,
  type HidMediaControlStatusDetail,
} from '@/lib/hidMediaControls';

export default function MicrophoneSelector() {
  const { deviceId, deviceLabel, available, selectDevice, favoriteDeviceId, setFavoriteDeviceId } = useMicrophone();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [hidConnected, setHidConnected] = useState(false);
  const [hidDeviceName, setHidDeviceName] = useState<string | null>(null);
  const [hidSource, setHidSource] = useState<HidMediaControlStatusDetail['source']>(undefined);

  // HID-Status verfolgen
  useEffect(() => {
    const applyStatus = (status: HidMediaControlStatusDetail) => {
      setHidConnected(status.connected);
      setHidDeviceName(status.deviceName ?? null);
      setHidSource(status.source);
    };
    applyStatus(getHidMediaControlStatus());
    const handler = (event: Event) => {
      applyStatus((event as CustomEvent<HidMediaControlStatusDetail>).detail);
    };
    window.addEventListener(HID_MEDIA_CONTROL_STATUS_EVENT, handler as EventListener);
    return () => window.removeEventListener(HID_MEDIA_CONTROL_STATUS_EVENT, handler as EventListener);
  }, []);

  // Schliesst Dropdown bei Klick ausserhalb
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const hasDevices = available.length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-xs w-44"
        title={`Mikrofon: ${deviceLabel}`}
      >
        {/* Mikrofon-Icon */}
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" x2="12" y1="19" y2="22"/>
        </svg>
        <span className="truncate">{deviceLabel}</span>
        {favoriteDeviceId && (
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" className="shrink-0 text-amber-400">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        )}
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-gray-200 dark:border-zinc-700 py-1 z-50 max-h-60 overflow-y-auto">
          {!hasDevices && (
            <div className="px-3 py-2 text-xs text-gray-400 italic">
              Keine Mikrofone gefunden
            </div>
          )}

          {/* Standard-Mikrofon (Browser-Standard) */}
          <div className="flex items-center px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-zinc-700">
            <button
              onClick={() => { selectDevice(null); setOpen(false); }}
              className={`flex items-center gap-2 flex-1 min-w-0 text-left ${
                deviceId === null ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              </svg>
              <span className="truncate">System-Standard</span>
              {deviceId === null && <span className="ml-auto text-blue-600 dark:text-blue-400">✓</span>}
            </button>
          </div>

          {hasDevices && <div className="border-t border-gray-100 dark:border-zinc-700 my-1" />}

          {/* Verfügbare Mikrofone */}
          {available.map(dev => {
            const isFavorite = favoriteDeviceId === dev.deviceId;
            return (
              <div key={dev.deviceId} className="flex items-center px-3 py-1 text-xs hover:bg-gray-100 dark:hover:bg-zinc-700 group">
                <button
                  onClick={() => { selectDevice(dev.deviceId); setOpen(false); }}
                  className={`flex items-center gap-2 flex-1 min-w-0 text-left py-1 ${
                    deviceId === dev.deviceId ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'
                  }`}
                  title={dev.label || 'Unbekanntes Gerät'}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  </svg>
                  <span className="truncate">{dev.label || `Mikrofon ${dev.deviceId.slice(0, 8)}…`}</span>
                  {deviceId === dev.deviceId && <span className="ml-auto text-blue-600 dark:text-blue-400">✓</span>}
                </button>
                {/* Stern für Favorit */}
                <button
                  onClick={(e) => { e.stopPropagation(); setFavoriteDeviceId(isFavorite ? null : dev.deviceId); }}
                  className={`shrink-0 p-1 rounded hover:bg-gray-200 dark:hover:bg-zinc-600 transition-colors ${
                    isFavorite ? 'text-amber-400' : 'text-gray-300 dark:text-zinc-600 group-hover:text-gray-400 dark:group-hover:text-zinc-400'
                  }`}
                  title={isFavorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
                  aria-label={isFavorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                </button>
              </div>
            );
          })}

          {/* Keine Labels = Permission fehlt */}
          {hasDevices && !available.some(d => d.label) && (
            <div className="px-3 py-2 text-xs text-amber-600 dark:text-amber-400 italic border-t border-gray-100 dark:border-zinc-700">
              Bitte Mikrofon-Zugriff erlauben, um Gerätenamen zu sehen.
            </div>
          )}

          {/* HID-Diktiergerät-Status */}
          <div className="border-t border-gray-100 dark:border-zinc-700 mt-1 pt-1 px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <span>🎙️</span>
              <span className={hidConnected || hidSource === 'native-host' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                <span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${hidConnected || hidSource === 'native-host' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                Diktiergerät {hidConnected || hidSource === 'native-host' ? 'verbunden' : 'nicht verbunden'}
              </span>
            </div>
            {hidDeviceName && (
              <div className="text-xs text-gray-400 dark:text-gray-500 truncate pl-6 mt-0.5">
                {hidDeviceName}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
