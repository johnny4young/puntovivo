// /  — extract a backup ZIP (or pass a legacy raw .db through)
// with the restore-boundary entry allowlist ( slice 31).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import JSZip from 'jszip';
import {
  ALLOWED_ZIP_ENTRIES,
  ZIP_DB_ENTRY,
  ZIP_DEVICE_ID_ENTRY,
  ZIP_MANIFEST_ENTRY,
} from './constants.ts';
import { detectBackupFormat } from './detect.ts';
import type { BackupManifest, ExtractBackupBundleResult } from './types.ts';

/**
 * Extract a backup ZIP into `outDir` (created), or for legacy raw
 * `.db` files just confirm the path is a SQLite file. In both cases,
 * the returned `dbPath` MUST be passed through `assertSqliteIntegrity`
 * before swapping into the live location.
 *
 * Throws on:
 * - Unknown file format (not ZIP, not SQLite header).
 * - ZIP missing the required `local.db` entry.
 * - Manifest entry that doesn't parse as JSON (warning-level —
 * manifest is informational; we still return the dbPath).
 */
export async function extractBackupBundle(
  bundlePath: string,
  outDir: string
): Promise<ExtractBackupBundleResult> {
  const format = await detectBackupFormat(bundlePath);

  if (format === 'unknown') {
    throw new Error(
      'Backup file format is unrecognized. Expected a Puntovivo ZIP backup or a SQLite database.'
    );
  }

  if (format === 'sqlite') {
    // Legacy raw .db backups land here. Just hand the path back.
    return { dbPath: bundlePath, format: 'sqlite' };
  }

  // ZIP path.
  await mkdir(outDir, { recursive: true });
  const zipBuffer = await readFile(bundlePath);
  const zip = await JSZip.loadAsync(zipBuffer);

  // gate the whole archive against an allowlist BEFORE writing
  // anything to disk. We only ever extract the three constant-named
  // entries by name (so a `../evil` entry was already never written),
  // but refusing the bundle outright turns a silent ignore into an
  // explicit, testable rejection and stops a malformed/hostile ZIP from
  // reaching the integrity check.
  for (const [entryName, entry] of Object.entries(zip.files)) {
    // JSZip sanitises zip-slip names during load (for example
    // `../local.db` may appear as `local.db`) and preserves the raw
    // archive name on `unsafeOriginalName`. Validate both names so a
    // crafted archive cannot hide traversal behind an allowlisted
    // sanitized key.
    const originalName = (entry as { unsafeOriginalName?: string }).unsafeOriginalName ?? entryName;
    const candidateNames = new Set([entryName, originalName]);
    for (const candidateName of candidateNames) {
      if (
        candidateName.includes('..') ||
        candidateName.startsWith('/') ||
        candidateName.includes('\\') ||
        isAbsolute(candidateName)
      ) {
        throw new Error(
          `Backup ZIP rejected: entry '${originalName}' uses a path-traversal or absolute path. The file is not a trusted Puntovivo backup.`
        );
      }
    }
    if (!ALLOWED_ZIP_ENTRIES.has(entryName) || !ALLOWED_ZIP_ENTRIES.has(originalName)) {
      throw new Error(
        `Backup ZIP rejected: unexpected entry '${originalName}'. A Puntovivo backup may only contain ${[
          ...ALLOWED_ZIP_ENTRIES,
        ].join(', ')}.`
      );
    }
  }

  const dbEntry = zip.file(ZIP_DB_ENTRY);
  if (!dbEntry) {
    throw new Error(
      `Backup ZIP is missing the required '${ZIP_DB_ENTRY}' entry. The file is not a Puntovivo backup.`
    );
  }
  const dbBuffer = await dbEntry.async('nodebuffer');
  const dbPath = join(outDir, ZIP_DB_ENTRY);
  await writeFile(dbPath, dbBuffer);

  let deviceIdPath: string | undefined;
  const deviceIdEntry = zip.file(ZIP_DEVICE_ID_ENTRY);
  if (deviceIdEntry) {
    const deviceIdBuffer = await deviceIdEntry.async('nodebuffer');
    deviceIdPath = join(outDir, ZIP_DEVICE_ID_ENTRY);
    await writeFile(deviceIdPath, deviceIdBuffer);
  }

  let manifest: BackupManifest | undefined;
  const manifestEntry = zip.file(ZIP_MANIFEST_ENTRY);
  if (manifestEntry) {
    try {
      const text = await manifestEntry.async('string');
      manifest = JSON.parse(text) as BackupManifest;
    } catch {
      // Informational only — don't fail the restore on a bad manifest.
    }
  }

  return { dbPath, deviceIdPath, manifest, format: 'zip' };
}
