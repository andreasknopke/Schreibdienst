"use client";
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { 
  syncDbTokenFromIndexedDB, 
  extractAndSaveDbTokenFromUrl, 
  getDbToken, 
  hasValidDbToken,
  getCurrentDbCredentials,
  type DbCredentials 
} from '@/lib/dbToken';

interface AuthContextType {
  isLoggedIn: boolean;
  username: string | null;
  isAdmin: boolean;
  canViewAllDictations: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  getAuthHeader: () => string;
  getDbTokenHeader: () => Record<string, string>;
  dbCredentials: DbCredentials | null;
  hasDbToken: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const AUTH_STORAGE_KEY = "schreibdienst_auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canViewAllDictations, setCanViewAllDictations] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dbTokenReady, setDbTokenReady] = useState(false);

  // DB-Token Synchronisierung beim App-Start
  useEffect(() => {
    const initDbToken = async () => {
      try {
        // Erst aus IndexedDB synchronisieren (für PWA)
        await syncDbTokenFromIndexedDB();
        // Dann aus URL extrahieren (falls vorhanden)
        extractAndSaveDbTokenFromUrl();
      } catch (e) {
        console.warn('[Auth] DB Token init error:', e);
      }
      setDbTokenReady(true);
    };
    initDbToken();
  }, []);

  // Beim Laden: Prüfe ob bereits eingeloggt
  useEffect(() => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.username) {
          setUsername(data.username);
          setIsAdmin(data.isAdmin || false);
          setCanViewAllDictations(data.canViewAllDictations || data.isAdmin || false);
          setPassword(data.password || null);
          setIsLoggedIn(true);
        }
      } catch {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  // Hilfsfunktion um DB-Token Header zu erstellen
  const getDbTokenHeader = (): Record<string, string> => {
    const token = getDbToken();
    if (token) {
      return { 'X-DB-Token': token };
    }
    return {};
  };

  const login = async (user: string, pass: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getDbTokenHeader()
        },
        body: JSON.stringify({ username: user, password: pass }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setUsername(data.username);
        setIsAdmin(data.isAdmin || false);
        setCanViewAllDictations(data.canViewAllDictations || data.isAdmin || false);
        setPassword(pass);
        setIsLoggedIn(true);
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ 
          username: data.username, 
          isAdmin: data.isAdmin || false,
          canViewAllDictations: data.canViewAllDictations || data.isAdmin || false,
          password: pass
        }));
        return { success: true };
      }
      
      return { success: false, error: data.error || "Anmeldung fehlgeschlagen" };
    } catch {
      return { success: false, error: "Verbindungsfehler" };
    }
  };

  const logout = () => {
    setUsername(null);
    setIsAdmin(false);
    setCanViewAllDictations(false);
    setPassword(null);
    setIsLoggedIn(false);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  };

  const getAuthHeader = (): string => {
    if (username && password) {
      return 'Basic ' + btoa(`${username}:${password}`);
    }
    return '';
  };

  if (isLoading || !dbTokenReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ 
      isLoggedIn, 
      username, 
      isAdmin, 
      canViewAllDictations, 
      login, 
      logout, 
      getAuthHeader,
      getDbTokenHeader,
      dbCredentials: getCurrentDbCredentials(),
      hasDbToken: hasValidDbToken()
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
