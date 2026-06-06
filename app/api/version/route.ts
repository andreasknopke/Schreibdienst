import { NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import {
  APP_VERSION,
  compareVersions,
  getBuildCommitSha,
  GITHUB_OWNER,
  GITHUB_REPO,
  normalizeReleaseVersion,
  type ReleaseSummary,
  type VersionInfoResponse,
} from '@/lib/version';

interface GitHubReleaseResponse {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
}

interface AtomFeedEntry {
  title?: string;
  updated?: string;
  link?: {
    '@_href'?: string;
  } | Array<{
    '@_href'?: string;
    '@_rel'?: string;
  }>;
  content?: string | { '#text'?: string; '@_type'?: string } | null;
}

interface AtomFeedResponse {
  feed?: {
    entry?: AtomFeedEntry | AtomFeedEntry[];
  };
}

function buildGitHubHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Schreibdienst-Version-Check',
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

function mapReleasePayload(release: GitHubReleaseResponse | null): ReleaseSummary | null {
  if (!release?.tag_name) {
    return null;
  }

  return {
    version: normalizeReleaseVersion(release.tag_name),
    name: release.name?.trim() || release.tag_name,
    publishedAt: release.published_at || null,
    url: release.html_url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/${encodeURIComponent(release.tag_name)}`,
    notes: release.body?.trim() || '',
  };
}

function isGitHubRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /status (403|429)/.test(error.message);
}

function extractAtomContentText(content: AtomFeedEntry['content']): string {
  if (!content) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }
  if (typeof content === 'object' && typeof content['#text'] === 'string') {
    return content['#text'];
  }
  return '';
}

function htmlToReleaseNotes(html: unknown): string {
  if (typeof html !== 'string' || html.length === 0) {
    return '';
  }

  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h1|h2|h3|h4|h5|h6|ul|ol)\s*>/gi, '\n\n')
    .replace(/<\s*li\s*>/gi, '- ')
    .replace(/<\s*\/\s*li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getAtomEntryLink(link: AtomFeedEntry['link']): string | null {
  if (!link) {
    return null;
  }

  if (Array.isArray(link)) {
    const alternateLink = link.find((entry) => entry['@_rel'] === 'alternate') || link[0];
    return alternateLink?.['@_href'] || null;
  }

  return link['@_href'] || null;
}

async function fetchReleaseInfoFromAtom(limit: number): Promise<{
  latestRelease: ReleaseSummary | null;
  currentRelease: ReleaseSummary | null;
  recentReleases: ReleaseSummary[];
}> {
  const response = await fetch(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases.atom`, {
    headers: buildGitHubHeaders(),
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`GitHub releases Atom feed request failed with status ${response.status}`);
  }

  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const parsed = parser.parse(xml) as AtomFeedResponse;
  const entries = parsed.feed?.entry
    ? Array.isArray(parsed.feed.entry)
      ? parsed.feed.entry
      : [parsed.feed.entry]
    : [];
  const mappedEntries = entries
    .map((entry) => {
      const version = entry.title ? normalizeReleaseVersion(entry.title) : null;
      const url = getAtomEntryLink(entry.link);

      if (!version || !url) {
        return null;
      }

      return {
        version,
        name: entry.title?.trim() || version,
        publishedAt: entry.updated || null,
        url,
        notes: htmlToReleaseNotes(extractAtomContentText(entry.content)),
      } satisfies ReleaseSummary;
    })
    .filter((entry): entry is ReleaseSummary => Boolean(entry));

  return {
    latestRelease: mappedEntries[0] || null,
    currentRelease: mappedEntries.find((entry) => entry.version === APP_VERSION) || null,
    recentReleases: mappedEntries.slice(0, limit),
  };
}

async function fetchGitHubRelease(url: string): Promise<GitHubReleaseResponse | null> {
  const response = await fetch(url, {
    headers: buildGitHubHeaders(),
    next: { revalidate: 300 },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub release request failed with status ${response.status}`);
  }

  return response.json() as Promise<GitHubReleaseResponse>;
}

async function fetchRecentReleases(limit: number): Promise<ReleaseSummary[]> {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=${limit}`, {
    headers: buildGitHubHeaders(),
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`GitHub releases request failed with status ${response.status}`);
  }

  const payload = await response.json() as GitHubReleaseResponse[];
  return payload
    .map((release) => mapReleasePayload(release))
    .filter((release): release is ReleaseSummary => Boolean(release));
}

async function fetchCurrentRelease(currentVersion: string): Promise<ReleaseSummary | null> {
  const candidateTags = Array.from(new Set([`v${currentVersion}`, currentVersion]));

  for (const tag of candidateTags) {
    const release = await fetchGitHubRelease(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${encodeURIComponent(tag)}`);
    if (release) {
      return mapReleasePayload(release);
    }
  }

  return null;
}

export async function GET() {
  const checkedAt = new Date().toISOString();

  try {
    let latestRelease: ReleaseSummary | null;
    let currentRelease: ReleaseSummary | null;
    let recentReleases: ReleaseSummary[];

    try {
      const [latestPayload, currentReleasePayload, recentReleasePayloads] = await Promise.all([
        fetchGitHubRelease(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`),
        fetchCurrentRelease(APP_VERSION),
        fetchRecentReleases(3),
      ]);

      latestRelease = mapReleasePayload(latestPayload);
      currentRelease = currentReleasePayload;
      recentReleases = recentReleasePayloads;
    } catch (error) {
      if (!isGitHubRateLimitError(error)) {
        throw error;
      }

      const fallbackPayload = await fetchReleaseInfoFromAtom(3);
      latestRelease = fallbackPayload.latestRelease;
      currentRelease = fallbackPayload.currentRelease;
      recentReleases = fallbackPayload.recentReleases;
    }

    const status = latestRelease && compareVersions(latestRelease.version, APP_VERSION) > 0
      ? 'update-available'
      : latestRelease
        ? 'up-to-date'
        : 'release-info-unavailable';

    const payload: VersionInfoResponse = {
      currentVersion: APP_VERSION,
      currentRelease,
      latestRelease,
      recentReleases,
      status,
      repoOwner: GITHUB_OWNER,
      repoName: GITHUB_REPO,
      checkedAt,
      buildCommitSha: getBuildCommitSha(),
    };

    return NextResponse.json(payload);
  } catch (error) {
    const payload: VersionInfoResponse = {
      currentVersion: APP_VERSION,
      currentRelease: null,
      latestRelease: null,
      recentReleases: [],
      status: 'release-info-unavailable',
      repoOwner: GITHUB_OWNER,
      repoName: GITHUB_REPO,
      checkedAt,
      buildCommitSha: getBuildCommitSha(),
      error: error instanceof Error ? error.message : 'Versionsinformationen konnten nicht geladen werden.',
    };

    return NextResponse.json(payload, { status: 200 });
  }
}