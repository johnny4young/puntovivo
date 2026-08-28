// /  — atomic, integrity-checked ZIP backup of the live DB
// ( slice 31).

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { BACKUP_BUNDLE_SCHEMA_VERSION, ZIP_DB_ENTRY } from './constants.ts';
import { computeBackupManifestMac, sha256HexOf, sha256HexOfFile } from './authenticity.ts';
import { writeBackupArchive } from './archive.ts';
import { applySqlCipherKey } from './encryption.ts';
import { assertSqliteIntegrity } from './integrity.ts';
import { wrapBackupKey } from './key-wrap.ts';
import { applyBoundedBackupResources } from './resource-limits.ts';
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
  args.signal?.throwIfAborted();

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
    applyBoundedBackupResources(checkpointer);
    checkpointer.pragma('busy_timeout = 5000');
    checkpointer.pragma('synchronous = FULL');
    try {
      checkpointer.pragma('wal_checkpoint(FULL)');
    } finally {
      checkpointer.close();
    }
    args.signal?.throwIfAborted();

    // Open the LIVE DB read-only for the online backup. better-sqlite3
    // will OPEN_READONLY + attach to the (now flushed) WAL transparently
    // for cleartext DBs. SQLite3MultipleCiphers rejects the backup API
    // when source and target cipher configs differ, so encrypted DBs use
    // VACUUM INTO from a keyed connection, which produces an encrypted
    // destination with the same SQLCipher v4 key.
    const sourceDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    applySqlCipherKey(sourceDb, encryptionKey);
    applyBoundedBackupResources(sourceDb);
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
    args.signal?.throwIfAborted();

    // Hash the immutable snapshot through a bounded file stream. SQLCipher
    // databases routinely reach hundreds of MiB, so retaining their bytes in
    // the JS heap is both unnecessary and a desktop-process availability risk.
    const dbStat = await stat(stagingDbPath);
    const dbSha256 = await sha256HexOfFile(stagingDbPath);

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

    // The wrap is built BEFORE the manifest so its digest joins the
    // MAC'd payload — an unsigned wrap would be strippable/replaceable
    // without tripping verification.
    const keyWrapJson =
      args.passphrase !== undefined && encryptionKey !== undefined
        ? JSON.stringify(
            await wrapBackupKey(encryptionKey, args.passphrase, { signal: args.signal })
          )
        : undefined;
    args.signal?.throwIfAborted();

    const manifest: BackupManifest = {
      schemaVersion: BACKUP_BUNDLE_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      ...args.manifest,
      dbBytes: dbStat.size,
      // Payload digests bind the archive bytes to the manifest...
      dbSha256,
      ...(deviceIdBuffer ? { deviceIdSha256: sha256HexOf(deviceIdBuffer) } : {}),
      ...(keyWrapJson !== undefined
        ? { keyWrapSha256: sha256HexOf(Buffer.from(keyWrapJson, 'utf8')) }
        : {}),
    };
    // ...and the MAC binds the manifest to whoever holds the bundle's
    // restore key. Cleartext dev bundles have no key and stay
    // unauthenticated (they also carry no confidentiality).
    if (encryptionKey !== undefined) {
      manifest.manifestMac = computeBackupManifestMac(manifest, encryptionKey);
    }

    const { zipBytes } = await writeBackupArchive({
      outZipPath,
      dbPath: stagingDbPath,
      deviceId: deviceIdBuffer,
      manifestJson: JSON.stringify(manifest, null, 2),
      keyWrapJson,
      signal: args.signal,
    });

    return {
      zipPath: outZipPath,
      zipBytes,
      manifest,
    };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}
