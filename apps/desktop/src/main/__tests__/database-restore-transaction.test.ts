import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import {
  getDatabaseRestoreTransactionPaths,
  recoverInterruptedDatabaseRestore,
  runRecoverableDatabaseRestore,
  type DatabaseRestoreTransactionLogger,
} from '../database-restore-transaction.ts';

const log: DatabaseRestoreTransactionLogger = {
  info() {},
  warn() {},
  error() {},
};

function createDatabase(path: string, marker: string): void {
  const database = new Database(path);
  try {
    database.exec('CREATE TABLE restore_marker (value TEXT NOT NULL)');
    database.prepare('INSERT INTO restore_marker (value) VALUES (?)').run(marker);
  } finally {
    database.close();
  }
}

function readMarker(path: string): string {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return (database.prepare('SELECT value FROM restore_marker').get() as { value: string }).value;
  } finally {
    database.close();
  }
}

describe('database restore transaction', () => {
  let directory: string;
  let dbPath: string;
  let targetPath: string;
  let anchorPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'puntovivo-restore-transaction-'));
    dbPath = join(directory, 'local.db');
    targetPath = join(directory, 'target.db');
    anchorPath = join(directory, '.audit-anchor-state.enc');
    createDatabase(dbPath, 'previous');
    createDatabase(targetPath, 'restored');
    await writeFile(anchorPath, 'sealed-previous-anchor', { mode: 0o600 });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('commits the database and external anchor before removing rollback evidence', async () => {
    const paths = getDatabaseRestoreTransactionPaths(dbPath, anchorPath);
    await runRecoverableDatabaseRestore({
      dbPath,
      targetDatabasePath: targetPath,
      currentEncryptionKey: undefined,
      auditAnchorStatePath: anchorPath,
      targetAuditAnchorPoints: [{ tenantId: 'tenant-a', counter: 4, headHash: 'restored-head' }],
      replaceAuditAnchorState: async points => {
        await writeFile(anchorPath, JSON.stringify(points), { mode: 0o600 });
      },
      log,
    });

    assert.equal(readMarker(dbPath), 'restored');
    assert.match(await readFile(anchorPath, 'utf8'), /restored-head/);
    assert.equal(existsSync(paths.journal), false);
    assert.equal(existsSync(paths.previousDatabase), false);
    assert.equal(existsSync(paths.previousAuditAnchor), false);
  });

  it('rolls both resources back when replacing the external anchor fails', async () => {
    const paths = getDatabaseRestoreTransactionPaths(dbPath, anchorPath);
    await assert.rejects(
      runRecoverableDatabaseRestore({
        dbPath,
        targetDatabasePath: targetPath,
        currentEncryptionKey: undefined,
        auditAnchorStatePath: anchorPath,
        targetAuditAnchorPoints: [{ tenantId: 'tenant-a', counter: 4, headHash: 'restored-head' }],
        replaceAuditAnchorState: async () => {
          await writeFile(anchorPath, 'partially-replaced-anchor', { mode: 0o600 });
          throw new Error('safeStorage unavailable');
        },
        log,
      }),
      /safeStorage unavailable/
    );

    assert.equal(readMarker(dbPath), 'previous');
    assert.equal(await readFile(anchorPath, 'utf8'), 'sealed-previous-anchor');
    assert.equal(existsSync(paths.journal), false);
    assert.equal(existsSync(paths.previousDatabase), false);
    assert.equal(existsSync(paths.previousAuditAnchor), false);
  });

  it('rolls back a prepared journal left by an abrupt exit after both replacements', async () => {
    const paths = getDatabaseRestoreTransactionPaths(dbPath, anchorPath);
    await copyFile(dbPath, paths.previousDatabase);
    await copyFile(anchorPath, paths.previousAuditAnchor);
    await copyFile(targetPath, dbPath);
    await writeFile(anchorPath, 'sealed-restored-anchor', { mode: 0o600 });
    await writeFile(
      paths.journal,
      JSON.stringify({
        version: 1,
        state: 'prepared',
        hadDatabase: true,
        hadAuditAnchor: true,
      }),
      { mode: 0o600 }
    );

    assert.equal(
      await recoverInterruptedDatabaseRestore({ dbPath, auditAnchorStatePath: anchorPath, log }),
      'rolled-back'
    );
    assert.equal(readMarker(dbPath), 'previous');
    assert.equal(await readFile(anchorPath, 'utf8'), 'sealed-previous-anchor');
    assert.equal(existsSync(paths.journal), false);
  });

  it('keeps a fully committed pair when only cleanup was interrupted', async () => {
    const paths = getDatabaseRestoreTransactionPaths(dbPath, anchorPath);
    await copyFile(dbPath, paths.previousDatabase);
    await copyFile(anchorPath, paths.previousAuditAnchor);
    await copyFile(targetPath, dbPath);
    await writeFile(anchorPath, 'sealed-restored-anchor', { mode: 0o600 });
    await writeFile(
      paths.journal,
      JSON.stringify({
        version: 1,
        state: 'committed',
        hadDatabase: true,
        hadAuditAnchor: true,
      }),
      { mode: 0o600 }
    );

    assert.equal(
      await recoverInterruptedDatabaseRestore({ dbPath, auditAnchorStatePath: anchorPath, log }),
      'finalized'
    );
    assert.equal(readMarker(dbPath), 'restored');
    assert.equal(await readFile(anchorPath, 'utf8'), 'sealed-restored-anchor');
    assert.equal(existsSync(paths.journal), false);
    assert.equal(existsSync(paths.previousDatabase), false);
    assert.equal(existsSync(paths.previousAuditAnchor), false);
  });
});
