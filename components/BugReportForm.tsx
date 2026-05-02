"use client";

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './AuthProvider';

type TicketType = 'bug' | 'feature';
type SubmitStatus = 'form' | 'success' | 'error';

interface BugReportFormProps {
  open: boolean;
  onClose: () => void;
}

const MAX_CONSOLE_ENTRIES = 80;
const consoleBuffer: string[] = [];
let consoleCaptureInitialized = false;

function stringifyConsoleArg(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pushConsoleEntry(level: string, args: unknown[]) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${args.map(stringifyConsoleArg).join(' ')}`;
  consoleBuffer.push(line);

  if (consoleBuffer.length > MAX_CONSOLE_ENTRIES) {
    consoleBuffer.splice(0, consoleBuffer.length - MAX_CONSOLE_ENTRIES);
  }
}

function initConsoleCapture() {
  if (consoleCaptureInitialized || typeof window === 'undefined') {
    return;
  }

  const methods = ['log', 'info', 'warn', 'error'] as const;
  const consoleRef = console as unknown as Record<(typeof methods)[number], (...args: unknown[]) => void>;

  methods.forEach((method) => {
    const original = consoleRef[method].bind(console);
    consoleRef[method] = (...args: unknown[]) => {
      pushConsoleEntry(method, args);
      original(...args);
    };
  });

  consoleCaptureInitialized = true;
}

function collectConsoleLogs(): string {
  return consoleBuffer.join('\n');
}

function BugIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9.75h7.5m-8.25 4.5h8.25M9 3.75l1.125 2.25m3.75-2.25L12.75 6M7.5 6.75h9a3.75 3.75 0 0 1 3.75 3.75v2.25a5.25 5.25 0 0 1-5.25 5.25h-6a5.25 5.25 0 0 1-5.25-5.25V10.5A3.75 3.75 0 0 1 7.5 6.75Zm-3 2.625L6.75 10.5m12.75-1.125L17.25 10.5m-10.5 6 1.5 2.25m7.5-2.25-1.5 2.25" />
    </svg>
  );
}

function FeatureIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1.5m0 15V21m6.364-15.364-1.06 1.06M6.697 17.303l-1.06 1.06m12.727 0-1.06-1.06M6.697 6.697l-1.06-1.06M21 12h-1.5M4.5 12H3m12.75 0a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
    </svg>
  );
}

export default function BugReportForm({ open, onClose }: BugReportFormProps) {
  const { username, hasDbToken, getAuthHeader, getDbTokenHeader } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [type, setType] = useState<TicketType>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>('form');
  const [resultMessage, setResultMessage] = useState('');

  useEffect(() => {
    setMounted(true);
    initConsoleCapture();
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open, loading]);

  const descriptionPlaceholder = useMemo(() => {
    if (type === 'bug') {
      return 'Schritte zum Reproduzieren:\n1. ...\n2. ...\n\nErwartetes Verhalten:\n...\n\nTatsächliches Verhalten:\n...';
    }

    return 'Beschreiben Sie Ihren Vorschlag möglichst detailliert und welchen Nutzen er im Alltag hätte...';
  }, [type]);

  const resetForm = () => {
    setType('bug');
    setTitle('');
    setDescription('');
    setContactEmail('');
    setLoading(false);
    setStatus('form');
    setResultMessage('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedContactEmail = contactEmail.trim();

    if (!trimmedTitle || !trimmedDescription) {
      setStatus('error');
      setResultMessage('Bitte füllen Sie Titel und Beschreibung aus.');
      return;
    }

    setLoading(true);
    setStatus('form');
    setResultMessage('');

    try {
      const softwareInfo = {
        system: 'Schreibdienst',
        url: window.location.href,
        origin: window.location.origin,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
        timestamp: new Date().toISOString(),
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0',
        reporterEmail: trimmedContactEmail || undefined,
        reporterName: username || undefined,
        userName: username || undefined,
        hasDbToken,
      };

      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader(),
        },
        body: JSON.stringify({
          type,
          title: trimmedTitle,
          description: trimmedDescription,
          contactEmail: trimmedContactEmail || undefined,
          reporterEmail: trimmedContactEmail || undefined,
          reporterName: username || undefined,
          userName: username || undefined,
          softwareInfo,
          consoleLogs: collectConsoleLogs(),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.details || data.error || 'Fehler beim Senden des Tickets.');
      }

      setStatus('success');
      setResultMessage(
        data.message ||
          (type === 'bug'
            ? 'Bug-Report erfolgreich übermittelt. Vielen Dank für Ihre Mithilfe.'
            : 'Feature-Wunsch erfolgreich übermittelt. Vielen Dank für Ihren Vorschlag.')
      );
    } catch (error: any) {
      setStatus('error');
      setResultMessage(error?.message || 'Fehler beim Senden des Tickets.');
    } finally {
      setLoading(false);
    }
  };

  if (!open || !mounted) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 sm:items-center" onMouseDown={handleClose}>
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {status === 'form' && (
          <>
            <div className={type === 'bug' ? 'bg-gradient-to-br from-red-700 to-red-500 px-5 py-4 text-white' : 'bg-gradient-to-br from-amber-700 to-amber-500 px-5 py-4 text-white'}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    {type === 'bug' ? <BugIcon /> : <FeatureIcon />}
                    <h2 className="text-lg font-semibold">{type === 'bug' ? 'Bug melden' : 'Feature vorschlagen'}</h2>
                  </div>
                  <p className="text-sm/6 text-white/90">
                    {type === 'bug'
                      ? 'Beschreiben Sie den Fehler möglichst genau. System- und Nutzerinformationen werden automatisch mitgeschickt.'
                      : 'Beschreiben Sie Ihren Verbesserungsvorschlag. System- und Nutzerinformationen werden automatisch mitgeschickt.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-full p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
                  aria-label="Dialog schließen"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setType('bug')}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${type === 'bug' ? 'border-red-600 bg-red-600 text-white' : 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40'}`}
                >
                  <BugIcon className="h-4 w-4" />
                  <span>Bug</span>
                </button>
                <button
                  type="button"
                  onClick={() => setType('feature')}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${type === 'feature' ? 'border-amber-500 bg-amber-500 text-white' : 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40'}`}
                >
                  <FeatureIcon className="h-4 w-4" />
                  <span>Feature</span>
                </button>
              </div>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Titel *</span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={type === 'bug' ? 'Kurze Fehlerbeschreibung' : 'Kurze Beschreibung des Wunsches'}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-blue-900"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Beschreibung *</span>
                <textarea
                  rows={7}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={descriptionPlaceholder}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-blue-900"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Kontakt-E-Mail</span>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  placeholder="ihre@email.de"
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-blue-900"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Nur falls wir Rückfragen haben. Ansonsten werden die vorhandenen Benutzerinformationen verwendet.
                </p>
              </label>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
                <div className="mb-1 flex items-center gap-2">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 text-gray-500 dark:text-gray-400">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.09.852l-.708 2.836a.75.75 0 0 0 1.09.852l.041-.02M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                  </svg>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Automatisch übermittelte Daten</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Systemname, Version, URL, Benutzername, Browser, Betriebssystem, DB-Token-Status und letzte Konsolen-Logs.
                </p>
              </div>

              <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-800">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-xl px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={loading || !title.trim() || !description.trim()}
                  className="inline-flex min-w-44 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 dark:disabled:bg-blue-900"
                >
                  {loading ? (
                    <>
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      <span>Wird gesendet...</span>
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L6 12Zm0 0h7.5" />
                      </svg>
                      <span>{type === 'bug' ? 'Bug melden' : 'Feature vorschlagen'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {status === 'success' && (
          <div className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-8 w-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">Erfolgreich übermittelt</h2>
            <p className="mb-6 whitespace-pre-line text-sm text-gray-600 dark:text-gray-300">{resultMessage}</p>
            <button type="button" onClick={handleClose} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700">
              Schließen
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-8 w-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008ZM10.29 3.86 1.82 18a2.25 2.25 0 0 0 1.93 3.375h16.5A2.25 2.25 0 0 0 22.18 18L13.71 3.86a2.25 2.25 0 0 0-3.42 0Z" />
              </svg>
            </div>
            <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">Übermittlung fehlgeschlagen</h2>
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-left text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {resultMessage}
            </div>
            <div className="flex justify-center gap-3">
              <button type="button" onClick={handleClose} className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                Schließen
              </button>
              <button type="button" onClick={() => setStatus('form')} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700">
                Erneut versuchen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}