/**
 * ENG-167b — one-shot first-boot migration of pre-encryption
 * cleartext databases to SQLCipher.
 *
 * ENG-167 Step-1 (2026-05-25) made every NEW install encrypted, but
 * an install that predates it still carries a cleartext `local.db`.
 * Booting the upgraded build against it with a key would fail at the
 * first read (SQLITE_NOTADB), bricking the app — which is exactly
 * why the ROADMAP gated the production rollout of Step-1 on this
 * module. The migration is silent (AUDIT-2026-05-24 §ENG-167
 * prescription): detect → checkpoint → backup → rekey in place →
 * verify → drop the backup.
 *
 * Crash-safety contract:
 *   - A `.pre-encryption.bak` copy is taken BEFORE the in-place
 *     rekey. If the process dies mid-rewrite, the next boot detects
 *     the (now unreadable-header) target, fails integrity, restores
 *     the .bak, and throws — the app never starts on a half-written
 *     database.
 *   - On SUCCESS the .bak is DELETED: leaving a cleartext copy on
 *     disk would bypass the at-rest threat model the migration
 *     exists to enforce (see docs/SECURITY.md).
 *
 * The module is pure (injected logger, no Electron imports) so it is
 * unit-testable under `node --test` with real database files.
 */

import { access, copyFile, rm } from 'node:fs/promises';
import Database from 'better-sqlite3';
import {
  assertSqliteIntegrity,
  isCleartextSqliteFile,
  rekeySqliteDatabase,
} from './backup/backup-bundle.ts';

/** Minimal structured-logger surface the migration emits through. */
export interface MigrationLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Arguments for {@link migrateCleartextDatabase}.
 * `skipReason` short-circuits the whole migration (the dev-shared
 * DATABASE_URL database is already encrypted with the fixed dev key
 * and must never be touched); when set, the outcome is 'skipped'.
 */
export interface MigrateDbEncryptionArgs {
  dbPath: string;
  /** 64-char hex SQLCipher key the file must end up encrypted with. */
  encryptionKey: string;
  skipReason?: string | undefined;
  log: MigrationLogger;
  /**
   * How long the pre-copy WAL checkpoint waits for concurrent
   * readers/writers to clear before giving up (test seam; production
   * keeps the 5s default).
   */
  checkpointBusyTimeoutMs?: number | undefined;
}

/**
 * Outcome of a migration attempt. Every boot lands on exactly one:
 *   - 'skipped' — dev-shared DB route, never touched.
 *   - 'no-database' — fresh install; Step-1 creates it encrypted.
 *   - 'already-encrypted' — the steady state after the first
 *     migrated boot (and for post-Step-1 installs).
 *   - 'migrated' — the one-shot path actually ran.
 */
export type MigrationOutcome =
  | 'skipped'
  | 'no-database'
  | 'already-encrypted'
  | 'migrated';

/** Sidecar suffixes SQLite leaves next to a WAL-mode database. */
const SIDECAR_SUFFIXES = ['-wal', '-shm'] as const;

function backupPathFor(dbPath: string): string {
  return `${dbPath}.pre-encryption.bak`;
}

/**
 * Migrate a pre-encryption cleartext database to SQLCipher, in
 * place, exactly once. Idempotent across boots: encrypted or absent
 * databases are no-ops. Throws (after restoring the cleartext
 * backup) when the rekey or its integrity verification fails — the
 * caller must treat that as a fatal boot error rather than starting
 * the server on an inconsistent file.
 */
export async function migrateCleartextDatabase(
  args: MigrateDbEncryptionArgs
): Promise<MigrationOutcome> {
  const { dbPath, encryptionKey, skipReason, log, checkpointBusyTimeoutMs = 5000 } = args;

  if (skipReason) {
    log.info({ dbPath, skipReason }, 'db encryption migration skipped');
    return 'skipped';
  }

  let cleartext: boolean;
  try {
    cleartext = await isCleartextSqliteFile(dbPath);
  } catch (err) {
    // Unreadable file (permissions, IO): surface it — the server
    // boot would fail on the same file anyway, with a worse message.
    log.error({ dbPath, err }, 'db encryption migration: cannot inspect database');
    throw err;
  }

  if (!cleartext) {
    const exists = await fileExists(dbPath);
    if (!exists) {
      // Fresh install — initDatabase creates it encrypted.
      return 'no-database';
    }
    // Unreadable header: either a healthy SQLCipher file (the steady
    // state) or the residue of a PREVIOUS migration attempt that
    // crashed mid-rekey. The `.pre-encryption.bak` left behind is the
    // tell: when it exists, verify the target actually opens with the
    // key; if it does not, restore the cleartext copy and fall through
    // to a fresh migration attempt. Without this recovery a mid-rekey
    // crash would brick every subsequent boot (the file looks
    // encrypted but no key opens it).
    const bakPath = backupPathFor(dbPath);
    if (await fileExists(bakPath)) {
      try {
        await assertSqliteIntegrity(dbPath, { encryptionKey });
        // The previous attempt actually completed; only the .bak
        // cleanup was lost. Finish it.
        log.warn({ dbPath, bakPath }, 'db encryption migration: completed earlier; removing stale cleartext backup');
        await rm(bakPath, { force: true });
        return 'already-encrypted';
      } catch {
        log.warn(
          { dbPath, bakPath },
          'db encryption migration: previous attempt crashed mid-rekey; restoring the cleartext backup and retrying'
        );
        await copyFile(bakPath, dbPath);
        await rm(bakPath, { force: true });
        if (!(await isCleartextSqliteFile(dbPath))) {
          throw new Error(
            `Database encryption migration found an interrupted previous attempt and could not ` +
              `recover a usable cleartext copy from ${bakPath}. Restore from a backup.`
          );
        }
        // Recovered: continue into the normal migration path below.
      }
    } else {
      return 'already-encrypted';
    }
  }

  const startedAt = Date.now();
  const bakPath = backupPathFor(dbPath);
  log.info({ dbPath, bakPath }, 'db encryption migration: cleartext database detected');

  // 1. Flush + truncate the WAL on a keyless connection so the main
  //    file carries every committed page before the in-place rewrite.
  //    UNLIKE the ENG-174 checkpoint in createBackupBundle — where a
  //    partial checkpoint is tolerable because db.backup() captures
  //    the leftover WAL frames anyway — the .bak here is a raw
  //    copyFile of the MAIN file only. A partial checkpoint
  //    (busy = 1: a concurrent connection held the WAL lock past
  //    busy_timeout) would silently drop committed frames from the
  //    safety copy, so it must abort the migration BEFORE anything
  //    is touched (nothing has been written yet; the boot fails loud
  //    and a retry without the contender succeeds).
  const checkpointer = new Database(dbPath, { fileMustExist: true });
  try {
    checkpointer.pragma(`busy_timeout = ${Math.trunc(checkpointBusyTimeoutMs)}`);
    const rows = checkpointer.pragma('wal_checkpoint(TRUNCATE)') as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    const result = rows[0];
    if (!result || result.busy !== 0) {
      throw new Error(
        `Database encryption migration aborted: the WAL checkpoint could not complete ` +
          `(another process is holding the database at ${dbPath}). ` +
          `Close other instances of the app and retry the launch.`
      );
    }
  } finally {
    checkpointer.close();
  }

  // 2. Cleartext safety copy. Exists only for the duration of the
  //    migration; deleted on success (see module doc).
  await copyFile(dbPath, bakPath);

  try {
    // 3. Encrypt in place + 4. verify with the final key.
    rekeySqliteDatabase(dbPath, { toKey: encryptionKey });
    await assertSqliteIntegrity(dbPath, { encryptionKey });
  } catch (err) {
    // Restore the cleartext copy so the install is exactly where it
    // was before the attempt, then abort the boot loudly.
    log.error({ dbPath, err }, 'db encryption migration failed; restoring cleartext backup');
    await copyFile(bakPath, dbPath);
    await rm(bakPath, { force: true });
    throw new Error(
      `Database encryption migration failed and the original cleartext database was restored. ` +
        `The app did not start to avoid running on an inconsistent file. ` +
        `Retry the launch; if it fails again, restore from a backup. Cause: ${
          err instanceof Error ? err.message : String(err)
        }`,
      { cause: err }
    );
  }

  // 5. Success: drop the cleartext copy and any stale sidecars from
  //    the pre-migration WAL (checkpoint TRUNCATE already emptied
  //    the WAL; the files themselves are now meaningless).
  await rm(bakPath, { force: true });
  for (const suffix of SIDECAR_SUFFIXES) {
    await rm(`${dbPath}${suffix}`, { force: true });
  }

  log.info(
    { dbPath, durationMs: Date.now() - startedAt },
    'db encryption migration: database encrypted and verified'
  );
  return 'migrated';
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
