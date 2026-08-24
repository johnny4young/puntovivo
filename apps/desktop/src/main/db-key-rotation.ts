/**
 * SQLCipher key rotation for the embedded database.
 *
 * The rotation runs OFFLINE — the caller stops the embedded server
 * first (the backup/restore `restartAround` choreography) so no open
 * handle sees the page rewrite. The write order is crash-safe at
 * every step and idempotent on recovery:
 *
 *  1. Checkpoint-TRUNCATE the WAL under the current key, aborting if
 *     another connection blocks it — the safety copy in step 3 is a
 *     raw copy of the MAIN file only, so leftover WAL frames would
 *     silently vanish from the rollback (same rule as the cleartext
 *     migration's copy).
 *  2. Seal the NEW key into a staged envelope `.dbkey.enc.next`
 *     (atomic write-then-rename, 0600) BEFORE touching the DB. From
 *     this point the new key can always be recovered from disk.
 *  3. Copy the DB to `<db>.pre-rotation.bak` — `PRAGMA rekey`
 *     rewrites pages in place, so a mid-rewrite crash can corrupt
 *     the live file; the copy is the rollback.
 *  4. `PRAGMA rekey` old → new, then a full integrity check under
 *     the new key.
 *  5. Promote the staged envelope over the canonical `.dbkey.enc`
 *     (atomic rename) — the old key ceases to exist.
 *  6. Delete the `.bak` (its pages are keyed to the destroyed old
 *     key; keeping it would retain data under a retired key).
 *
 * Boot-time recovery (`resolvePendingDbKeyRotation`) converges any
 * interrupted state BEFORE `getOrCreateDbKey` runs. It is deliberately
 * paranoid about deletion: nothing is removed until the live DB has
 * been PROVEN to open under a known key, and an unusable keychain
 * (locked keyring at login, DPAPI profile not loaded) aborts the boot
 * with everything left in place for the next attempt — a transient
 * decrypt failure must never discard the only copy of a key.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { PuntovivoLogger } from '@puntovivo/server';
import {
  assertSafeStorageUsable,
  getDbKeyDir,
  getDbKeyEnvelopePath,
  readSealedEnvelope,
  writeSealedEnvelope,
  type SafeStorageLike,
} from './db-key-store.ts';
import { applySqlCipherKey, rekeySqliteDatabase } from './backup/backup-bundle/encryption.ts';
import { assertSqliteIntegrity } from './backup/backup-bundle/index.ts';

/** Staged envelope holding the NEXT key while a rotation is in flight. */
export const DB_KEY_ROTATION_STAGING_FILE = '.dbkey.enc.next';

export function getDbKeyRotationStagingPath(dataDir: string): string {
  return join(dataDir, DB_KEY_ROTATION_STAGING_FILE);
}

export function getDbKeyRotationBackupPath(dbPath: string): string {
  return `${dbPath}.pre-rotation.bak`;
}

interface RotateDbKeyArgs {
  dbPath: string;
  safeStorage: SafeStorageLike;
  /** The key the DB is currently encrypted with. */
  currentKey: string;
  log: PuntovivoLogger;
  platform?: NodeJS.Platform;
}

async function canOpenWithKey(dbPath: string, key: string): Promise<boolean> {
  try {
    await assertSqliteIntegrity(dbPath, { encryptionKey: key });
    return true;
  } catch {
    return false;
  }
}

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // absent or locked — recovery re-runs on the next boot either way.
  }
}

/**
 * Remove `-wal` / `-shm` sidecars. Only legal when the main file is
 * about to be replaced (the sidecars describe the file being
 * discarded) or after a completed checkpoint-TRUNCATE. Mirrors the
 * restore path's `removeSqliteSidecars`, synchronous because the
 * rotation and its recovery are synchronous file choreography.
 */
function removeSidecars(dbPath: string): void {
  removeIfPresent(`${dbPath}-wal`);
  removeIfPresent(`${dbPath}-shm`);
}

/**
 * Checkpoint-TRUNCATE the WAL under `key`, aborting when another
 * connection blocks it. A partial checkpoint would leave committed
 * frames out of the raw `.bak` copy — the same silent-data-loss
 * hazard the cleartext migration defends against.
 */
function checkpointWalOrThrow(dbPath: string, key: string): void {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    applySqlCipherKey(db, key);
    db.pragma('busy_timeout = 5000');
    const rows = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
    const result = rows[0];
    if (!result || result.busy !== 0) {
      throw new Error(
        'Key rotation aborted: the WAL checkpoint could not complete ' +
          '(another process is holding the database). Close other instances and retry.'
      );
    }
  } finally {
    db.close();
  }
}

/**
 * Rotate the install's SQLCipher key NOW. MUST be called with the
 * embedded server stopped. Returns the new 64-char hex key so the
 * caller can hand it to the restarting server.
 */
export async function rotateDbKeyNow({
  dbPath,
  safeStorage,
  currentKey,
  log,
  platform = process.platform,
}: RotateDbKeyArgs): Promise<string> {
  assertSafeStorageUsable(safeStorage, platform);
  const dataDir = getDbKeyDir(dbPath);
  const stagingPath = getDbKeyRotationStagingPath(dataDir);
  const backupPath = getDbKeyRotationBackupPath(dbPath);

  if (existsSync(stagingPath)) {
    // A previous rotation never resolved; refuse to stack a second
    // staged key on top of it. The boot recovery owns that state.
    // Sentinel message: the IPC handler maps it to its own closed
    // code so the operator copy can say restart instead of retry.
    throw new Error('DB_KEY_ROTATION_PENDING');
  }

  checkpointWalOrThrow(dbPath, currentKey);
  const newKey = randomBytes(32).toString('hex');
  writeSealedEnvelope(stagingPath, newKey, safeStorage);
  copyFileSync(dbPath, backupPath);
  try {
    rekeySqliteDatabase(dbPath, { fromKey: currentKey, toKey: newKey });
    await assertSqliteIntegrity(dbPath, { encryptionKey: newKey });
  } catch (err) {
    // The live file may be half-rewritten: roll back from the copy
    // and abandon the staged key so the install keeps its old key.
    // The sidecars belong to the discarded half-rewritten file and
    // must not be replayed into the restored copy.
    log.error(
      { reason: err instanceof Error ? err.message : String(err) },
      'db key rotation failed; restoring pre-rotation backup'
    );
    renameSync(backupPath, dbPath);
    removeSidecars(dbPath);
    removeIfPresent(stagingPath);
    throw err;
  }
  // Point of no return: promote the staged envelope. From here the
  // old key no longer exists anywhere.
  renameSync(stagingPath, getDbKeyEnvelopePath(dataDir));
  removeIfPresent(backupPath);
  log.info('db encryption key rotated');
  return newKey;
}

interface ResolvePendingRotationArgs {
  dbPath: string;
  safeStorage: SafeStorageLike;
  log: PuntovivoLogger;
  platform?: NodeJS.Platform;
}

/**
 * Boot-time convergence for a rotation interrupted by a crash. Runs
 * BEFORE `getOrCreateDbKey`. Also sweeps the `.bak` a crash between
 * promote and cleanup left behind — that copy is keyed to the retired
 * key and retaining it would defeat the rotation's purpose.
 */
export async function resolvePendingDbKeyRotation({
  dbPath,
  safeStorage,
  log,
  platform = process.platform,
}: ResolvePendingRotationArgs): Promise<void> {
  const dataDir = getDbKeyDir(dbPath);
  const stagingPath = getDbKeyRotationStagingPath(dataDir);
  const envelopePath = getDbKeyEnvelopePath(dataDir);
  const backupPath = getDbKeyRotationBackupPath(dbPath);

  if (!existsSync(stagingPath)) {
    // No rotation in flight. A leftover .bak means the crash hit
    // between promote and cleanup — but only delete it once the live
    // DB provably opens under the canonical key; if it does not, the
    // .bak may be the only good copy and getOrCreateDbKey's failure
    // path is about to need it.
    if (existsSync(backupPath) && existsSync(envelopePath)) {
      let canonicalKey: string | null;
      try {
        canonicalKey = readSealedEnvelope(envelopePath, safeStorage);
      } catch {
        canonicalKey = null;
      }
      if (canonicalKey !== null && (await canOpenWithKey(dbPath, canonicalKey))) {
        removeIfPresent(backupPath);
        log.info('removed leftover pre-rotation backup from a completed rotation');
      }
    }
    return;
  }

  // A staged envelope exists: a rotation was interrupted. The
  // keychain MUST be usable before anything is judged — a locked
  // keyring at login would otherwise read as "unreadable staging"
  // and tempt a cleanup that deletes the only copy of the key the
  // DB may already be encrypted with. Failing the boot here is safe:
  // everything stays on disk for the next attempt.
  assertSafeStorageUsable(safeStorage, platform);

  let stagedKey: string;
  try {
    stagedKey = readSealedEnvelope(stagingPath, safeStorage);
  } catch (err) {
    throw new Error(
      'A key rotation is pending but its staged envelope cannot be read. ' +
        'Unlock the OS keychain and restart Puntovivo; nothing was discarded.',
      { cause: err }
    );
  }

  // A mid-rekey crash leaves sidecars describing the interrupted
  // rewrite. They would make the read-only probes below fail with
  // SQLITE_READONLY_RECOVERY on a perfectly recoverable main file,
  // and replaying them into a restored .bak would corrupt it. The
  // rotation checkpoint-TRUNCATEd before copying, so committed
  // pre-rotation data lives in the main files, not the WAL.
  removeSidecars(dbPath);

  if (existsSync(dbPath) && (await canOpenWithKey(dbPath, stagedKey))) {
    // The rekey completed but the promote did not: finish it.
    renameSync(stagingPath, envelopePath);
    removeIfPresent(backupPath);
    log.info('completed interrupted db key rotation');
    return;
  }

  let canonicalKey: string | null = null;
  if (existsSync(envelopePath)) {
    try {
      canonicalKey = readSealedEnvelope(envelopePath, safeStorage);
    } catch {
      canonicalKey = null;
    }
  }
  if (canonicalKey && existsSync(dbPath) && (await canOpenWithKey(dbPath, canonicalKey))) {
    // The rekey never ran (or fully rolled back): abandon the request.
    removeIfPresent(stagingPath);
    removeIfPresent(backupPath);
    log.info('abandoned interrupted db key rotation; database kept its previous key');
    return;
  }

  if (existsSync(backupPath) && canonicalKey && (await canOpenWithKey(backupPath, canonicalKey))) {
    // Mid-rekey crash corrupted the live file: the pre-rotation copy
    // under the canonical key is the good state.
    renameSync(backupPath, dbPath);
    removeSidecars(dbPath);
    removeIfPresent(stagingPath);
    log.warn('restored pre-rotation database copy after interrupted key rotation');
    return;
  }

  throw new Error(
    'A key rotation was interrupted and the database matches neither the staged nor the ' +
      'canonical key envelope. Restore from a backup bundle before starting Puntovivo.'
  );
}
