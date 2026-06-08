'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { APP_VERSION, findWindowsInstallerAsset, GITHUB_OWNER, GITHUB_REPO, type ReleaseSummary, type VersionInfoResponse } from '@/lib/version';

interface InjectorDownloadDialogProps {
  open: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onRetry: () => void;
}

/**
 * Wird angezeigt, wenn die Verbindung zum nativen Injector fehlgeschlagen
 * ist. Bietet den direkten Download des aktuellen Windows-Installers aus
 * dem GitHub-Release an und verweist auf die manuelle Installationsanleitung.
 */
export default function InjectorDownloadDialog({
  open,
  errorMessage,
  onClose,
  onRetry,
}: InjectorDownloadDialogProps) {
  const [release, setRelease] = useState<ReleaseSummary | null>(null);
  const [releaseStatus, setReleaseStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setReleaseStatus('loading');
    setReleaseError(null);

    fetch('/api/version', { cache: 'no-store' })
      .then((res) => res.json() as Promise<VersionInfoResponse>)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const candidate = payload.latestRelease || payload.currentRelease;
        setRelease(candidate);
        setReleaseStatus('ready');
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setReleaseStatus('error');
        setReleaseError(err instanceof Error ? err.message : 'Versionsinformationen konnten nicht geladen werden.');
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mounted) {
    return null;
  }

  const installer = findWindowsInstallerAsset(release);
  const installerVersion = release?.version || APP_VERSION;
  const repoUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
  const docsUrl = `${repoUrl}/blob/main/docs/DEPLOY_INJECTOR_KUNDE.md`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 sm:items-center"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="injector-download-title"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="bg-gradient-to-br from-amber-700 to-amber-500 px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="injector-download-title" className="text-lg font-semibold">
                Ziel-App-Verbindung fehlgeschlagen
              </h2>
              <p className="mt-1 text-sm/6 text-white/90">
                Der Schreibdienst-Injector ist nicht erreichbar. Installiere oder starte ihn, um die
                Live-Übertragung in die Ziel-App zu nutzen.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
              aria-label="Dialog schließen"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-4 p-5 text-sm text-gray-700 dark:text-gray-200">
          {errorMessage && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-medium">Technische Meldung</p>
              <p className="mt-0.5 break-words text-xs/5">{errorMessage}</p>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 bg-white/60 p-4 dark:border-gray-700 dark:bg-gray-900/60">
            <p className="font-medium text-gray-900 dark:text-gray-100">Schritt 1: Installer herunterladen</p>
            {releaseStatus === 'loading' && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Suche aktuelle Version…</p>
            )}
            {releaseStatus === 'error' && (
              <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">
                Konnte GitHub-Release nicht laden: {releaseError}
              </p>
            )}
            {releaseStatus === 'ready' && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Aktuelle Version: <span className="font-mono">{installerVersion}</span>
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {installer ? (
                <a
                  href={installer.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-amber-700"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16" />
                  </svg>
                  Windows-Installer laden
                </a>
              ) : (
                <a
                  href={`${repoUrl}/releases/latest`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-amber-700"
                >
                  Auf GitHub ansehen
                </a>
              )}
              {release && (
                <a
                  href={release.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Release-Notizen
                </a>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white/60 p-4 dark:border-gray-700 dark:bg-gray-900/60">
            <p className="font-medium text-gray-900 dark:text-gray-100">Schritt 2: Installieren & starten</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs/6 text-gray-600 dark:text-gray-300">
              <li>Installer als Administrator ausführen und den Anweisungen folgen.</li>
              <li>„Automatisch starten beim Windows-Anmelden" aktivieren, damit der Injector nach dem Login bereitsteht.</li>
              <li>Nach der Installation läuft <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px] dark:bg-gray-800">schreibdienst-injector.exe</code> unsichtbar im Hintergrund.</li>
            </ol>
            <a
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Installationsanleitung öffnen →
            </a>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white/60 p-4 dark:border-gray-700 dark:bg-gray-900/60">
            <p className="font-medium text-gray-900 dark:text-gray-100">Schritt 3: Verbindung erneut prüfen</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Sobald der Injector läuft, kann die Ziel-App-Verbindung erneut aktiviert werden.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              Erneut prüfen
            </button>
          </div>
        </div>

        <div className="flex justify-end border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
