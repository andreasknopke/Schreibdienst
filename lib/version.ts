import packageJson from '@/package.json';

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version;
export const GITHUB_OWNER = process.env.GITHUB_REPO_OWNER || process.env.NEXT_PUBLIC_GITHUB_REPO_OWNER || 'andreasknopke';
export const GITHUB_REPO = process.env.GITHUB_REPO_NAME || process.env.NEXT_PUBLIC_GITHUB_REPO_NAME || 'Schreibdienst';

export type VersionStatus = 'up-to-date' | 'update-available' | 'release-info-unavailable';

export interface ReleaseSummary {
  version: string;
  name: string;
  publishedAt: string | null;
  url: string;
  notes: string;
}

export interface VersionInfoResponse {
  currentVersion: string;
  currentRelease: ReleaseSummary | null;
  latestRelease: ReleaseSummary | null;
  recentReleases: ReleaseSummary[];
  status: VersionStatus;
  repoOwner: string;
  repoName: string;
  checkedAt: string;
  buildCommitSha: string | null;
  error?: string;
}

function normalizeVersionParts(version: string): number[] {
  const clean = version.trim().replace(/^v/i, '');
  return clean
    .split('.')
    .map((part) => Number.parseInt(part.replace(/[^0-9].*$/, ''), 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersionParts(left);
  const rightParts = normalizeVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

export function normalizeReleaseVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

export function getBuildCommitSha(): string | null {
  return process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.COOLIFY_GIT_COMMIT_SHA
    || null;
}