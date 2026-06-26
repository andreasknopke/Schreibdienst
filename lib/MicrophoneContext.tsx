'use client';
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

interface MicrophoneContextValue {
  /** Aktuelle deviceId (null = System-Standard) */
  deviceId: string | null;
  /** Anzeigename des aktuellen Mikrofons */
  deviceLabel: string;
  /** Liste aller verfügbaren Audio-Eingabegeräte */
  available: MediaDeviceInfo[];
  /** Mikrofon auswählen (null = Standard) */
  selectDevice: (deviceId: string | null) => void;
  /** Geräteliste neu einlesen */
  refreshDevices: () => Promise<void>;
  /**
   * Erzeugt einen MediaStream mit dem ausgewählten Mikrofon.
   * Optional können zusätzliche Audio-Constraints (z.B. sampleRate) übergeben werden.
   */
  getStream: (extraConstraints?: MediaTrackConstraints) => Promise<MediaStream>;
}

const MicrophoneContext = createContext<MicrophoneContextValue>({
  deviceId: null,
  deviceLabel: 'Standard-Mikrofon',
  available: [],
  selectDevice: () => {},
  refreshDevices: async () => {},
  getStream: async () => { throw new Error('Not initialized'); },
});

export function MicrophoneProvider({ children }: { children: React.ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState('Standard-Mikrofon');
  const [available, setAvailable] = useState<MediaDeviceInfo[]>([]);
  const hasRequestedPermission = useRef(false);

  // Geräteliste neu einlesen
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAvailable(devices.filter(d => d.kind === 'audioinput'));
    } catch (err) {
      console.warn('[MicrophoneContext] enumerateDevices fehlgeschlagen:', err);
    }
  }, []);

  // Einmalig eine Mikrofon-Permission anfordern, damit Geräte-Labels sichtbar werden
  const ensurePermission = useCallback(async () => {
    if (hasRequestedPermission.current) return;
    hasRequestedPermission.current = true;
    try {
      const temp = await navigator.mediaDevices.getUserMedia({ audio: true });
      temp.getTracks().forEach(t => t.stop());
      await refreshDevices();
    } catch {
      // Permission verweigert – Labels bleiben leer, das ist okay
    }
  }, [refreshDevices]);

  // Mikrofon auswählen
  const selectDevice = useCallback((newDeviceId: string | null) => {
    setDeviceId(newDeviceId);

    // Anzeigename ermitteln
    if (newDeviceId) {
      const dev = available.find(d => d.deviceId === newDeviceId);
      setDeviceLabel(dev?.label || 'Unbekanntes Mikrofon');
    } else {
      setDeviceLabel('Standard-Mikrofon');
    }

    // Auswahl merken
    try {
      if (newDeviceId) {
        localStorage.setItem('schreibdienst:micDeviceId', newDeviceId);
      } else {
        localStorage.removeItem('schreibdienst:micDeviceId');
      }
    } catch { /* ignore */ }
  }, [available]);

  // Stream mit dem ausgewählten Gerät erzeugen
  const getStream = useCallback(async (extraConstraints?: MediaTrackConstraints): Promise<MediaStream> => {
    const constraints: MediaTrackConstraints = {
      ...(extraConstraints || {}),
    };
    if (deviceId) {
      constraints.deviceId = { exact: deviceId };
    }
    return navigator.mediaDevices.getUserMedia({ audio: constraints });
  }, [deviceId]);

  // Initialisierung
  useEffect(() => {
    const init = async () => {
      // Gespeicherte Einstellung laden
      let savedDeviceId: string | null = null;
      try {
        savedDeviceId = localStorage.getItem('schreibdienst:micDeviceId');
      } catch { /* ignore */ }

      await refreshDevices();

      // Prüfen ob das gespeicherte Gerät noch existiert
      if (savedDeviceId) {
        const stillExists = available.some(d => d.deviceId === savedDeviceId);
        if (stillExists) {
          setDeviceId(savedDeviceId);
          const dev = available.find(d => d.deviceId === savedDeviceId);
          if (dev?.label) setDeviceLabel(dev.label);
        }
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auf devicechange-Events horchen (z.B. USB-Mikrofon ein-/ausstecken)
  useEffect(() => {
    const handleDeviceChange = () => { refreshDevices(); };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, [refreshDevices]);

  // Einmalig Permission anfordern (nach 1,5s Verzögerung, damit UI schon da ist)
  useEffect(() => {
    const timer = setTimeout(() => { ensurePermission(); }, 1500);
    return () => clearTimeout(timer);
  }, [ensurePermission]);

  return (
    <MicrophoneContext.Provider value={{
      deviceId,
      deviceLabel,
      available,
      selectDevice,
      refreshDevices,
      getStream,
    }}>
      {children}
    </MicrophoneContext.Provider>
  );
}

export function useMicrophone(): MicrophoneContextValue {
  return useContext(MicrophoneContext);
}
