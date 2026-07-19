import { afterEach, beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { App, SafeStorage } from 'electron';
import type { PuntovivoLogger } from '@puntovivo/server';
import { createEncryptionSetup } from '../encryption-setup.ts';

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

describe('createEncryptionSetup backup protection status (ENG-129e)', () => {
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
});
