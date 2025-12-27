// DB-Token Utility für dynamische Datenbankverbindungen
// Ermöglicht Multi-Tenant-Architekturen basierend auf Base64-kodierten Tokens

export interface DbCredentials {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
  ssl?: boolean;
}

const DB_TOKEN_KEY = 'schreibdienst_db_token';
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

export const decodeDbToken = (token: string): DbCredentials | null => {
  try {
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

export const encodeDbToken = (credentials: DbCredentials): string => {
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

export const saveDbToken = (token: string): boolean => {
  const credentials = decodeDbToken(token);
  if (!credentials) {
    return false;
  }
  localStorage.setItem(DB_TOKEN_KEY, token);
  saveToIndexedDB(DB_TOKEN_KEY, token);
  console.log('[dbToken] Token gespeichert für:', credentials.host);
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
  deleteFromIndexedDB(DB_TOKEN_KEY);
  console.log('[dbToken] Token gelöscht');
};

export const hasValidDbToken = (): boolean => {
  const token = getDbToken();
  if (!token) return false;
  return decodeDbToken(token) !== null;
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
  return decodeDbToken(token);
};
