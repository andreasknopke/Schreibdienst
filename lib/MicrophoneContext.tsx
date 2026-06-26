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
  /** deviceId des favorisierten Mikrofons (null = kein Favorit) */
  favoriteDeviceId: string | null;
  /** Favorit setzen / entfernen */
  setFavoriteDeviceId: (deviceId: string | null) => void;
}

const MicrophoneContext = createContext<MicrophoneContextValue>({
  deviceId: null,
  deviceLabel: 'Standard-Mikrofon',
  available: [],
  selectDevice: () => {},
  refreshDevices: async () => {},
  getStream: async () => { throw new Error('Not initialized'); },
  favoriteDeviceId: null,
  setFavoriteDeviceId: () => {},
});

export function MicrophoneProvider({ children }: { children: React.ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState('Standard-Mikrofon');
  const [available, setAvailable] = useState<MediaDeviceInfo[]>([]);
  const [favoriteDeviceId, setFavoriteDeviceIdState] = useState<string | null>(null);
  const hasRequestedPermission = useRef(false);
  const deviceIdRef = useRef<string | null>(null);
  const favoriteDeviceIdRef = useRef<string | null>(null);

  // Refs immer aktuell halten für devicechange-Handler
  deviceIdRef.current = deviceId;
  favoriteDeviceIdRef.current = favoriteDeviceId;

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

  // Favorit setzen / entfernen
  const setFavoriteDeviceId = useCallback((newFavorite: string | null) => {
    setFavoriteDeviceIdState(newFavorite);
    try {
      if (newFavorite) {
        localStorage.setItem('schreibdienst:micFavoriteDeviceId', newFavorite);
      } else {
        localStorage.removeItem('schreibdienst:micFavoriteDeviceId');
      }
    } catch { /* ignore */ }
  }, []);

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
      // Gespeicherte Einstellungen laden
      let savedDeviceId: string | null = null;
      let savedFavoriteId: string | null = null;
      try {
        savedDeviceId = localStorage.getItem('schreibdienst:micDeviceId');
        savedFavoriteId = localStorage.getItem('schreibdienst:micFavoriteDeviceId');
      } catch { /* ignore */ }

      await refreshDevices();

      // Zuerst: Favorit setzen (damit der devicechange-Handler später
      // darauf reagieren kann, auch wenn das Gerät noch nicht da ist)
      if (savedFavoriteId) {
        setFavoriteDeviceIdState(savedFavoriteId);
      }

      // Dann: Auswahl aus gespeicherter Einstellung
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
    const handleDeviceChange = () => {
      refreshDevices().then(() => {
        // Wenn Favorit gesetzt ist und jetzt verfügbar ist, automatisch umschalten
        const favId = favoriteDeviceIdRef.current;
        if (favId) {
          navigator.mediaDevices.enumerateDevices().then(devices => {
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            const favoriteAvailable = audioInputs.some(d => d.deviceId === favId);
            if (favoriteAvailable) {
              setDeviceId(favId);
              const dev = audioInputs.find(d => d.deviceId === favId);
              setDeviceLabel(dev?.label || 'Favorit');
            } else if (deviceIdRef.current === favId) {
              // Favorit wurde abgesteckt → zurück auf Standard
              setDeviceId(null);
              setDeviceLabel('Standard-Mikrofon');
            }
          });
        }
      });
    };
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
      favoriteDeviceId,
      setFavoriteDeviceId,
    }}>
      {children}
    </MicrophoneContext.Provider>
  );
}

export function useMicrophone(): MicrophoneContextValue {
  return useContext(MicrophoneContext);
}
