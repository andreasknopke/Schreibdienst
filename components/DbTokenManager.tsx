"use client";
import { useState } from 'react';
import { useAuth } from './AuthProvider';
import { 
  encodeDbToken, 
  saveDbToken, 
  clearDbToken, 
  hasValidDbToken,
  getCurrentDbCredentials,
  type DbCredentials 
} from '@/lib/dbToken';

export default function DbTokenManager() {
  const { hasDbToken, dbCredentials } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'view' | 'generate' | 'enter'>('view');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
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
  
  // Manual Token Entry
  const [manualToken, setManualToken] = useState('');

  const handleGenerateToken = () => {
    if (!credentials.host || !credentials.user || !credentials.password || !credentials.database) {
      setFeedback({ type: 'error', message: 'Alle Felder müssen ausgefüllt sein' });
      return;
    }
    const token = encodeDbToken(credentials);
    setGeneratedToken(token);
    setFeedback({ type: 'success', message: 'Token generiert!' });
  };

  const handleActivateGeneratedToken = () => {
    if (generatedToken) {
      const success = saveDbToken(generatedToken);
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
    const success = saveDbToken(manualToken.trim());
    if (success) {
      setFeedback({ type: 'success', message: 'Token aktiviert! Seite wird neu geladen...' });
      setTimeout(() => window.location.reload(), 1500);
    } else {
      setFeedback({ type: 'error', message: 'Ungültiges Token-Format' });
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

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
        title="Datenbank-Verbindung"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5" rx="9" ry="3"/>
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
        </svg>
        {hasDbToken && (
          <span className="w-2 h-2 bg-green-500 rounded-full" title="Dynamische DB aktiv"/>
        )}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setIsOpen(false)}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            </svg>
            Datenbank-Verbindung
          </h2>
          <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-gray-700">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Current Status */}
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700">
            <div className="text-sm font-medium mb-1">Aktueller Status:</div>
            {hasDbToken && dbCredentials ? (
              <div className="text-sm text-green-600 dark:text-green-400">
                <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-2"/>
                Verbunden mit: <span className="font-mono">{dbCredentials.host}/{dbCredentials.database}</span>
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
                : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
            }`}>
              {feedback.message}
            </div>
          )}

          {/* Mode Tabs */}
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
                className="w-full btn btn-primary"
              >
                Token generieren
              </button>

              {generatedToken && (
                <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
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
            <strong>Hinweis:</strong> Das DB-Token enthält Zugangsdaten. Verwenden Sie nur sichere HTTPS-Verbindungen und teilen Sie das Token nicht öffentlich.
          </div>
        </div>
      </div>
    </div>
  );
}
