// /  — atomic, integrity-checked ZIP backup of the live DB
// ( slice 31).

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import {
  BACKUP_BUNDLE_SCHEMA_VERSION,
  ZIP_DB_ENTRY,
  ZIP_DEVICE_ID_ENTRY,
  ZIP_MANIFEST_ENTRY,
} from './constants.ts';
import { applySqlCipherKey } from './encryption.ts';
import { assertSqliteIntegrity } from './integrity.ts';
import type { BackupManifest, CreateBackupBundleArgs, CreateBackupBundleResult } from './types.ts';

/**
 * Produce an atomic, integrity-checked ZIP backup of the live DB.
 *
 * Throws when:
 * - `dbPath` does not exist or is unreadable.
 * - `db.backup()` fails (disk full, permission denied).
 * - `PRAGMA integrity_check` returns anything other than `'ok'`.
 *
 * Callers serialize backup lifecycle work, but do not need to stop normal
 * database traffic. SQLite's online backup path and encrypted VACUUM INTO
 * each produce a transactionally consistent snapshot while the integrity
 * check below pins the restore-readiness post-condition.
 */
export async function createBackupBundle(
  args: CreateBackupBundleArgs
): Promise<CreateBackupBundleResult> {
  const { dbPath, deviceIdPath, outZipPath, encryptionKey } = args;

  const stagingDir = await mkdtemp(join(tmpdir(), 'puntovivo-backup-'));
  const stagingDbPath = join(stagingDir, ZIP_DB_ENTRY);

  try {
    // flush the WAL into the main DB file BEFORE the online
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
