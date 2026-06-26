'use client';
import { useState, useRef, useEffect } from 'react';
import { useMicrophone } from '@/lib/MicrophoneContext';

export default function MicrophoneSelector() {
  const { deviceId, deviceLabel, available, selectDevice } = useMicrophone();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-xs max-w-[180px]"
        title={`Mikrofon: ${deviceLabel}`}
      >
        {/* Mikrofon-Icon */}
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" x2="12" y1="19" y2="22"/>
        </svg>
        <span className="truncate">{deviceLabel}</span>
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
          <button
            onClick={() => { selectDevice(null); setOpen(false); }}
            className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-zinc-700 flex items-center gap-2 ${
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

          {hasDevices && <div className="border-t border-gray-100 dark:border-zinc-700 my-1" />}

          {/* Verfügbare Mikrofone */}
          {available.map(dev => (
            <button
              key={dev.deviceId}
              onClick={() => { selectDevice(dev.deviceId); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-zinc-700 flex items-center gap-2 ${
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
          ))}

          {/* Keine Labels = Permission fehlt */}
          {hasDevices && !available.some(d => d.label) && (
            <div className="px-3 py-2 text-xs text-amber-600 dark:text-amber-400 italic border-t border-gray-100 dark:border-zinc-700">
              Bitte Mikrofon-Zugriff erlauben, um Gerätenamen zu sehen.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
