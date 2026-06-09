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

interface ReleaseNoteSection {
  heading: string | null;
  items: string[];
}

function isReleaseNoteHeading(line: string): boolean {
  if (/^#{1,6}\s+/.test(line)) {
    return true;
  }

  if (/^([-*]|\d+[.)])\s+/.test(line)) {
    return false;
  }

  return line.length <= 48 && !/[.!?]$/.test(line);
}

function cleanReleaseNoteLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^([-*]|\d+[.)])\s+/, '')
    .trim();
}

function releaseNotesToSections(notes: string): ReleaseNoteSection[] {
  const sections: ReleaseNoteSection[] = [];
  let currentSection: ReleaseNoteSection = { heading: null, items: [] };

  const pushCurrentSection = () => {
    if (currentSection.heading || currentSection.items.length > 0) {
      sections.push(currentSection);
    }
  };

  notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .forEach((line) => {
      const text = cleanReleaseNoteLine(line);
      if (!text) {
        return;
      }

      if (isReleaseNoteHeading(line)) {
        pushCurrentSection();
        currentSection = { heading: text, items: [] };
        return;
      }

      currentSection.items.push(text);
    });

  pushCurrentSection();

  return sections;
}

function ReleaseCard({
  release,
  isOpen,
  onToggle,
  subtitle,
}: {
  release: ReleaseSummary;
  isOpen: boolean;
  onToggle: () => void;
  subtitle: string;
}) {
  const sections = useMemo(() => releaseNotesToSections(release.notes || ''), [release.notes]);
  const formattedDate = formatReleaseDate(release.publishedAt || null);

  return (
    <div className={`rounded-lg border transition-colors ${
      isOpen
        ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/20'
        : 'border-gray-200 bg-white/80 dark:border-gray-700 dark:bg-gray-900/60'
    }`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 p-3 text-left"
        aria-expanded={isOpen}
      >
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Version {release.version}</p>
          <p className={`text-sm ${isOpen ? 'text-blue-700 dark:text-blue-200' : 'text-gray-500 dark:text-gray-400'}`}>
            {subtitle}
          </p>
          {formattedDate && (
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{formattedDate}</p>
          )}
        </div>
        <span className={`text-base leading-none ${isOpen ? 'text-blue-700 dark:text-blue-200' : 'text-gray-400 dark:text-gray-500'}`} aria-hidden="true">
          {isOpen ? '▾' : '▸'}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-blue-200/80 px-3 py-3 dark:border-blue-900/60">
          {sections.length > 0 ? (
            <div className="space-y-3 text-sm text-gray-700 dark:text-gray-200">
              {sections.map((section, sectionIndex) => (
                <section key={`${section.heading || 'release-notes'}-${sectionIndex}`} className="space-y-1.5">
                  {section.heading && (
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{section.heading}</p>
                  )}
                  {section.items.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5">
                      {section.items.map((item) => (
                        <li key={item} className="leading-snug">
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-300">Noch keine Zusammenfassung fuer diese Version hinterlegt.</p>
          )}

          <div className="mt-3 text-right">
            <a
              href={release.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Details auf GitHub
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function UpdatePanel({
  isOpen = true,
  onRequestOpen,
}: {
  isOpen?: boolean;
  onRequestOpen?: () => void;
}) {
  const [data, setData] = useState<VersionInfoResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRecentReleaseVersion, setSelectedRecentReleaseVersion] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const storedVersion = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_SEEN_VERSION_KEY) : null;

    const loadVersionInfo = async () => {
      try {
        const response = await fetch('/api/version', { cache: 'no-store' });
        const payload = (await response.json()) as VersionInfoResponse;
        if (isCancelled) {
          return;
        }

        setData(payload);
        const lastSeenUpdateRelease = typeof window !== 'undefined'
          ? window.localStorage.getItem(LAST_SEEN_UPDATE_RELEASE_KEY)
          : null;
        const hasSeenLatestAvailableRelease = payload.latestRelease?.version
          ? lastSeenUpdateRelease === payload.latestRelease.version
          : true;
        const shouldAutoOpenForCurrentVersion = payload.currentVersion
          ? storedVersion !== payload.currentVersion
          : false;
        const shouldAutoOpenForNewUpdate = payload.status === 'update-available' && !hasSeenLatestAvailableRelease;

        if (shouldAutoOpenForCurrentVersion || shouldAutoOpenForNewUpdate) {
          onRequestOpen?.();
        }

        if (shouldAutoOpenForNewUpdate && payload.latestRelease?.version) {
          window.localStorage.setItem(LAST_SEEN_UPDATE_RELEASE_KEY, payload.latestRelease.version);
        }

        if (payload.currentVersion) {
          window.localStorage.setItem(LAST_SEEN_VERSION_KEY, payload.currentVersion);
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

  useEffect(() => {
    if (!isOpen) {
      setSelectedRecentReleaseVersion(null);
    }
  }, [isOpen]);

  const currentRelease = data?.currentRelease || null;
  const recentReleases = data?.recentReleases || [];
  const selectedRecentRelease = selectedRecentReleaseVersion
    ? recentReleases.find((release) => release.version === selectedRecentReleaseVersion) || null
    : null;
  const visibleReleases = selectedRecentRelease ? [selectedRecentRelease] : recentReleases;
  const releasesUrl = data
    ? `https://github.com/${data.repoOwner}/${data.repoName}/releases`
    : null;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
        Installierte Version: <span className="font-medium text-gray-900 dark:text-gray-100">v{APP_VERSION}</span>
      </div>

      {isLoading && (
        <div className="rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
          Pruefe Versionsinformationen ...
        </div>
      )}

      {!isLoading && visibleReleases.map((release) => {
        const isCurrentVersion = release.version === currentRelease?.version;
        const isLatestAvailable = data?.status === 'update-available' && release.version === data.latestRelease?.version;
        const isOpen = release.version === selectedRecentRelease?.version;
        const subtitle = isLatestAvailable
          ? 'Neue Version verfuegbar'
          : isCurrentVersion
            ? 'Aktuell installiert'
            : 'Neue Features und Verbesserungen';

        return (
          <ReleaseCard
            key={release.version}
            release={release}
            isOpen={isOpen}
            onToggle={() => setSelectedRecentReleaseVersion((current) => current === release.version ? null : release.version)}
            subtitle={subtitle}
          />
        );
      })}

      {!isLoading && recentReleases.length === 0 && data?.status !== 'release-info-unavailable' && (
        <div className="rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
          Es wurden noch keine Release-Informationen gefunden.
        </div>
      )}

      {data?.status === 'release-info-unavailable' && data.error && (
        <div className="rounded-lg border border-gray-200 bg-white/80 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
          GitHub-Informationen konnten gerade nicht geladen werden. Die App bleibt nutzbar. {data.error}
        </div>
      )}

      {releasesUrl && !isLoading && (
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
    </div>
  );
}