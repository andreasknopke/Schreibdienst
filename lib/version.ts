import packageJson from '@/package.json';

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version;
export const GITHUB_OWNER = process.env.GITHUB_REPO_OWNER || process.env.NEXT_PUBLIC_GITHUB_REPO_OWNER || 'andreasknopke';
export const GITHUB_REPO = process.env.GITHUB_REPO_NAME || process.env.NEXT_PUBLIC_GITHUB_REPO_NAME || 'Schreibdienst';

export type VersionStatus = 'up-to-date' | 'update-available' | 'release-info-unavailable';

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
  sizeBytes: number | null;
  contentType: string | null;
}

export interface ReleaseSummary {
  version: string;
  name: string;
  publishedAt: string | null;
  url: string;
  notes: string;
  assets: ReleaseAsset[];
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

/**
 * Sucht in den Release-Assets nach dem Windows-Installer. Der CI-Workflow
 * (`.github/workflows/build-windows-injector.yml`) veröffentlicht die Datei
 * mit dem Namensmuster `schreibdienst-injector-setup-*.exe`. Fallback: jede
 * `.exe` mit `setup` oder `install` im Namen. Damit ist die Funktion auch
 * belastbar, wenn der Dateiname leicht variiert.
 */
export function findWindowsInstallerAsset(release: ReleaseSummary | null | undefined): ReleaseAsset | null {
  if (!release?.assets?.length) {
    return null;
  }

  const lower = (value: string) => value.toLowerCase();

  const explicit = release.assets.find((asset) =>
    lower(asset.name).startsWith('schreibdienst-injector-setup-')
  );
  if (explicit) {
    return explicit;
  }

  const setupLike = release.assets.find((asset) => {
    const name = lower(asset.name);
    return name.endsWith('.exe') && (name.includes('setup') || name.includes('install'));
  });
  if (setupLike) {
    return setupLike;
  }

  return release.assets.find((asset) => lower(asset.name).endsWith('.exe')) || null;
}