// best-effort sweep of stale backup/restore staging dirs left in
// the OS tmpdir by a crash or a quit mid-restore ( slice 31).

import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STAGING_PREFIXES } from './constants.ts';

/**
 * remove stale staging directories left in the OS tmpdir
 * by a crash, or by an app quit while a cross-device restore was
 * waiting for its key (the pending staging is deliberately kept
 * alive between needsKey and provideRestoreKey, so a quit in that
 * window orphans it). Runs best-effort at startup.
 *
 * Only directories carrying our mkdtemp prefixes AND older than
 * `maxAgeMs` are removed — the age guard ensures a staging owned by
 * a concurrently running instance is never swept. Per-entry failures
 * are swallowed (the OS tmp cleaner is the final backstop). Returns
 * the paths it removed so the caller can log them.
 */
export async function sweepStaleBackupStaging(
  maxAgeMs: number = 60 * 60 * 1000
): Promise<string[]> {
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(tmpdir());
  } catch {
    return removed;
  }
  const cutoffMs = Date.now() - maxAgeMs;
  for (const name of entries) {
    if (!STAGING_PREFIXES.some(prefix => name.startsWith(prefix))) continue;
    const fullPath = join(tmpdir(), name);
    try {
      const info = await stat(fullPath);
      if (!info.isDirectory() || info.mtimeMs > cutoffMs) continue;
      await rm(fullPath, { recursive: true, force: true });
      removed.push(fullPath);
    } catch {
      // Best-effort: a racing removal or permission oddity on one
      // entry must not abort the sweep of the rest.
    }
  }
  return removed;
}
