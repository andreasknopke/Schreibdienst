// DB-Token Utility für dynamische Datenbankverbindungen
// Ermöglicht Multi-Tenant-Architekturen basierend auf verschlüsselten Tokens
// 
// WICHTIG: Tokens werden jetzt mit AES-256-GCM verschlüsselt (wie in CuraFlow)
// Legacy Base64-Tokens werden noch unterstützt, aber neue Tokens sind verschlüsselt

export interface DbCredentials {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
  ssl?: boolean;
}

// Info-Objekt für verschlüsselte Tokens (ohne Passwort)
export interface DbTokenInfo {
  host: string;
  database: string;
  user: string;
  port: number;
  ssl: boolean;
  isEncrypted: boolean;
  isLegacy: boolean;
}

const DB_TOKEN_KEY = 'schreibdienst_db_token';
const DB_TOKEN_INFO_KEY = 'schreibdienst_db_token_info'; // Speichert Info ohne Passwort
const IDB_NAME = 'SchreibdienstConfig';
const IDB_STORE = 'config';

// ============================================================
// IndexedDB Helper (für PWA-Persistenz)
// ============================================================

const openConfigDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
  });
};

const saveToIndexedDB = async (key: string, value: string): Promise<void> => {
  try {
    const db = await openConfigDb();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    store.put(value, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[dbToken] IndexedDB save failed:', e);
  }
};

const loadFromIndexedDB = async (key: string): Promise<string | null> => {
  try {
    const db = await openConfigDb();
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const request = store.get(key);
    const result = await new Promise<string | null>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
  } catch (e) {
    console.warn('[dbToken] IndexedDB load failed:', e);
    return null;
  }
};

const deleteFromIndexedDB = async (key: string): Promise<void> => {
  try {
    const db = await openConfigDb();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    store.delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[dbToken] IndexedDB delete failed:', e);
  }
};

// ============================================================
// Token Encoding/Decoding (Frontend - Browser)
// ============================================================

/**
 * Prüft ob ein Token ein Legacy-Token (unverschlüsselt, Base64) ist
 */
export const isLegacyToken = (token: string): boolean => {
  try {
    const decoded = atob(token);
    const parsed = JSON.parse(decoded);
    return parsed && parsed.host && parsed.user && parsed.database;
  } catch {
    return false;
  }
};

/**
 * Dekodiert ein Legacy-Token (nur für unverschlüsselte Tokens)
 * Für verschlüsselte Tokens wird null zurückgegeben - diese können nur serverseitig dekodiert werden
 */
export const decodeDbToken = (token: string): DbCredentials | null => {
  try {
    // Nur Legacy-Tokens können im Frontend dekodiert werden
    if (!isLegacyToken(token)) {
      console.log('[dbToken] Verschlüsseltes Token - kann nur serverseitig dekodiert werden');
      return null;
    }
    
    const decoded = atob(token);
    const parsed = JSON.parse(decoded);
    
    if (!parsed.host || !parsed.user || !parsed.password || !parsed.database) {
      console.error('[dbToken] Token ungültig: Fehlende Felder');
      return null;
    }
    
    return {
      host: parsed.host,
      user: parsed.user,
      password: parsed.password,
      database: parsed.database,
      port: parsed.port || 3306,
      ssl: parsed.ssl !== false
    };
  } catch (e) {
    console.error('[dbToken] Token Dekodierung fehlgeschlagen:', e);
    return null;
  }
};

/**
 * DEPRECATED: Erstellt ein Legacy-Token (unverschlüsselt)
 * Verwende stattdessen generateEncryptedToken() für neue Tokens
 */
export const encodeDbToken = (credentials: DbCredentials): string => {
  console.warn('[dbToken] ⚠️ encodeDbToken ist deprecated - verwende generateEncryptedToken() für verschlüsselte Tokens');
  const json = JSON.stringify({
    host: credentials.host,
    user: credentials.user,
    password: credentials.password,
    database: credentials.database,
    port: credentials.port || 3306,
    ssl: credentials.ssl !== false
  });
  return btoa(json);
};

// ============================================================
// Token Storage (localStorage + IndexedDB)
// ============================================================

/**
 * Speichert ein Token (verschlüsselt oder Legacy) zusammen mit Info
 */
export const saveDbToken = (token: string, info?: DbTokenInfo): boolean => {
  // Bei Legacy-Tokens: versuche Credentials zu extrahieren
  if (isLegacyToken(token)) {
    const credentials = decodeDbToken(token);
    if (!credentials) {
      return false;
    }
    localStorage.setItem(DB_TOKEN_KEY, token);
    saveToIndexedDB(DB_TOKEN_KEY, token);
    // Info speichern (ohne Passwort)
    const tokenInfo: DbTokenInfo = {
      host: credentials.host,
      database: credentials.database,
      user: credentials.user,
      port: credentials.port,
      ssl: credentials.ssl || false,
      isEncrypted: false,
      isLegacy: true
    };
    localStorage.setItem(DB_TOKEN_INFO_KEY, JSON.stringify(tokenInfo));
    saveToIndexedDB(DB_TOKEN_INFO_KEY, JSON.stringify(tokenInfo));
    console.log('[dbToken] Legacy-Token gespeichert für:', credentials.host);
    return true;
  }
  
  // Verschlüsseltes Token - benötigt Info-Objekt
  if (!info) {
    console.error('[dbToken] Verschlüsseltes Token benötigt info-Objekt');
    return false;
  }
  
  localStorage.setItem(DB_TOKEN_KEY, token);
  saveToIndexedDB(DB_TOKEN_KEY, token);
  localStorage.setItem(DB_TOKEN_INFO_KEY, JSON.stringify(info));
  saveToIndexedDB(DB_TOKEN_INFO_KEY, JSON.stringify(info));
  console.log('[dbToken] Verschlüsseltes Token gespeichert für:', info.host);
  return true;
};

export const getDbToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(DB_TOKEN_KEY);
};

export const syncDbTokenFromIndexedDB = async (): Promise<string | null> => {
  if (typeof window === 'undefined') return null;
  
  const localToken = localStorage.getItem(DB_TOKEN_KEY);
  const idbToken = await loadFromIndexedDB(DB_TOKEN_KEY);
  
  console.log('[dbToken] Sync - localStorage:', !!localToken, 'IndexedDB:', !!idbToken);
  
  if (idbToken && !localToken) {
    localStorage.setItem(DB_TOKEN_KEY, idbToken);
    console.log('[dbToken] Token aus IndexedDB übertragen');
    return idbToken;
  }
  
  if (localToken && !idbToken) {
    await saveToIndexedDB(DB_TOKEN_KEY, localToken);
  }
  
  return localToken || idbToken;
};

export const clearDbToken = (): void => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DB_TOKEN_KEY);
  localStorage.removeItem(DB_TOKEN_INFO_KEY);
  deleteFromIndexedDB(DB_TOKEN_KEY);
  deleteFromIndexedDB(DB_TOKEN_INFO_KEY);
  console.log('[dbToken] Token gelöscht');
};

/**
 * Prüft ob ein gültiges Token vorhanden ist
 * Funktioniert für verschlüsselte und Legacy-Tokens
 */
export const hasValidDbToken = (): boolean => {
  const token = getDbToken();
  if (!token) return false;
  
  // Bei Legacy-Tokens: dekodieren
  if (isLegacyToken(token)) {
    return decodeDbToken(token) !== null;
  }
  
  // Bei verschlüsselten Tokens: prüfe ob Info vorhanden
  const infoStr = localStorage.getItem(DB_TOKEN_INFO_KEY);
  return !!infoStr;
};

/**
 * Gibt Token-Info zurück (ohne Passwort)
 * Funktioniert für verschlüsselte und Legacy-Tokens
 */
export const getDbTokenInfo = (): DbTokenInfo | null => {
  if (typeof window === 'undefined') return null;
  
  const token = getDbToken();
  if (!token) return null;
  
  // Versuche gespeicherte Info zu laden
  const infoStr = localStorage.getItem(DB_TOKEN_INFO_KEY);
  if (infoStr) {
    try {
      return JSON.parse(infoStr);
    } catch {
      // Info ungültig
    }
  }
  
  // Fallback für Legacy-Tokens ohne gespeicherte Info
  if (isLegacyToken(token)) {
    const credentials = decodeDbToken(token);
    if (credentials) {
      return {
        host: credentials.host,
        database: credentials.database,
        user: credentials.user,
        port: credentials.port,
        ssl: credentials.ssl || false,
        isEncrypted: false,
        isLegacy: true
      };
    }
  }
  
  return null;
};

// ============================================================
// URL Parameter Extraction
// ============================================================

export const extractAndSaveDbTokenFromUrl = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('db_token');
  
  if (token) {
    const success = saveDbToken(token);
    if (success) {
      // Token aus URL entfernen (Security)
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('db_token');
      window.history.replaceState({}, document.title, newUrl.pathname + newUrl.search);
      console.log('[dbToken] Token aus URL extrahiert');
    }
    return success;
  }
  
  return false;
};

export const getCurrentDbCredentials = (): DbCredentials | null => {
  const token = getDbToken();
  if (!token) return null;
  // Nur für Legacy-Tokens möglich
  if (isLegacyToken(token)) {
    return decodeDbToken(token);
  }
  // Für verschlüsselte Tokens: keine Credentials im Frontend verfügbar
  return null;
};

// ============================================================
// Verschlüsselte Token-Generierung über API
// ============================================================

export interface GenerateTokenResult {
  success: boolean;
  token?: string;
  info?: DbTokenInfo;
  error?: string;
}

/**
 * Generiert ein verschlüsseltes DB-Token über die Server-API
 * Erfordert Root-Authentifizierung
 */
export const generateEncryptedToken = async (
  credentials: DbCredentials,
  authUsername: string,
  authPassword: string
): Promise<GenerateTokenResult> => {
  try {
    const response = await fetch('/api/db-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(`${authUsername}:${authPassword}`)
      },
      body: JSON.stringify({
        host: credentials.host,
        user: credentials.user,
        password: credentials.password,
        database: credentials.database,
        port: credentials.port || 3306,
        ssl: credentials.ssl !== false
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Token-Generierung fehlgeschlagen'
      };
    }

    const info: DbTokenInfo = {
      host: data.info.host,
      database: data.info.database,
      user: data.info.user,
      port: data.info.port,
      ssl: data.info.ssl,
      isEncrypted: true,
      isLegacy: false
    };

    return {
      success: true,
      token: data.token,
      info
    };
  } catch (error) {
    console.error('[dbToken] API-Aufruf fehlgeschlagen:', error);
    return {
      success: false,
      error: 'Netzwerkfehler bei Token-Generierung'
    };
  }
};

/**
 * Prüft ob Verschlüsselung auf dem Server verfügbar ist
 */
export const checkEncryptionAvailable = async (): Promise<boolean> => {
  try {
    const response = await fetch('/api/db-token');
    const data = await response.json();
    return data.encryptionEnabled === true;
  } catch {
    return false;
  }
};
