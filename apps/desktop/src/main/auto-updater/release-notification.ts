// .ts keeps this Electron-free module directly executable under node --test.
import { isNewerVersion } from '../version-compare.ts';

const REPO_OWNER = 'johnny4young';
const REPO_NAME = 'puntovivo';

export const REPO_SLUG = `${REPO_OWNER}/${REPO_NAME}`;

// Optional read-only token for internal builds. It is read from the runtime
// environment and is sent only to the fixed GitHub Releases endpoint below;
// distributed public builds do not embed credentials.
const UPDATE_READ_TOKEN = process.env.PUNTOVIVO_UPDATE_TOKEN || process.env.GH_TOKEN || undefined;
const RELEASE_FETCH_TIMEOUT_MS = 15_000;
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_ACCEPT = 'application/vnd.github+json';

export type LatestReleaseResult =
  | {
      kind: 'ok';
      version: string;
      name: string;
      notes: string | null;
      date: string | null;
      url: string;
    }
  | { kind: 'inaccessible' }
  | { kind: 'error'; message: string };

export interface ReleaseFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  token?: string;
}

interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
}

export function isNewerRelease(
  release: Extract<LatestReleaseResult, { kind: 'ok' }>,
  currentVersion: string
): boolean {
  return isNewerVersion(release.version, currentVersion);
}

export async function fetchLatestRelease(
  options: ReleaseFetchOptions = {}
): Promise<LatestReleaseResult> {
  const {
    fetchImpl = fetch,
    timeoutMs = RELEASE_FETCH_TIMEOUT_MS,
    token = UPDATE_READ_TOKEN,
  } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'puntovivo-desktop',
      Accept: GITHUB_ACCEPT,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetchImpl(`https://api.github.com/repos/${REPO_SLUG}/releases/latest`, {
      headers,
      signal: controller.signal,
    });

    // GitHub returns 404 (not 401/403) for a private repo the caller cannot see.
    if (response.status === 404) {
      return { kind: 'inaccessible' };
    }
    if (!response.ok) {
      return { kind: 'error', message: `GitHub API responded ${response.status}` };
    }

    const payload = (await response.json()) as GitHubReleasePayload;
    if (!payload.tag_name) {
      return { kind: 'error', message: 'malformed release payload (no tag_name)' };
    }

    return {
      kind: 'ok',
      version: payload.tag_name,
      name: payload.name || payload.tag_name,
      notes: payload.body || null,
      date: payload.published_at || null,
      url: payload.html_url || `https://github.com/${REPO_SLUG}/releases/latest`,
    };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}
