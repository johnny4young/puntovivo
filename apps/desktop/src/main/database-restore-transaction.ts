/** Crash-recoverable coordination for replacing SQLite and its external audit anchor. */

import Database from 'better-sqlite3';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditAnchorPoint } from '@puntovivo/server/audit-anchor';
import { applySqlCipherKey } from './backup/backup-bundle/encryption.ts';

const RESTORE_TRANSACTION_VERSION = 1 as const;

interface RestoreTransactionJournal {
  version: typeof RESTORE_TRANSACTION_VERSION;
  state: 'prepared' | 'committed';
  hadDatabase: boolean;
  hadAuditAnchor: boolean;
}

export interface DatabaseRestoreTransactionLogger {
  info(obj: Record<string, unknown>, message: string): void;
  warn(obj: Record<string, unknown>, message: string): void;
  error(obj: Record<string, unknown>, message: string): void;
}

export interface DatabaseRestoreTransactionPaths {
  journal: string;
  journalTemp: string;
  previousDatabase: string;
  previousAuditAnchor: string;
}

export function getDatabaseRestoreTransactionPaths(
  dbPath: string,
  auditAnchorStatePath: string
): DatabaseRestoreTransactionPaths {
  const journal = `${dbPath}.restore-transaction.json`;
  return {
    journal,
    journalTemp: `${journal}.tmp`,
    previousDatabase: `${dbPath}.pre-restore.bak`,
    previousAuditAnchor: `${auditAnchorStatePath}.pre-restore.bak`,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function copyDurably(source: string, destination: string): Promise<void> {
  await copyFile(source, destination);
  await chmod(destination, 0o600).catch(() => undefined);
  await syncFile(destination);
}

async function removeSidecars(dbPath: string): Promise<void> {
  await Promise.all([rm(`${dbPath}-wal`, { force: true }), rm(`${dbPath}-shm`, { force: true })]);
}

function checkpointDatabase(dbPath: string, encryptionKey: string | undefined): void {
  const database = new Database(dbPath, { fileMustExist: true });
  try {
    if (encryptionKey) applySqlCipherKey(database, encryptionKey);
    database.pragma('busy_timeout = 5000');
    const row = (
      database.pragma('wal_checkpoint(TRUNCATE)') as Array<{
        busy: number;
      }>
    )[0];
    if (!row || row.busy !== 0) {
      throw new Error(
        'Database restore aborted because the WAL checkpoint could not complete. ' +
          'Close other Puntovivo instances and retry.'
      );
    }
  } finally {
    database.close();
  }
}

function parseJournal(raw: string): RestoreTransactionJournal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error('DATABASE_RESTORE_TRANSACTION_INVALID', { cause: error });
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== RESTORE_TRANSACTION_VERSION ||
    !['prepared', 'committed'].includes(String((parsed as { state?: unknown }).state)) ||
    typeof (parsed as { hadDatabase?: unknown }).hadDatabase !== 'boolean' ||
    typeof (parsed as { hadAuditAnchor?: unknown }).hadAuditAnchor !== 'boolean'
  ) {
    throw new Error('DATABASE_RESTORE_TRANSACTION_INVALID');
  }
  return parsed as RestoreTransactionJournal;
}

async function writeJournal(
  paths: DatabaseRestoreTransactionPaths,
  journal: RestoreTransactionJournal
): Promise<void> {
  await rm(paths.journalTemp, { force: true });
  await writeFile(paths.journalTemp, `${JSON.stringify(journal)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  await syncFile(paths.journalTemp);
  await rename(paths.journalTemp, paths.journal);
  await syncDirectory(dirname(paths.journal));
}

async function cleanupTransaction(paths: DatabaseRestoreTransactionPaths): Promise<void> {
  await Promise.all([
    rm(paths.previousDatabase, { force: true }),
    rm(paths.previousAuditAnchor, { force: true }),
    rm(paths.journalTemp, { force: true }),
  ]);
  await rm(paths.journal, { force: true });
  await syncDirectory(dirname(paths.journal));
}

/**
 * Converge an interrupted restore before any database or audit-anchor reader
 * starts. A committed marker proves both replacements completed; every other
 * durable state rolls both resources back from their byte-for-byte copies.
 */
export async function recoverInterruptedDatabaseRestore(args: {
  dbPath: string;
  auditAnchorStatePath: string;
  log: DatabaseRestoreTransactionLogger;
}): Promise<'none' | 'rolled-back' | 'finalized'> {
  const paths = getDatabaseRestoreTransactionPaths(args.dbPath, args.auditAnchorStatePath);
  if (!(await exists(paths.journal))) {
    // These can only precede the durable prepared marker, so the live resources
    // were never touched and the orphan copies carry no recovery authority.
    await Promise.all([
      rm(paths.previousDatabase, { force: true }),
      rm(paths.previousAuditAnchor, { force: true }),
      rm(paths.journalTemp, { force: true }),
    ]);
    return 'none';
  }

  const journal = parseJournal(await readFile(paths.journal, 'utf8'));
  if (journal.state === 'committed') {
    await cleanupTransaction(paths);
    args.log.info({ dbPath: args.dbPath }, 'finalized completed database restore transaction');
    return 'finalized';
  }

  if (journal.hadDatabase) {
    if (!(await exists(paths.previousDatabase))) {
      throw new Error('DATABASE_RESTORE_ROLLBACK_DATABASE_MISSING');
    }
    await copyDurably(paths.previousDatabase, args.dbPath);
    await removeSidecars(args.dbPath);
  } else {
    await rm(args.dbPath, { force: true });
    await removeSidecars(args.dbPath);
  }

  if (journal.hadAuditAnchor) {
    if (!(await exists(paths.previousAuditAnchor))) {
      throw new Error('DATABASE_RESTORE_ROLLBACK_ANCHOR_MISSING');
    }
    await copyDurably(paths.previousAuditAnchor, args.auditAnchorStatePath);
  } else {
    await rm(args.auditAnchorStatePath, { force: true });
  }

  await cleanupTransaction(paths);
  args.log.warn({ dbPath: args.dbPath }, 'rolled back interrupted database restore transaction');
  return 'rolled-back';
}

/**
 * Replace the live database and safeStorage-sealed anchor as one recoverable
 * unit. The embedded server must be stopped by the caller for the whole call.
 */
export async function runRecoverableDatabaseRestore(args: {
  dbPath: string;
  targetDatabasePath: string;
  currentEncryptionKey: string | undefined;
  auditAnchorStatePath: string;
  targetAuditAnchorPoints: ReadonlyArray<{ tenantId: string } & AuditAnchorPoint>;
  replaceAuditAnchorState: (
    points: ReadonlyArray<{ tenantId: string } & AuditAnchorPoint>
  ) => Promise<void>;
  log: DatabaseRestoreTransactionLogger;
}): Promise<void> {
  await mkdir(dirname(args.dbPath), { recursive: true });
  await mkdir(dirname(args.auditAnchorStatePath), { recursive: true });
  await recoverInterruptedDatabaseRestore(args);

  const paths = getDatabaseRestoreTransactionPaths(args.dbPath, args.auditAnchorStatePath);
  const hadDatabase = await exists(args.dbPath);
  const hadAuditAnchor = await exists(args.auditAnchorStatePath);
  if (hadDatabase) {
    checkpointDatabase(args.dbPath, args.currentEncryptionKey);
    await copyDurably(args.dbPath, paths.previousDatabase);
  }
  if (hadAuditAnchor) {
    await copyDurably(args.auditAnchorStatePath, paths.previousAuditAnchor);
  }

  const prepared: RestoreTransactionJournal = {
    version: RESTORE_TRANSACTION_VERSION,
    state: 'prepared',
    hadDatabase,
    hadAuditAnchor,
  };
  await writeJournal(paths, prepared);

  try {
    await removeSidecars(args.dbPath);
    await copyDurably(args.targetDatabasePath, args.dbPath);
    await removeSidecars(args.dbPath);
    await args.replaceAuditAnchorState(args.targetAuditAnchorPoints);
    await writeJournal(paths, { ...prepared, state: 'committed' });
    await cleanupTransaction(paths);
  } catch (error) {
    args.log.error(
      {
        dbPath: args.dbPath,
        reason: error instanceof Error ? error.message : String(error),
      },
      'database restore transaction failed; restoring previous database and audit anchor'
    );
    try {
      await recoverInterruptedDatabaseRestore(args);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Database restore failed and automatic rollback is pending for the next launch',
        { cause: rollbackError }
      );
    }
    throw error;
  }
}
