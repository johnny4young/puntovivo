/**
 * Minimal semantic-version comparison for the auto-updater's notify-only mode.
 *
 * Kept free of any `electron` import so it can be unit-tested with `node --test`
 * (mirroring window-config.ts / external-url-policy.ts). Only the subset the
 * updater needs is implemented: compare a GitHub release `tag_name` against the
 * running `app.getVersion()` to decide whether to notify.
 *
 * @module main/version-compare
 */

/** A parsed `MAJOR.MINOR.PATCH[-pre]` version. */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release suffix (e.g. "beta.1"), or null for a stable release. */
  pre: string | null;
}

/**
 * Parse a `MAJOR.MINOR.PATCH[-pre]` version, tolerating a leading `v`
 * (GitHub tags are often `v1.2.3`). Returns null for anything that does not
 * match so callers fail closed (treat as "not newer").
 */
export function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? null,
  };
}

/**
 * True when `candidate` is a strictly newer release than `current`.
 *
 * A stable release outranks a same-core pre-release; two pre-releases of the
 * same core are NOT considered newer (avoids notification churn). Unparseable
 * input on either side is treated as "not newer", so a malformed tag never
 * triggers a false update prompt.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (!next || !now) {
    return false;
  }
  if (next.major !== now.major) return next.major > now.major;
  if (next.minor !== now.minor) return next.minor > now.minor;
  if (next.patch !== now.patch) return next.patch > now.patch;
  if (next.pre && !now.pre) return false; // stable current beats pre candidate
  if (!next.pre && now.pre) return true; // stable candidate beats pre current
  return false;
}
