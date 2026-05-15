"use client";
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './AuthProvider';
import UserManagement from './UserManagement';
import DictionaryManager from './DictionaryManager';
import TemplatesManager from './TemplatesManager';
import ConfigPanel from './ConfigPanel';
import HelpPanel from './HelpPanel';
import StandardDictionaryManager from './StandardDictionaryManager';
import GroupDictionaryManager from './GroupDictionaryManager';
import BugReportForm from './BugReportForm';
import {
  connectGrundigSonicMic,
  getHidMediaControlStatus,
  HID_MEDIA_CONTROL_STATUS_EVENT,
  type HidMediaControlStatusDetail,
} from '@/lib/hidMediaControls';

export default function UserMenu() {
  const { isLoggedIn, username, isAdmin, logout } = useAuth();
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [showDictionary, setShowDictionary] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showStandardDict, setShowStandardDict] = useState(false);
  const [showGroupDict, setShowGroupDict] = useState(false);
  const [showBugReport, setShowBugReport] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hidSupported, setHidSupported] = useState(false);
  const [hidConnected, setHidConnected] = useState(false);
  const [hidConnecting, setHidConnecting] = useState(false);
  const [dictionaryInitialWord, setDictionaryInitialWord] = useState('');

  // Nur im Browser rendern
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const applyStatus = (status: HidMediaControlStatusDetail) => {
      setHidSupported(status.supported);
      setHidConnected(status.connected);
    };

    applyStatus(getHidMediaControlStatus());

    const handleStatus = (event: Event) => {
      applyStatus((event as CustomEvent<HidMediaControlStatusDetail>).detail);
    };

    window.addEventListener(HID_MEDIA_CONTROL_STATUS_EVENT, handleStatus as EventListener);
    return () => window.removeEventListener(HID_MEDIA_CONTROL_STATUS_EVENT, handleStatus as EventListener);
  }, []);

  const handleConnectSonicMic = useCallback(async () => {
    setHidConnecting(true);
    try {
      const connectedCount = await connectGrundigSonicMic();
      if (connectedCount === 0) {
        window.alert('Kein Grundig SonicMic II ausgewählt.');
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'SonicMic konnte nicht verbunden werden.');
    } finally {
      setHidConnecting(false);
    }
  }, []);

  // Öffnet das Wörterbuch und übernimmt selektierten Text
  const handleOpenDictionary = useCallback(() => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || '';
    setDictionaryInitialWord(selectedText);
    setShowDictionary(true);
  }, []);

  // Schließt das Wörterbuch und setzt den Initial-Word zurück
  const handleCloseDictionary = useCallback(() => {
    setShowDictionary(false);
    setDictionaryInitialWord('');
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
            onClick={handleCloseDictionary}
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
          <DictionaryManager initialWrong={dictionaryInitialWord} />
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  const templatesModal = showTemplates && mounted ? createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-2xl w-full my-8 flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
          <h2 className="font-semibold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            Meine Textbausteine
          </h2>
          <button
            onClick={() => setShowTemplates(false)}
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
          <TemplatesManager />
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

  const standardDictModal = showStandardDict && isAdmin && mounted ? createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full my-8 flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
          <h2 className="font-semibold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
              <path d="M12 13V7"/>
              <path d="M15 10l-3-3-3 3"/>
            </svg>
            Standard-Wörterbuch
          </h2>
          <button
            onClick={() => setShowStandardDict(false)}
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
          <StandardDictionaryManager />
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  const groupDictModal = showGroupDict && isAdmin && mounted ? createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-5xl w-full my-8 flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
          <h2 className="font-semibold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Gruppen-Wörterbücher
          </h2>
          <button
            onClick={() => setShowGroupDict(false)}
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
          <GroupDictionaryManager />
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
      <div className="flex items-center gap-1 sm:gap-2">
        <span className="text-xs text-gray-500 hidden sm:inline">
          {username}
          {isAdmin && <span className="ml-1 text-blue-600">(Admin)</span>}
        </span>
        {mounted && hidSupported && !hidConnected && (
          <button
            onClick={handleConnectSonicMic}
            className="text-xs text-blue-600 hover:text-blue-700 px-1.5 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
            title="Grundig SonicMic II einmalig freigeben"
            disabled={hidConnecting}
          >
            {hidConnecting ? '...' : '🎙️'}
          </button>
        )}
        <button
          onClick={() => setShowBugReport(true)}
          className="text-xs text-red-600 hover:text-red-700 px-1.5 sm:px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
          title="Bug oder Feature melden"
        >
          🐞<span className="hidden sm:inline"> Melden</span>
        </button>
        <button
          onClick={handleOpenDictionary}
          className="text-xs text-green-600 hover:text-green-700 px-1.5 sm:px-2 py-1 rounded hover:bg-green-50 dark:hover:bg-green-900/20"
          title="Mein Wörterbuch (markierter Text wird übernommen)"
        >
          📖<span className="hidden sm:inline"> Wörterbuch</span>
        </button>
        <button
          onClick={() => setShowTemplates(true)}
          className="text-xs text-orange-600 hover:text-orange-700 px-1.5 sm:px-2 py-1 rounded hover:bg-orange-50 dark:hover:bg-orange-900/20"
          title="Meine Textbausteine verwalten"
        >
          📝<span className="hidden sm:inline"> Bausteine</span>
        </button>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="text-xs text-gray-600 hover:text-gray-700 px-1.5 sm:px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-900/20"
          title="Hilfe & Bedienung"
        >
          ❓
        </button>
        {/* Standard-Wörterbuch nur für Admins */}
        {isAdmin && (
          <button
            onClick={() => setShowStandardDict(!showStandardDict)}
            className="text-xs text-teal-600 hover:text-teal-700 px-1.5 sm:px-2 py-1 rounded hover:bg-teal-50 dark:hover:bg-teal-900/20"
            title="Standard-Wörterbuch verwalten (für alle Benutzer)"
          >
            📚<span className="hidden sm:inline"> Standard</span>
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setShowGroupDict(!showGroupDict)}
            className="text-xs text-cyan-600 hover:text-cyan-700 px-1.5 sm:px-2 py-1 rounded hover:bg-cyan-50 dark:hover:bg-cyan-900/20"
            title="Gruppen-Wörterbücher verwalten"
          >
            👥<span className="hidden sm:inline"> Gruppen</span>
          </button>
        )}
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
      {templatesModal}
      {configModal}
      {userManagementModal}
      {standardDictModal}
      {groupDictModal}
      {helpModal}
      <BugReportForm open={showBugReport} onClose={() => setShowBugReport(false)} />
    </>
  );
}
