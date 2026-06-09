"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './AuthProvider';
import UserManagement from './UserManagement';
import DictionaryManager from './DictionaryManager';
import TemplatesManager from './TemplatesManager';
import ConfigPanel from './ConfigPanel';
import StandardDictionaryManager from './StandardDictionaryManager';
import GroupDictionaryManager from './GroupDictionaryManager';
import BugReportForm from './BugReportForm';
import {
  connectDictationMicrophone,
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
  const [showStandardDict, setShowStandardDict] = useState(false);
  const [showGroupDict, setShowGroupDict] = useState(false);
  const [showBugReport, setShowBugReport] = useState(false);
  const [showDictionaryMenu, setShowDictionaryMenu] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hidSupported, setHidSupported] = useState(false);
  const [hidConnected, setHidConnected] = useState(false);
  const [hidDeviceName, setHidDeviceName] = useState<string | null>(null);
  const [hidConnecting, setHidConnecting] = useState(false);
  const [showHidConnectPrompt, setShowHidConnectPrompt] = useState(false);
  const [hidPromptDismissed, setHidPromptDismissed] = useState(false);
  const [dictionaryInitialWord, setDictionaryInitialWord] = useState('');
  const dictionaryMenuRef = useRef<HTMLDivElement | null>(null);

  // Nur im Browser rendern
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const applyStatus = (status: HidMediaControlStatusDetail) => {
      setHidSupported(status.supported);
      setHidConnected(status.connected);
      setHidDeviceName(status.deviceName ?? null);
    };

    applyStatus(getHidMediaControlStatus());

    const handleStatus = (event: Event) => {
      applyStatus((event as CustomEvent<HidMediaControlStatusDetail>).detail);
    };

    window.addEventListener(HID_MEDIA_CONTROL_STATUS_EVENT, handleStatus as EventListener);
    return () => window.removeEventListener(HID_MEDIA_CONTROL_STATUS_EVENT, handleStatus as EventListener);
  }, []);

  useEffect(() => {
    if (!mounted || !hidSupported || hidConnected || hidPromptDismissed) {
      return;
    }

    setShowHidConnectPrompt(true);
  }, [mounted, hidSupported, hidConnected, hidPromptDismissed]);

  useEffect(() => {
    if (hidConnected) {
      setShowHidConnectPrompt(false);
    }
  }, [hidConnected]);

  useEffect(() => {
    if (!showDictionaryMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!dictionaryMenuRef.current?.contains(event.target as Node)) {
        setShowDictionaryMenu(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowDictionaryMenu(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showDictionaryMenu]);

  const handleConnectDictationMic = useCallback(async () => {
    setHidConnecting(true);
    try {
      const connectedCount = await connectDictationMicrophone();
      if (connectedCount === 0) {
        window.alert('Kein unterstütztes Diktiermikrofon ausgewählt.');
      } else {
        setShowHidConnectPrompt(false);
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Diktiermikrofon konnte nicht verbunden werden.');
    } finally {
      setHidConnecting(false);
    }
  }, []);

  // Öffnet das Wörterbuch und übernimmt selektierten Text
  const handleOpenDictionary = useCallback(() => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || '';
    setDictionaryInitialWord(selectedText);
    setShowDictionaryMenu(false);
    setShowDictionary(true);
  }, []);

  // Schließt das Wörterbuch und setzt den Initial-Word zurück
  const handleCloseDictionary = useCallback(() => {
    setShowDictionary(false);
    setDictionaryInitialWord('');
  }, []);

  const dictionaryMenuItemClass = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-gray-100 dark:hover:bg-gray-800';

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

  const hidConnectPrompt = showHidConnectPrompt && mounted ? createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-md w-full my-8 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 className="font-semibold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
              <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
              <line x1="12" y1="18" x2="12" y2="22"/>
              <line x1="8" y1="22" x2="16" y2="22"/>
            </svg>
            Diktiermikrofon verbinden
          </h2>
          <button
            onClick={() => {
              setShowHidConnectPrompt(false);
              setHidPromptDismissed(true);
            }}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            title="Später schließen"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18"/>
              <path d="M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Jetzt mit Mikro verbinden.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => {
                setShowHidConnectPrompt(false);
                setHidPromptDismissed(true);
              }}
              className="btn btn-outline text-sm py-1.5 px-3"
              disabled={hidConnecting}
            >
              Später
            </button>
            <button
              onClick={() => void handleConnectDictationMic()}
              className="btn btn-primary text-sm py-1.5 px-3"
              disabled={hidConnecting}
            >
              {hidConnecting ? 'Verbinde...' : 'OK'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <div className="flex flex-1 flex-wrap items-center justify-end gap-1 sm:gap-2 min-w-0 max-w-full">
        {mounted && hidSupported && (
          <button
            onClick={() => {
              if (!hidConnected) {
                void handleConnectDictationMic();
              }
            }}
            className={`inline-flex items-center gap-1.5 text-xs px-1.5 sm:px-2 py-1 rounded border transition-colors ${
              hidConnected
                ? 'text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-300 dark:border-emerald-800 dark:bg-emerald-900/20 cursor-default'
                : 'text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100 dark:text-amber-300 dark:border-amber-800 dark:bg-amber-900/20 dark:hover:bg-amber-900/30'
            }`}
            title={hidConnected
              ? `Diktiergerät verbunden${hidDeviceName ? `: ${hidDeviceName}` : ''}`
              : 'Diktiergerät nicht verbunden. Klicken zum Verbinden.'}
            disabled={hidConnecting || hidConnected}
            aria-label={hidConnected
              ? `Diktiergerät verbunden${hidDeviceName ? `: ${hidDeviceName}` : ''}`
              : 'Diktiergerät nicht verbunden. Klicken zum Verbinden.'}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                hidConnected ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
              aria-hidden="true"
            />
            <span>🎙️</span>
            <span className="hidden sm:inline">
              {hidConnecting ? 'Verbinde...' : hidConnected ? 'Verbunden' : 'Nicht verbunden'}
            </span>
          </button>
        )}
        <button
          onClick={() => setShowBugReport(true)}
          className="text-xs text-red-600 hover:text-red-700 px-1.5 sm:px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
          title="Bug oder Feature melden"
        >
          🐞<span className="hidden sm:inline"> Melden</span>
        </button>
        {isAdmin ? (
          <div ref={dictionaryMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setShowDictionaryMenu((current) => !current)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50/80 px-2 py-1 text-xs text-green-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/60 dark:text-green-400 dark:hover:bg-gray-800"
              title="Wörterbücher öffnen"
              aria-haspopup="menu"
              aria-expanded={showDictionaryMenu}
            >
              <span aria-hidden="true">📖</span>
              <span className="hidden sm:inline">Wörterbücher</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>
            {showDictionaryMenu && (
              <div
                className="absolute right-0 top-full z-30 mt-2 w-56 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900"
                role="menu"
              >
                <button
                  type="button"
                  onClick={handleOpenDictionary}
                  className={`${dictionaryMenuItemClass} text-green-700 dark:text-green-400`}
                  title="Mein Wörterbuch (markierter Text wird übernommen)"
                  role="menuitem"
                >
                  <span aria-hidden="true">📖</span>
                  <span>Mein Wörterbuch</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDictionaryMenu(false);
                    setShowGroupDict(true);
                  }}
                  className={`${dictionaryMenuItemClass} text-cyan-700 dark:text-cyan-400`}
                  title="Gruppen-Wörterbücher verwalten"
                  role="menuitem"
                >
                  <span aria-hidden="true">👥</span>
                  <span>Gruppen-Wörterbücher</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDictionaryMenu(false);
                    setShowStandardDict(true);
                  }}
                  className={`${dictionaryMenuItemClass} text-teal-700 dark:text-teal-400`}
                  title="Standard-Wörterbuch verwalten (für alle Benutzer)"
                  role="menuitem"
                >
                  <span aria-hidden="true">📚</span>
                  <span>Standard-Wörterbuch</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={handleOpenDictionary}
            className="text-xs text-green-600 hover:text-green-700 px-1.5 sm:px-2 py-1 rounded hover:bg-green-50 dark:hover:bg-green-900/20"
            title="Mein Wörterbuch (markierter Text wird übernommen)"
          >
            📖<span className="hidden sm:inline"> Wörterbuch</span>
          </button>
        )}
        <button
          onClick={() => setShowTemplates(true)}
          className="text-xs text-orange-600 hover:text-orange-700 px-1.5 sm:px-2 py-1 rounded hover:bg-orange-50 dark:hover:bg-orange-900/20"
          title="Meine Textbausteine verwalten"
        >
          📝<span className="hidden sm:inline"> Bausteine</span>
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
      {templatesModal}
      {configModal}
      {userManagementModal}
      {standardDictModal}
      {groupDictModal}
      {hidConnectPrompt}
      <BugReportForm open={showBugReport} onClose={() => setShowBugReport(false)} />
    </>
  );
}
