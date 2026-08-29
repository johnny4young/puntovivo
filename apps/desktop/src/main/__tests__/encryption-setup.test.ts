import { afterEach, beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { App, SafeStorage } from 'electron';
import type { PuntovivoLogger } from '@puntovivo/server';
import Database from 'better-sqlite3';
import { createEncryptionSetup } from '../encryption-setup.ts';
import { getDatabaseRestoreTransactionPaths } from '../database-restore-transaction.ts';

const KEY = 'ab'.repeat(32);
const silentLog = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  fatal() {},
  child() {
    return this;
  },
} as unknown as PuntovivoLogger;

function makeApp(dataDir: string, isPackaged: boolean) {
  return {
    isPackaged,
    getPath: () => dataDir,
    getAppPath: () => dataDir,
  } as Pick<App, 'isPackaged' | 'getPath' | 'getAppPath'>;
}

function makeSafeStorage(): SafeStorage {
  return {
    isEncryptionAvailable: () => true,
    isAsyncEncryptionAvailable: () => Promise.resolve(true),
    encryptString: plain => Buffer.from(plain, 'utf8'),
    encryptStringAsync: plain => Promise.resolve(Buffer.from(plain, 'utf8')),
    decryptString: sealed => sealed.toString('utf8'),
    decryptStringAsync: sealed =>
      Promise.resolve({
        result: sealed.toString('utf8'),
        shouldReEncrypt: false,
      }),
    getSelectedStorageBackend: () => 'unknown',
    setUsePlainTextEncryption: () => {},
  };
}

describe('createEncryptionSetup backup protection status', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'puntovivo-encryption-setup-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('does not attest encryption until preparation completes', async () => {
    const setup = createEncryptionSetup({
      app: makeApp(dir, false),
      safeStorage: makeSafeStorage(),
      log: silentLog,
      env: {
        DATABASE_URL: join(dir, 'shared.db'),
        PUNTOVIVO_DB_KEY: KEY,
      },
      cwd: dir,
      resourcesPath: dir,
      platform: 'darwin',
    });

    assert.equal(setup.getBackupProtectionStatus().databaseEncrypted, false);
    await setup.prepareDatabaseEncryption();
    assert.deepEqual(setup.getBackupProtectionStatus(), {
      protected: false,
      databaseEncrypted: true,
      backupEncryption: 'sqlcipher',
      keyStorage: 'environment',
      provider: 'environment',
      recoveryKeyAvailable: true,
    });
  });

  it('attests packaged macOS keychain custody without returning the key', async () => {
    const setup = createEncryptionSetup({
      app: makeApp(dir, true),
      safeStorage: makeSafeStorage(),
      log: silentLog,
      env: {},
      cwd: dir,
      resourcesPath: dir,
      platform: 'darwin',
    });

    await setup.prepareDatabaseEncryption();
    const status = setup.getBackupProtectionStatus();
    assert.equal(status.protected, true);
    assert.equal(status.provider, 'macos_keychain');
    assert.equal((status as unknown as Record<string, unknown>).key, undefined);
  });

  it('uses an ephemeral environment key only for packaged E2E', async () => {
    const setup = createEncryptionSetup({
      app: makeApp(dir, true),
      safeStorage: {
        ...makeSafeStorage(),
        isEncryptionAvailable: () => {
          throw new Error('packaged E2E must not access safeStorage');
        },
      },
      log: silentLog,
      env: {
        PUNTOVIVO_E2E: '1',
        PUNTOVIVO_DB_KEY: KEY,
      },
      cwd: dir,
      resourcesPath: dir,
      platform: 'darwin',
    });

    await setup.prepareDatabaseEncryption();
    assert.deepEqual(setup.getBackupProtectionStatus(), {
      protected: false,
      databaseEncrypted: true,
      backupEncryption: 'sqlcipher',
      keyStorage: 'environment',
      provider: 'environment',
      recoveryKeyAvailable: true,
    });
  });

  it('rejects packaged E2E without an explicit ephemeral key', async () => {
    const setup = createEncryptionSetup({
      app: makeApp(dir, true),
      safeStorage: makeSafeStorage(),
      log: silentLog,
      env: { PUNTOVIVO_E2E: '1' },
      cwd: dir,
      resourcesPath: dir,
      platform: 'darwin',
    });

    await assert.rejects(
      setup.prepareDatabaseEncryption(),
      /Packaged Electron E2E requires an ephemeral PUNTOVIVO_DB_KEY/
    );
  });

  it('recovers an interrupted DB and audit-anchor restore before boot preparation', async () => {
    const dbPath = join(dir, 'shared.db');
    const previousPath = join(dir, 'previous.db');
    for (const [path, marker] of [
      [dbPath, 'restored'],
      [previousPath, 'previous'],
    ] as const) {
      const database = new Database(path);
      database.exec('CREATE TABLE marker (value TEXT NOT NULL)');
      database.prepare('INSERT INTO marker (value) VALUES (?)').run(marker);
      database.close();
    }

    const setup = createEncryptionSetup({
      app: makeApp(dir, false),
      safeStorage: makeSafeStorage(),
      log: silentLog,
      env: { DATABASE_URL: dbPath, PUNTOVIVO_DB_KEY: KEY },
      cwd: dir,
      resourcesPath: dir,
      platform: 'darwin',
    });
    const paths = getDatabaseRestoreTransactionPaths(dbPath, setup.auditAnchorStatePath);
    await copyFile(previousPath, paths.previousDatabase);
    await writeFile(setup.auditAnchorStatePath, 'restored-anchor');
    await writeFile(paths.previousAuditAnchor, 'previous-anchor');
    await writeFile(
      paths.journal,
      JSON.stringify({
        version: 1,
        state: 'prepared',
        hadDatabase: true,
        hadAuditAnchor: true,
      })
    );

    await setup.prepareDatabaseEncryption();

    const recovered = new Database(dbPath, { readonly: true });
    assert.equal(
      (recovered.prepare('SELECT value FROM marker').get() as { value: string }).value,
      'previous'
    );
    recovered.close();
    assert.equal(await readFile(setup.auditAnchorStatePath, 'utf8'), 'previous-anchor');
  });
});
