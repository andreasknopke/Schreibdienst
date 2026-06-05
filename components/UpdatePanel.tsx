'use client';

import { useEffect, useMemo, useState } from 'react';
import { APP_VERSION, type ReleaseSummary, type VersionInfoResponse } from '@/lib/version';

const LAST_SEEN_VERSION_KEY = 'schreibdienst:last-seen-version';
const LAST_SEEN_UPDATE_RELEASE_KEY = 'schreibdienst:last-seen-update-release';

function formatReleaseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function releaseNotesToLines(notes: string): string[] {
  return notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function buildSummary(data: VersionInfoResponse | null, hasSeenCurrentVersion: boolean): string {
  if (!data) {
    return `Version ${APP_VERSION} installiert`;
  }

  if (data.status === 'update-available' && data.latestRelease) {
    return `Neue Version ${data.latestRelease.version} verfuegbar`;
  }

  if (!hasSeenCurrentVersion && data.currentRelease) {
    return `Neu in Version ${data.currentRelease.version}`;
  }

  if (data.status === 'release-info-unavailable') {
    return `Version ${data.currentVersion} installiert`;
  }

  return `Version ${data.currentVersion} ist aktuell`;
}

function ReleaseBlock({
  title,
  release,
  emptyMessage,
}: {
  title: string;
  release: ReleaseSummary | null;
  emptyMessage: string;
}) {
  const lines = useMemo(() => releaseNotesToLines(release?.notes || ''), [release?.notes]);
  const formattedDate = formatReleaseDate(release?.publishedAt || null);

  return (
    <div className="rounded-lg border border-gray-200 bg-white/80 p-3 dark:border-gray-700 dark:bg-gray-900/60">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
          {release ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Version {release.version}
              {formattedDate ? ` · ${formattedDate}` : ''}
            </p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">{emptyMessage}</p>
          )}
        </div>
        {release?.url && (
          <a
            href={release.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Details
          </a>
        )}
      </div>
      {release && lines.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-200">
          {lines.map((line) => (
            <li key={line} className="leading-snug">
              {line.replace(/^[-*]\s*/, '')}
            </li>
          ))}
        </ul>
      ) : release ? (
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Noch keine Zusammenfassung fuer diese Version hinterlegt.</p>
      ) : null}
    </div>
  );
}

export default function UpdatePanel({
  onRequestOpen,
}: {
  onRequestOpen?: () => void;
}) {
  const [data, setData] = useState<VersionInfoResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasSeenCurrentVersion, setHasSeenCurrentVersion] = useState(true);
  const [selectedRecentReleaseVersion, setSelectedRecentReleaseVersion] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const storedVersion = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_SEEN_VERSION_KEY) : null;
    const hasSeen = storedVersion === APP_VERSION;
    setHasSeenCurrentVersion(hasSeen);

    const loadVersionInfo = async () => {
      try {
        const response = await fetch('/api/version', { cache: 'no-store' });
        const payload = (await response.json()) as VersionInfoResponse;
        if (isCancelled) {
          return;
        }

        setData(payload);
        setSelectedRecentReleaseVersion((current) => current ?? payload.recentReleases[0]?.version ?? null);
        const lastSeenUpdateRelease = typeof window !== 'undefined'
          ? window.localStorage.getItem(LAST_SEEN_UPDATE_RELEASE_KEY)
          : null;
        const hasSeenLatestAvailableRelease = payload.latestRelease?.version
          ? lastSeenUpdateRelease === payload.latestRelease.version
          : true;
        const shouldAutoOpenForNewUpdate = payload.status === 'update-available' && !hasSeenLatestAvailableRelease;

        if (shouldAutoOpenForNewUpdate || !hasSeen) {
          setIsExpanded(true);
        }

        if (shouldAutoOpenForNewUpdate && payload.latestRelease?.version) {
          window.localStorage.setItem(LAST_SEEN_UPDATE_RELEASE_KEY, payload.latestRelease.version);
          onRequestOpen?.();
        }

        if (payload.currentVersion) {
          window.localStorage.setItem(LAST_SEEN_VERSION_KEY, payload.currentVersion);
          setHasSeenCurrentVersion(storedVersion === payload.currentVersion);
        }
      } catch {
        if (!isCancelled) {
          setData(null);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadVersionInfo();

    return () => {
      isCancelled = true;
    };
  }, [onRequestOpen]);

  const summary = buildSummary(data, hasSeenCurrentVersion);
  const currentRelease = data?.currentRelease || null;
  const latestRelease = data?.latestRelease || null;
  const recentReleases = data?.recentReleases || [];
  const showLatestRelease = data?.status === 'update-available' && latestRelease;
  const selectedRecentRelease = recentReleases.find((release) => release.version === selectedRecentReleaseVersion) || recentReleases[0] || null;
  const releasesUrl = data
    ? `https://github.com/${data.repoOwner}/${data.repoName}/releases`
    : null;

  return (
    <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/20">
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">Updates</p>
          <p className="text-xs text-blue-800/80 dark:text-blue-200/80">
            {isLoading ? 'Pruefe Versionsinformationen ...' : summary}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-blue-900 dark:text-blue-100">
          <span className="rounded-full bg-white/80 px-2 py-1 font-medium dark:bg-blue-900/60">v{data?.currentVersion || APP_VERSION}</span>
          <span aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-3 border-t border-blue-200/80 px-4 py-3 dark:border-blue-900/60">
          {showLatestRelease ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
              Eine neuere Version ist verfuegbar. Sie nutzen aktuell Version {data?.currentVersion}, verfuegbar ist Version {latestRelease?.version}.
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100">
              Sie nutzen aktuell Version {data?.currentVersion || APP_VERSION}.
            </div>
          )}

          {recentReleases
            .filter((release) => release.version !== currentRelease?.version)
            .map((release) => {
              const isActive = release.version === selectedRecentRelease?.version;
              return (
                <button
                  key={release.version}
                  type="button"
                  onClick={() => setSelectedRecentReleaseVersion(release.version)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    isActive
                      ? 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-100'
                      : 'border-gray-200 bg-white/80 text-gray-900 hover:border-blue-200 hover:bg-blue-50/60 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-100 dark:hover:border-blue-800 dark:hover:bg-blue-950/20'
                  }`}
                  aria-pressed={isActive}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Version {release.version}</p>
                      <p className={`text-sm ${isActive ? 'text-blue-700 dark:text-blue-200' : 'text-gray-500 dark:text-gray-400'}`}>
                        Neue Features und Verbesserungen
                      </p>
                    </div>
                    <span className={`text-base leading-none ${isActive ? 'text-blue-700 dark:text-blue-200' : 'text-gray-400 dark:text-gray-500'}`} aria-hidden="true">
                      {isActive ? '▾' : '▸'}
                    </span>
                  </div>
                </button>
              );
            })}

          {selectedRecentRelease && selectedRecentRelease.version !== currentRelease?.version && (
            <ReleaseBlock
              title={`Versionshinweise ${selectedRecentRelease.version}`}
              release={selectedRecentRelease}
              emptyMessage="Fuer dieses Update liegen keine Versionshinweise vor."
            />
          )}

          {releasesUrl && (
            <div className="text-right">
              <a
                href={releasesUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Weitere Releases auf GitHub
              </a>
            </div>
          )}

          {showLatestRelease && latestRelease && latestRelease.version !== selectedRecentRelease?.version && (
            <ReleaseBlock
              title="Neue verfuegbare Version"
              release={latestRelease}
              emptyMessage="Fuer die neueste Version liegt noch keine Zusammenfassung vor."
            />
          )}

          {currentRelease && currentRelease.version !== selectedRecentRelease?.version && (
            <ReleaseBlock
              title="Installierte Version"
              release={currentRelease}
              emptyMessage="Fuer die installierte Version wurde noch keine GitHub-Release-Notiz gefunden."
            />
          )}

          {data?.status === 'release-info-unavailable' && data.error && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              GitHub-Informationen konnten gerade nicht geladen werden. Die App bleibt nutzbar. {data.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}