"use client";
import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { 
  encodeDbToken, 
  saveDbToken, 
  clearDbToken, 
  hasValidDbToken,
  getDbTokenInfo,
  isLegacyToken,
  getDbToken,
  generateEncryptedToken,
  checkEncryptionAvailable,
  type DbCredentials,
  type DbTokenInfo
} from '@/lib/dbToken';

// Props für die Komponente - wird jetzt inline im ConfigPanel angezeigt
interface DbTokenManagerProps {
  isRoot?: boolean;
}

export default function DbTokenManager({ isRoot = false }: DbTokenManagerProps) {
  const { hasDbToken, username, password } = useAuth();
  const [tokenInfo, setTokenInfo] = useState<DbTokenInfo | null>(null);
  const [mode, setMode] = useState<'view' | 'generate' | 'enter'>('view');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [encryptionAvailable, setEncryptionAvailable] = useState(false);
  
  // Token Generator Form
  const [credentials, setCredentials] = useState<DbCredentials>({
    host: '',
    user: '',
    password: '',
    database: '',
    port: 3306,
    ssl: true
  });
  const [generatedToken, setGeneratedToken] = useState('');
  const [generatedTokenInfo, setGeneratedTokenInfo] = useState<DbTokenInfo | null>(null);
  
  // Manual Token Entry
  const [manualToken, setManualToken] = useState('');

  // Token-Info beim Laden abrufen
  useEffect(() => {
    const info = getDbTokenInfo();
    setTokenInfo(info);
    
    // Prüfe Legacy-Token und zeige Warnung
    const token = getDbToken();
    if (token && isLegacyToken(token)) {
      setFeedback({
        type: 'warning',
        message: '⚠️ Unverschlüsseltes Legacy-Token erkannt. Bitte neues verschlüsseltes Token generieren.'
      });
    }
    
    // Prüfe ob Verschlüsselung verfügbar
    checkEncryptionAvailable().then(setEncryptionAvailable);
  }, []);

  const handleGenerateToken = async () => {
    if (!credentials.host || !credentials.user || !credentials.password || !credentials.database) {
      setFeedback({ type: 'error', message: 'Alle Felder müssen ausgefüllt sein' });
      return;
    }
    
    if (!username || !password) {
      setFeedback({ type: 'error', message: 'Authentifizierung erforderlich' });
      return;
    }
    
    setIsLoading(true);
    setFeedback(null);
    
    try {
      // Versuche verschlüsseltes Token zu generieren
      const result = await generateEncryptedToken(credentials, username, password);
      
      if (result.success && result.token && result.info) {
        setGeneratedToken(result.token);
        setGeneratedTokenInfo(result.info);
        setFeedback({ type: 'success', message: '🔒 Verschlüsseltes Token generiert!' });
      } else {
        // Fallback auf Legacy-Token wenn Verschlüsselung nicht verfügbar
        if (!encryptionAvailable) {
          const token = encodeDbToken(credentials);
          setGeneratedToken(token);
          setGeneratedTokenInfo({
            host: credentials.host,
            database: credentials.database,
            user: credentials.user,
            port: credentials.port,
            ssl: credentials.ssl || false,
            isEncrypted: false,
            isLegacy: true
          });
          setFeedback({ 
            type: 'warning', 
            message: '⚠️ Legacy-Token generiert (Verschlüsselung nicht verfügbar)' 
          });
        } else {
          setFeedback({ type: 'error', message: result.error || 'Token-Generierung fehlgeschlagen' });
        }
      }
    } catch (error) {
      setFeedback({ type: 'error', message: 'Fehler bei Token-Generierung' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleActivateGeneratedToken = () => {
    if (generatedToken) {
      const success = saveDbToken(generatedToken, generatedTokenInfo || undefined);
      if (success) {
        setFeedback({ type: 'success', message: 'Token aktiviert! Seite wird neu geladen...' });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setFeedback({ type: 'error', message: 'Token konnte nicht aktiviert werden' });
      }
    }
  };

  const handleActivateManualToken = () => {
    if (!manualToken.trim()) {
      setFeedback({ type: 'error', message: 'Bitte Token eingeben' });
      return;
    }
    
    // Für verschlüsselte Tokens ohne Info: wir speichern trotzdem
    const token = manualToken.trim();
    const isLegacy = isLegacyToken(token);
    
    if (isLegacy) {
      const success = saveDbToken(token);
      if (success) {
        setFeedback({ type: 'success', message: 'Token aktiviert! Seite wird neu geladen...' });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setFeedback({ type: 'error', message: 'Ungültiges Token-Format' });
      }
    } else {
      // Verschlüsseltes Token - speichere ohne Info (wird serverseitig validiert)
      localStorage.setItem('schreibdienst_db_token', token);
      setFeedback({ type: 'success', message: 'Verschlüsseltes Token aktiviert! Seite wird neu geladen...' });
      setTimeout(() => window.location.reload(), 1500);
    }
  };

  const handleClearToken = () => {
    if (confirm('DB-Token wirklich löschen? Die App wird die Standard-Datenbank verwenden.')) {
      clearDbToken();
      setFeedback({ type: 'success', message: 'Token gelöscht! Seite wird neu geladen...' });
      setTimeout(() => window.location.reload(), 1500);
    }
  };

  const getTokenUrl = () => {
    if (!generatedToken) return '';
    return `${window.location.origin}/?db_token=${encodeURIComponent(generatedToken)}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setFeedback({ type: 'success', message: 'In Zwischenablage kopiert!' });
    setTimeout(() => setFeedback(null), 2000);
  };

  // Komponente wird jetzt inline angezeigt (im ConfigPanel), kein Modal mehr
  return (
    <div className="card">
      <div className="card-body space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3"/>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
          </svg>
          Datenbank-Verbindung
          {encryptionAvailable && (
            <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full">
              🔒 Verschlüsselt
            </span>
          )}
        </h3>

        <div className="p-4 space-y-4">
          {/* Current Status */}
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700">
            <div className="text-sm font-medium mb-1">Aktueller Status:</div>
            {hasDbToken && tokenInfo ? (
              <div className="space-y-1">
                <div className="text-sm text-green-600 dark:text-green-400">
                  <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-2"/>
                  Verbunden mit: <span className="font-mono">{tokenInfo.host}/{tokenInfo.database}</span>
                </div>
                <div className="text-xs text-gray-500">
                  {tokenInfo.isEncrypted ? '🔒 Verschlüsseltes Token' : '⚠️ Legacy-Token (unverschlüsselt)'}
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">
                <span className="inline-block w-2 h-2 bg-gray-400 rounded-full mr-2"/>
                Standard-Datenbank (Server-Konfiguration)
              </div>
            )}
          </div>

          {/* Feedback */}
          {feedback && (
            <div className={`text-sm p-3 rounded-lg ${
              feedback.type === 'success' 
                ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' 
                : feedback.type === 'warning'
                ? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400'
                : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
            }`}>
              {feedback.message}
            </div>
          )}

          {/* Mode Tabs - Token generieren nur für root */}
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setMode('view')}
              className={`flex-1 py-1.5 px-3 text-sm font-medium rounded-md transition-all ${
                mode === 'view'
                  ? 'bg-white dark:bg-gray-600 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              Status
            </button>
            <button
              onClick={() => setMode('enter')}
              className={`flex-1 py-1.5 px-3 text-sm font-medium rounded-md transition-all ${
                mode === 'enter'
                  ? 'bg-white dark:bg-gray-600 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              Token eingeben
            </button>
            {isRoot && (
              <button
                onClick={() => setMode('generate')}
                className={`flex-1 py-1.5 px-3 text-sm font-medium rounded-md transition-all ${
                  mode === 'generate'
                    ? 'bg-white dark:bg-gray-600 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                Token generieren
              </button>
            )}
          </div>

          {/* View Mode */}
          {mode === 'view' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Mit einem DB-Token können Sie eine andere Datenbank verwenden als die Server-Standard-Konfiguration.
                Das Token kann per URL-Parameter oder manuell eingegeben werden.
              </p>
              {hasDbToken && (
                <button
                  onClick={handleClearToken}
                  className="w-full btn bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                >
                  Token löschen (zur Standard-DB wechseln)
                </button>
              )}
            </div>
          )}

          {/* Enter Token Mode */}
          {mode === 'enter' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">DB-Token:</label>
                <textarea
                  value={manualToken}
                  onChange={e => setManualToken(e.target.value)}
                  placeholder="eyJo... (Base64-kodiertes Token)"
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 font-mono text-xs"
                  rows={3}
                />
              </div>
              <button
                onClick={handleActivateManualToken}
                className="w-full btn btn-primary"
              >
                Token aktivieren
              </button>
            </div>
          )}

          {/* Generate Token Mode */}
          {mode === 'generate' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Host:</label>
                  <input
                    type="text"
                    value={credentials.host}
                    onChange={e => setCredentials({...credentials, host: e.target.value})}
                    placeholder="db.example.com"
                    className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Benutzer:</label>
                  <input
                    type="text"
                    value={credentials.user}
                    onChange={e => setCredentials({...credentials, user: e.target.value})}
                    placeholder="db_user"
                    className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Passwort:</label>
                  <input
                    type="password"
                    value={credentials.password}
                    onChange={e => setCredentials({...credentials, password: e.target.value})}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Datenbank:</label>
                  <input
                    type="text"
                    value={credentials.database}
                    onChange={e => setCredentials({...credentials, database: e.target.value})}
                    placeholder="my_database"
                    className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Port:</label>
                  <input
                    type="number"
                    value={credentials.port}
                    onChange={e => setCredentials({...credentials, port: parseInt(e.target.value) || 3306})}
                    placeholder="3306"
                    className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
                <div className="col-span-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={credentials.ssl}
                      onChange={e => setCredentials({...credentials, ssl: e.target.checked})}
                      className="rounded"
                    />
                    SSL-Verbindung verwenden
                  </label>
                </div>
              </div>
              
              <button
                onClick={handleGenerateToken}
                disabled={isLoading}
                className="w-full btn btn-primary disabled:opacity-50"
              >
                {isLoading ? 'Generiere...' : '🔒 Verschlüsseltes Token generieren'}
              </button>

              {generatedToken && (
                <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="flex items-center gap-2 text-sm">
                    {generatedTokenInfo?.isEncrypted ? (
                      <span className="text-green-600 dark:text-green-400">🔒 Verschlüsselt</span>
                    ) : (
                      <span className="text-yellow-600 dark:text-yellow-400">⚠️ Legacy (unverschlüsselt)</span>
                    )}
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-sm font-medium">Generiertes Token:</label>
                      <button
                        onClick={() => copyToClipboard(generatedToken)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Kopieren
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={generatedToken}
                      className="w-full px-2 py-1 border rounded text-xs font-mono bg-white dark:bg-gray-800 dark:border-gray-600"
                      rows={2}
                    />
                  </div>
                  
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-sm font-medium">URL mit Token:</label>
                      <button
                        onClick={() => copyToClipboard(getTokenUrl())}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Kopieren
                      </button>
                    </div>
                    <input
                      type="text"
                      readOnly
                      value={getTokenUrl()}
                      className="w-full px-2 py-1 border rounded text-xs font-mono bg-white dark:bg-gray-800 dark:border-gray-600"
                    />
                  </div>
                  
                  <button
                    onClick={handleActivateGeneratedToken}
                    className="w-full btn bg-green-600 text-white hover:bg-green-700"
                  >
                    Token jetzt aktivieren
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Security Hint */}
          <div className="text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 pt-3 mt-3">
            <strong>Sicherheit:</strong> {encryptionAvailable 
              ? 'Tokens werden mit AES-256-GCM verschlüsselt. Passwörter sind nie im Klartext sichtbar.'
              : 'JWT_SECRET nicht konfiguriert - Tokens werden unverschlüsselt gespeichert. Bitte JWT_SECRET setzen!'
            }
          </div>
        </div>
      </div>
    </div>
  );
}
