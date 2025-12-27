"use client";
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './AuthProvider';
import UserManagement from './UserManagement';
import DictionaryManager from './DictionaryManager';
import ConfigPanel from './ConfigPanel';
import HelpPanel from './HelpPanel';

export default function UserMenu() {
  const { isLoggedIn, username, isAdmin, autoCorrect, setAutoCorrect, logout } = useAuth();
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [showDictionary, setShowDictionary] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [savingAutoCorrect, setSavingAutoCorrect] = useState(false);

  // Nur im Browser rendern
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isLoggedIn) return null;

  const dictionaryModal = showDictionary && mounted ? createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full my-8 flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
          <h2 className="font-semibold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
            </svg>
            Mein Wörterbuch
          </h2>
          <button
            onClick={() => setShowDictionary(false)}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            title="Schließen"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18"/>
              <path d="M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          <DictionaryManager />
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  const configModal = showConfig && username?.toLowerCase() === 'root' && mounted ? createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full my-8 flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
          <h2 className="font-semibold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            System-Einstellungen
          </h2>
          <button
            onClick={() => setShowConfig(false)}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            title="Schließen"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18"/>
              <path d="M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          <ConfigPanel />
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  const userManagementModal = showUserManagement && isAdmin && mounted ? createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full my-8 flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
          <h2 className="font-semibold">Benutzerverwaltung</h2>
          <button
            onClick={() => setShowUserManagement(false)}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            title="Schließen"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18"/>
              <path d="M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          <UserManagement />
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  const helpModal = showHelp && mounted ? createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full my-8 flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
          <h2 className="font-semibold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <path d="M12 17h.01"/>
            </svg>
            Hilfe & Bedienung
          </h2>
          <button
            onClick={() => setShowHelp(false)}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            title="Schließen"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18"/>
              <path d="M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          <HelpPanel />
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 hidden sm:inline">
          {username}
          {isAdmin && <span className="ml-1 text-blue-600">(Admin)</span>}
        </span>
        {/* Auto-Correct Toggle */}
        <button
          onClick={async () => {
            setSavingAutoCorrect(true);
            await setAutoCorrect(!autoCorrect);
            setSavingAutoCorrect(false);
          }}
          disabled={savingAutoCorrect}
          className={`text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors ${
            autoCorrect 
              ? 'text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20' 
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
          title={autoCorrect ? 'Auto-Korrektur aktiv (klicken zum Deaktivieren)' : 'Auto-Korrektur deaktiviert (klicken zum Aktivieren)'}
        >
          {savingAutoCorrect ? (
            <span className="animate-spin">⏳</span>
          ) : autoCorrect ? (
            <>🤖 Auto</>
          ) : (
            <>🤖 Manuell</>
          )}
        </button>
        <button
          onClick={() => setShowDictionary(!showDictionary)}
          className="text-xs text-green-600 hover:text-green-700 px-2 py-1 rounded hover:bg-green-50 dark:hover:bg-green-900/20"
          title="Mein Wörterbuch"
        >
          Wörterbuch
        </button>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="text-xs text-gray-600 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-900/20"
          title="Hilfe & Bedienung"
        >
          ❓
        </button>
        {/* Config only visible for root user */}
        {username?.toLowerCase() === 'root' && (
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="text-xs text-purple-600 hover:text-purple-700 px-2 py-1 rounded hover:bg-purple-50 dark:hover:bg-purple-900/20"
            title="System-Einstellungen (nur root)"
          >
            ⚙️
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setShowUserManagement(!showUserManagement)}
            className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
            title="Benutzerverwaltung"
          >
            Benutzer
          </button>
        )}
        <button
          onClick={logout}
          className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          title="Abmelden"
        >
          Abmelden
        </button>
      </div>

      {dictionaryModal}
      {configModal}
      {userManagementModal}
      {helpModal}
    </>
  );
}
