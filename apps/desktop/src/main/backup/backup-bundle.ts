/**
 * ENG-066 — Backup bundle helpers.
 *
 * Closes the gap between the legacy `copyFile(DB_PATH, ...)` backup
 * (crash-inconsistent under WAL mode) and a proper atomic snapshot
 * that bundles the live DB + the device identity file.
 *
 * Design:
 *
 *   - **Backup**: open `local.db` via `better-sqlite3` and call
 *     `db.backup(tmpPath)`. SQLite's online backup API copies the
 *     live DB atomically while readers + writers continue, producing
 *     a single-file consistent snapshot — no WAL/SHM sidecars, no
 *     crash-inconsistency. Then run `PRAGMA integrity_check` against
 *     the temp file. If `'ok'`, package the temp DB + the
 *     `device-id.txt` into a ZIP at the operator-chosen path.
 *
 *   - **Restore**: detect format by reading the first four bytes.
 *     ZIP magic = `50 4b 03 04`. SQLite magic = `53 51 4c 69` ("SQLi"
 *     from the "SQLite format 3" header). For ZIP: extract `local.db`
 *     + `device-id.txt` to a temp dir. For raw `.db`: hand the source
 *     path back. The IPC restore handler then runs `PRAGMA integrity_check`
 *     with the local key, the cleartext fallback, or the operator-supplied
 *     source key before swapping anything into the live location.
 *
 * The helpers are PURE — no Electron / IPC dependencies — so they're
 * unit-testable via `node --test`.
 *
 * @module main/backup/backup-bundle
 */

import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';

/** Path inside the ZIP for the SQLite snapshot. */
export const ZIP_DB_ENTRY = 'local.db';
/** Path inside the ZIP for the device identity. */
export const ZIP_DEVICE_ID_ENTRY = 'device-id.txt';
/** Path inside the ZIP for the backup manifest (metadata only). */
export const ZIP_MANIFEST_ENTRY = 'manifest.json';

/** Schema version of the ZIP manifest layout. Bump on shape change. */
export const BACKUP_BUNDLE_SCHEMA_VERSION = 1;

export interface BackupManifest {
  schemaVersion: number;
  generatedAt: string;
  /** Desktop app version that produced the backup, when available. */
  appVersion?: string;
  /**
   * Optional tenant slug embedded by callers that have it on hand.
   * Used in the default filename + audit trail; the manifest carries
   * it so support can verify the bundle's tenant before restoring.
   */
  tenantSlug?: string;
  /** Number of bytes in the snapshotted DB before zipping. */
  dbBytes: number;
}

export interface CreateBackupBundleArgs {
  /** Live DB path. The function reads it; never writes. */
  dbPath: string;
  /** Optional device-id file path. Bundled when present + readable. */
  deviceIdPath?: string;
  /** Destination ZIP path. Overwritten if it exists. */
  outZipPath: string;
  /** Optional metadata for the manifest entry. */
  manifest?: Partial<BackupManifest>;
  /**
   * ENG-167 — SQLCipher key for encrypted local.db files. When supplied,
   * every read connection applies SQLCipher v4 before touching the file,
   * and the staged backup DB remains encrypted with the same key.
   */
  encryptionKey?: string;
}

export interface CreateBackupBundleResult {
  zipPath: string;
  zipBytes: number;
  manifest: BackupManifest;
}

function assertEncryptionKeyShape(key: string): void {
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error('encryptionKey must be a 64-character hex string');
  }
}

function applySqlCipherKey(db: Database.Database, encryptionKey?: string): void {
  if (encryptionKey === undefined) {
    return;
  }
  assertEncryptionKeyShape(encryptionKey);
  db.pragma("cipher = 'sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(`key = "x'${encryptionKey}'"`);
}

/**
 * Produce an atomic, integrity-checked ZIP backup of the live DB.
 *
 * Throws when:
 *   - `dbPath` does not exist or is unreadable.
 *   - `db.backup()` fails (disk full, permission denied).
 *   - `PRAGMA integrity_check` returns anything other than `'ok'`.
 *
 * The caller is responsible for stopping any active write traffic
 * before invoking (e.g. `runWithServerRestart`); the online backup
 * API is robust to concurrent writes but stopping the server keeps
 * the post-backup consistency invariant simpler to reason about.
 */
export async function createBackupBundle(
  args: CreateBackupBundleArgs
): Promise<CreateBackupBundleResult> {
  const { dbPath, deviceIdPath, outZipPath, encryptionKey } = args;

  const stagingDir = await mkdtemp(join(tmpdir(), 'puntovivo-backup-'));
  const stagingDbPath = join(stagingDir, ZIP_DB_ENTRY);

  try {
    // ENG-174 — flush the WAL into the main DB file BEFORE the online
    // backup snapshots the bytes. Without this, a power loss between
    // when the backup resolves and when the OS finishes flushing the
    // bundle ZIP to disk could leave the .db file and its .db-wal
    // sidecar out of sync, and the integrity_check below would still
    // report a corrupt restore.
    //
    // The checkpoint requires write access to the .db file (it copies
    // frames from the WAL into the main file), so we open a separate
    // writable connection ONLY for the PRAGMA and close it before
    // opening the readonly reader the online backup runs against. A
    // partial checkpoint (busy > 0 because a concurrent writer held
    // the WAL lock past busy_timeout) does not abort the backup — the
    // WAL frames left behind are still safely captured by db.backup()
    // under SQLite's online backup API; the integrity_check
    // post-condition is what guarantees the restore is usable. The
    // module stays pure (no logger) so the caller can decide whether
    // to surface the partial result via its own observability stack.
    const checkpointer = new Database(dbPath, { fileMustExist: true });
    applySqlCipherKey(checkpointer, encryptionKey);
    checkpointer.pragma('busy_timeout = 5000');
    checkpointer.pragma('synchronous = FULL');
    try {
      checkpointer.pragma('wal_checkpoint(FULL)');
    } finally {
      checkpointer.close();
    }

    // Open the LIVE DB read-only for the online backup. better-sqlite3
    // will OPEN_READONLY + attach to the (now flushed) WAL transparently
    // for cleartext DBs. SQLite3MultipleCiphers rejects the backup API
    // when source and target cipher configs differ, so encrypted DBs use
    // VACUUM INTO from a keyed connection, which produces an encrypted
    // destination with the same SQLCipher v4 key.
    const sourceDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    applySqlCipherKey(sourceDb, encryptionKey);
    try {
      if (encryptionKey === undefined) {
        await sourceDb.backup(stagingDbPath);
      } else {
        sourceDb.prepare('VACUUM INTO ?').run(stagingDbPath);
      }
    } finally {
      sourceDb.close();
    }

    // Integrity-check the staging file BEFORE we promise the operator
    // a usable backup. PRAGMA integrity_check returns 'ok' on success
    // or one or more error rows on corruption.
    await assertSqliteIntegrity(stagingDbPath, { encryptionKey });

    // Read DB bytes for the manifest.
    const dbBuffer = await readFile(stagingDbPath);

    // Optional device-id passenger.
    let deviceIdBuffer: Buffer | undefined;
    if (deviceIdPath) {
      try {
        deviceIdBuffer = await readFile(deviceIdPath);
      } catch (err) {
        const errno = (err as NodeJS.ErrnoException).code;
        if (errno !== 'ENOENT') throw err;
        // Device-id missing is acceptable on a fresh install; skip.
      }
    }

    const manifest: BackupManifest = {
      schemaVersion: BACKUP_BUNDLE_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      ...args.manifest,
      dbBytes: dbBuffer.byteLength,
    };

    const zip = new JSZip();
    zip.file(ZIP_DB_ENTRY, dbBuffer);
    if (deviceIdBuffer) {
      zip.file(ZIP_DEVICE_ID_ENTRY, deviceIdBuffer);
    }
    zip.file(ZIP_MANIFEST_ENTRY, JSON.stringify(manifest, null, 2));

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    await writeFile(outZipPath, zipBuffer);

    return {
      zipPath: outZipPath,
      zipBytes: zipBuffer.byteLength,
      manifest,
    };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

/**
 * Detect whether the file at `path` is a backup ZIP, a raw SQLite
 * file, or unrecognized. Reads the first 4 bytes only.
 */
export async function detectBackupFormat(
  path: string
): Promise<'zip' | 'sqlite' | 'unknown'> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, 'r');
    const buf = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buf, 0, 16, 0);
    if (bytesRead < 4) return 'unknown';
    // ZIP local-file header: 50 4b 03 04
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
      return 'zip';
    }
    // SQLite header magic: "SQLite format 3\0"
    if (
      buf[0] === 0x53 &&
      buf[1] === 0x51 &&
      buf[2] === 0x4c &&
      buf[3] === 0x69
    ) {
      return 'sqlite';
    }
    return 'unknown';
  } finally {
    if (handle) await handle.close();
  }
}

/**
 * ENG-167b — is the file a readable-header (CLEARTEXT) SQLite DB?
 *
 * A pre-encryption database keeps the plain "SQLite format 3\0"
 * magic in its first bytes; a SQLCipher database encrypts page 1
 * including the header, so `detectBackupFormat` reports 'unknown'
 * for it. This makes cleartext detection a pure 16-byte read — no
 * connection, no key, fully deterministic. Returns false for
 * missing files (a fresh install has nothing to migrate).
 */
export async function isCleartextSqliteFile(path: string): Promise<boolean> {
  try {
    return (await detectBackupFormat(path)) === 'sqlite';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/**
 * ENG-167b — re-encrypt a SQLite database IN PLACE to `toKey`.
 *
 * Two callers, one contract:
 *   - First-boot migration: `fromKey` undefined (cleartext source)
 *     → the file ends up SQLCipher-v4-encrypted under the install key.
 *   - Cross-device restore: `fromKey` = the SOURCE device's key →
 *     the staged file is rekeyed to THIS device's key so every
 *     install keeps exactly one key envelope.
 *
 * `PRAGMA rekey` rewrites every page under the new key (verified
 * empirically against better-sqlite3-multiple-ciphers 12.10: the
 * header becomes unreadable and keyless opens fail SQLITE_NOTADB).
 * The caller is responsible for crash-safety around the in-place
 * rewrite (the migration keeps a .bak; the restore works on a
 * staging copy), and MUST run `assertSqliteIntegrity` with `toKey`
 * afterwards before trusting the file.
 */
export function rekeySqliteDatabase(
  dbPath: string,
  options: { fromKey?: string | undefined; toKey: string }
): void {
  assertEncryptionKeyShape(options.toKey);
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.pragma("cipher = 'sqlcipher'");
    db.pragma('legacy = 4');
    if (options.fromKey !== undefined) {
      assertEncryptionKeyShape(options.fromKey);
      db.pragma(`key = "x'${options.fromKey}'"`);
    }
    db.pragma(`rekey = "x'${options.toKey}'"`);
  } finally {
    db.close();
  }
}

/**
 * ENG-167b — staging-directory prefixes this module family creates
 * under the OS tmpdir (`createBackupBundle` and the restore flow in
 * the desktop main, respectively).
 */
const STAGING_PREFIXES = ['puntovivo-backup-', 'puntovivo-restore-'] as const;

/**
 * ENG-167b — remove stale staging directories left in the OS tmpdir
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

// ENG-179b — explicit `| undefined` on optional fields.
export interface ExtractBackupBundleResult {
  /** Path of the extracted (or as-is) DB file. */
  dbPath: string;
  /** Path of the extracted device-id, if the bundle carried one. */
  deviceIdPath?: string | undefined;
  /** Parsed manifest, when the bundle is a ZIP carrying one. */
  manifest?: BackupManifest | undefined;
  /** Format detected at the boundary. */
  format: 'zip' | 'sqlite';
}

/**
 * Extract a backup ZIP into `outDir` (created), or for legacy raw
 * `.db` files just confirm the path is a SQLite file. In both cases,
 * the returned `dbPath` MUST be passed through `assertSqliteIntegrity`
 * before swapping into the live location.
 *
 * Throws on:
 *   - Unknown file format (not ZIP, not SQLite header).
 *   - ZIP missing the required `local.db` entry.
 *   - Manifest entry that doesn't parse as JSON (warning-level —
 *     manifest is informational; we still return the dbPath).
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

/**
 * Open `dbPath` read-only and run `PRAGMA integrity_check`. Throws
 * with a stable error message when the DB is corrupted, truncated,
 * or otherwise unreadable. Returns `void` on success.
 *
 * The error message is kept generic so callers can wrap it in a
 * translated user-facing string without coupling to SQLite internals.
 */
// ENG-179b — explicit `| undefined` on optional fields.
export async function assertSqliteIntegrity(
  dbPath: string,
  options: { encryptionKey?: string | undefined } = {}
): Promise<void> {
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    applySqlCipherKey(db, options.encryptionKey);
    const rows = db.prepare('PRAGMA integrity_check').all() as Array<{
      integrity_check?: string;
    }>;
    const ok = rows.length === 1 && rows[0]?.integrity_check === 'ok';
    if (!ok) {
      const messages = rows
        .map(r => r.integrity_check ?? '')
        .filter(Boolean)
        .join('; ');
      throw new Error(
        `Backup integrity check failed${messages ? `: ${messages}` : ''}`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Backup integrity check failed')) {
      throw err;
    }
    // Wrap any open / read error in the same shape so callers don't
    // have to distinguish between "the file isn't SQLite" and "the
    // file is SQLite but corrupted".
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Backup integrity check failed: ${reason}`, { cause: err });
  } finally {
    if (db) db.close();
  }
}

/**
 * Build the canonical backup filename. Includes the tenant slug
 * (when supplied) + an ISO-style timestamp so files sort
 * chronologically AND carry tenant context — handy when a support
 * ticket has multiple backups attached.
 */
export function createBackupFileName(args?: {
  tenantSlug?: string;
  now?: Date;
}): string {
  const now = args?.now ?? new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const slugSegment = args?.tenantSlug
    ? `-${args.tenantSlug.replace(/[^a-z0-9-]/gi, '-')}`
    : '';
  return `puntovivo-backup${slugSegment}-${timestamp}.zip`;
}
