import { NextResponse } from 'next/server';
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
    const latestPayload = await fetchGitHubRelease(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`);
    const latestRelease = mapReleasePayload(latestPayload);
    const currentRelease = await fetchCurrentRelease(APP_VERSION);
    const status = latestRelease && compareVersions(latestRelease.version, APP_VERSION) > 0
      ? 'update-available'
      : latestRelease
        ? 'up-to-date'
        : 'release-info-unavailable';

    const payload: VersionInfoResponse = {
      currentVersion: APP_VERSION,
      currentRelease,
      latestRelease,
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