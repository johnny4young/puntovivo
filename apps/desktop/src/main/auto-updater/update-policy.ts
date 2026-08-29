/**
 * fixed-origin desktop update policy.
 *
 * The mutable GitHub Pages appcast says which release is active. This adjacent
 * JSON policy describes staged rollout intent, but it is never trusted to lower
 * a workstation's sealed version floor. A remote rollback therefore remains
 * visible to operators while the client refuses to install it; emergency
 * rollback uses a separately delivered manual installer.
 */

export const UPDATE_POLICY_URL = 'https://johnny4young.github.io/puntovivo/update-policy.json';
export const UPDATE_POLICY_TIMEOUT_MS = 5_000;

export type UpdateRolloutMode = 'normal' | 'rollback';
export type UpdateRolloutPercentage = 10 | 50 | 100;

export interface UpdatePolicy {
  schemaVersion: 1;
  mode: UpdateRolloutMode;
  targetVersion: string;
  rolloutPercentage: UpdateRolloutPercentage;
  publishedAt: string;
}

export type UpdatePolicyFetchResult =
  | { kind: 'ok'; policy: UpdatePolicy; checkedAt: string }
  | { kind: 'error'; message: string; checkedAt: string };

const POLICY_KEYS = [
  'mode',
  'publishedAt',
  'rolloutPercentage',
  'schemaVersion',
  'targetVersion',
] as const;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemanticVersion(version: string): ParsedVersion | null {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some(identifier => /^\d+$/.test(identifier) && /^0\d+/.test(identifier))) {
    return null;
  }
  return { major, minor, patch, prerelease };
}

/** SemVer precedence without a runtime dependency; throws on malformed input. */
export function compareUpdateVersions(left: string, right: string): number {
  const a = parseSemanticVersion(left);
  const b = parseSemanticVersion(right);
  if (!a || !b) throw new Error('update version must be semantic');

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = a.prerelease[index];
    const rightIdentifier = b.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      if (leftIdentifier.length !== rightIdentifier.length) {
        return leftIdentifier.length < rightIdentifier.length ? -1 : 1;
      }
      return leftIdentifier < rightIdentifier ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strictly validate the public policy before it can affect downgrade logic. */
export function parseUpdatePolicy(value: unknown): UpdatePolicy {
  if (!isRecord(value)) {
    throw new Error('update policy must be an object');
  }

  const keys = Object.keys(value).sort();
  if (keys.length !== POLICY_KEYS.length || keys.some((key, index) => key !== POLICY_KEYS[index])) {
    throw new Error('update policy has an unexpected shape');
  }
  if (value.schemaVersion !== 1) {
    throw new Error('update policy schemaVersion must be 1');
  }
  if (value.mode !== 'normal' && value.mode !== 'rollback') {
    throw new Error('update policy mode must be normal or rollback');
  }
  if (typeof value.targetVersion !== 'string' || !SEMVER_PATTERN.test(value.targetVersion)) {
    throw new Error('update policy targetVersion must be semantic');
  }
  if (
    value.rolloutPercentage !== 10 &&
    value.rolloutPercentage !== 50 &&
    value.rolloutPercentage !== 100
  ) {
    throw new Error('update policy rolloutPercentage must be 10, 50, or 100');
  }
  if (value.mode === 'rollback' && value.rolloutPercentage !== 100) {
    throw new Error('rollback update policy must target 100 percent');
  }
  const publishedAtMs =
    typeof value.publishedAt === 'string' ? Date.parse(value.publishedAt) : Number.NaN;
  if (
    typeof value.publishedAt !== 'string' ||
    !Number.isFinite(publishedAtMs) ||
    new Date(publishedAtMs).toISOString() !== value.publishedAt
  ) {
    throw new Error('update policy publishedAt must be an ISO timestamp');
  }

  return {
    schemaVersion: 1,
    mode: value.mode,
    targetVersion: value.targetVersion,
    rolloutPercentage: value.rolloutPercentage,
    publishedAt: value.publishedAt,
  };
}

/**
 * The mutable policy may narrow normal rollout, but it can never authorize a
 * downgrade. Every automatic candidate must also meet the sealed device floor.
 */
export function isCandidateAllowedByPolicy(
  policy: UpdatePolicy | null,
  candidateVersion: string,
  floorVersion: string
): boolean {
  try {
    return (
      policy?.mode !== 'rollback' && compareUpdateVersions(candidateVersion, floorVersion) >= 0
    );
  } catch {
    return false;
  }
}

export async function fetchUpdatePolicy(
  options: {
    fetchImpl?: typeof fetch;
    now?: () => Date;
    timeoutMs?: number;
    url?: string;
  } = {}
): Promise<UpdatePolicyFetchResult> {
  const {
    fetchImpl = fetch,
    now = () => new Date(),
    timeoutMs = UPDATE_POLICY_TIMEOUT_MS,
    url = UPDATE_POLICY_URL,
  } = options;
  const checkedDate = now();
  const checkedAt = checkedDate.toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const requestUrl = new URL(url);
    // Match electron-updater's cache-busting appcast request so a rollback
    // policy and its feed cannot drift behind different CDN cache entries.
    requestUrl.searchParams.set('noCache', String(checkedDate.getTime()));
    const response = await fetchImpl(requestUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      return { kind: 'error', message: `policy HTTP ${response.status}`, checkedAt };
    }

    return {
      kind: 'ok',
      policy: parseUpdatePolicy(await response.json()),
      checkedAt,
    };
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'unknown update policy error',
      checkedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}
