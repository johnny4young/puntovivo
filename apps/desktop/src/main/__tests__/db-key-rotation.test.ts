import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { PuntovivoLogger } from '@puntovivo/server';
import {
  getDbKeyEnvelopePath,
  writeSealedEnvelope,
  type SafeStorageLike,
} from '../db-key-store.ts';
import {
  getDbKeyRotationBackupPath,
  getDbKeyRotationStagingPath,
  resolvePendingDbKeyRotation,
  rotateDbKeyNow,
} from '../db-key-rotation.ts';

// Hermetic safeStorage stub — same shape as the db-key-store suite.
const XOR_MASK = 0x5a;
function makeStub(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) =>
      Buffer.from(Buffer.from(plain, 'utf8').map(b => b ^ XOR_MASK)),
    decryptString: (sealed: Buffer) => Buffer.from(sealed.map(b => b ^ XOR_MASK)).toString('utf8'),
  };
}

const log = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as PuntovivoLogger;

const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);

function createKeyedDb(path: string, key: string): void {
  const db = new Database(path);
  try {
    db.pragma("cipher = 'sqlcipher'");
    db.pragma('legacy = 4');
    db.pragma(`key = "x'${key}'"`);
    db.exec('CREATE TABLE probe (x INTEGER); INSERT INTO probe VALUES (7);');
  } finally {
    db.close();
  }
}

function opensWith(path: string, key: string): boolean {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    db.pragma("cipher = 'sqlcipher'");
    db.pragma('legacy = 4');
    db.pragma(`key = "x'${key}'"`);
    const row = db.prepare('SELECT x FROM probe').get() as { x: number } | undefined;
    return row?.x === 7;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

describe('db-key-rotation', () => {
  let workdir: string;
  let scenario = 0;

  before(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'puntovivo-rotation-'));
  });

  after(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  function freshDbPath(): string {
    scenario += 1;
    return join(workdir, `case-${scenario}`, 'local.db');
  }

  it('rotates the key in place and promotes the envelope', async () => {
    const dbPath = freshDbPath();
    const dataDir = join(dbPath, '..');
    const stub = makeStub();
    await rm(dataDir, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dataDir, { recursive: true });
    createKeyedDb(dbPath, KEY_A);
    writeSealedEnvelope(getDbKeyEnvelopePath(dataDir), KEY_A, stub);

    const newKey = await rotateDbKeyNow({
      dbPath,
      safeStorage: stub,
      currentKey: KEY_A,
      log,
    });

    assert.equal(newKey.length, 64);
    assert.notEqual(newKey, KEY_A);
    assert.ok(opensWith(dbPath, newKey), 'db must open under the new key');
    assert.ok(!opensWith(dbPath, KEY_A), 'db must not open under the old key');
    assert.equal(
      stub.decryptString(
        Buffer.from((await import('node:fs')).readFileSync(getDbKeyEnvelopePath(dataDir)))
      ),
      newKey,
      'canonical envelope must hold the new key'
    );
    assert.ok(!existsSync(getDbKeyRotationStagingPath(dataDir)), 'staging removed');
    assert.ok(!existsSync(getDbKeyRotationBackupPath(dbPath)), 'backup removed');
  });

  it('refuses to rotate while a staged rotation is pending', async () => {
    const dbPath = freshDbPath();
    const dataDir = join(dbPath, '..');
    const stub = makeStub();
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dataDir, { recursive: true });
    createKeyedDb(dbPath, KEY_A);
    writeSealedEnvelope(getDbKeyRotationStagingPath(dataDir), KEY_B, stub);

    await assert.rejects(
      () => rotateDbKeyNow({ dbPath, safeStorage: stub, currentKey: KEY_A, log }),
      /DB_KEY_ROTATION_PENDING/
    );
  });

  it('recovery refuses to discard anything while the keychain is unusable', async () => {
    const dbPath = freshDbPath();
    const dataDir = join(dbPath, '..');
    const stub = makeStub();
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dataDir, { recursive: true });
    // Post-rekey pre-promote crash state: DB under B, staging holds
    // the ONLY copy of B.
    createKeyedDb(dbPath, KEY_B);
    writeSealedEnvelope(getDbKeyEnvelopePath(dataDir), KEY_A, stub);
    writeSealedEnvelope(getDbKeyRotationStagingPath(dataDir), KEY_B, stub);

    // The keyring is locked at this boot (login autostart race).
    const locked: typeof stub = {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error('locked');
      },
      decryptString: () => {
        throw new Error('locked');
      },
    };
    await assert.rejects(
      () => resolvePendingDbKeyRotation({ dbPath, safeStorage: locked, log }),
      /OS keychain is unavailable/
    );
    // NOTHING was discarded: the next boot with an unlocked keyring
    // still finds the staged key and completes the rotation.
    assert.ok(existsSync(getDbKeyRotationStagingPath(dataDir)));
    await resolvePendingDbKeyRotation({ dbPath, safeStorage: stub, log });
    assert.ok(opensWith(dbPath, KEY_B));
  });

  it('recovery sweeps the retired-key backup a post-promote crash left behind', async () => {
    const dbPath = freshDbPath();
    const dataDir = join(dbPath, '..');
    const stub = makeStub();
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dataDir, { recursive: true });
    // Crash between promote and cleanup: no staging, canonical holds
    // the NEW key, and a full old-key copy lingers next to the DB.
    createKeyedDb(dbPath, KEY_B);
    writeSealedEnvelope(getDbKeyEnvelopePath(dataDir), KEY_B, stub);
    createKeyedDb(getDbKeyRotationBackupPath(dbPath), KEY_A);

    await resolvePendingDbKeyRotation({ dbPath, safeStorage: stub, log });

    assert.ok(
      !existsSync(getDbKeyRotationBackupPath(dbPath)),
      'the retired-key copy must not be retained'
    );
    assert.ok(opensWith(dbPath, KEY_B));
  });

  it('recovery promotes a completed-but-unpromoted rotation', async () => {
    const dbPath = freshDbPath();
    const dataDir = join(dbPath, '..');
    const stub = makeStub();
    const { mkdirSync, readFileSync } = await import('node:fs');
    mkdirSync(dataDir, { recursive: true });
    // Crash happened AFTER the rekey to KEY_B but BEFORE the promote:
    // db is under B, canonical envelope still says A, staging says B.
    createKeyedDb(dbPath, KEY_B);
    writeSealedEnvelope(getDbKeyEnvelopePath(dataDir), KEY_A, stub);
    writeSealedEnvelope(getDbKeyRotationStagingPath(dataDir), KEY_B, stub);

    await resolvePendingDbKeyRotation({ dbPath, safeStorage: stub, log });

    assert.equal(
      stub.decryptString(Buffer.from(readFileSync(getDbKeyEnvelopePath(dataDir)))),
      KEY_B
    );
    assert.ok(!existsSync(getDbKeyRotationStagingPath(dataDir)));
    assert.ok(opensWith(dbPath, KEY_B));
  });

  it('recovery abandons a rotation that never rekeyed', async () => {
    const dbPath = freshDbPath();
    const dataDir = join(dbPath, '..');
    const stub = makeStub();
    const { mkdirSync, readFileSync } = await import('node:fs');
    mkdirSync(dataDir, { recursive: true });
    // Crash happened BEFORE the rekey: db still under A.
    createKeyedDb(dbPath, KEY_A);
    writeSealedEnvelope(getDbKeyEnvelopePath(dataDir), KEY_A, stub);
    writeSealedEnvelope(getDbKeyRotationStagingPath(dataDir), KEY_B, stub);

    await resolvePendingDbKeyRotation({ dbPath, safeStorage: stub, log });

    assert.equal(
      stub.decryptString(Buffer.from(readFileSync(getDbKeyEnvelopePath(dataDir)))),
      KEY_A
    );
    assert.ok(!existsSync(getDbKeyRotationStagingPath(dataDir)));
    assert.ok(opensWith(dbPath, KEY_A));
  });

  it('recovery restores the pre-rotation copy after a mid-rekey crash', async () => {
    const dbPath = freshDbPath();
    const dataDir = join(dbPath, '..');
    const stub = makeStub();
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dataDir, { recursive: true });
    // Crash happened DURING the rekey: live file is garbage; the
    // pre-rotation copy (under A) is the good state.
    writeFileSync(dbPath, Buffer.from('not a sqlite file at all'));
    const backupPath = getDbKeyRotationBackupPath(dbPath);
    createKeyedDb(backupPath, KEY_A);
    writeSealedEnvelope(getDbKeyEnvelopePath(dataDir), KEY_A, stub);
    writeSealedEnvelope(getDbKeyRotationStagingPath(dataDir), KEY_B, stub);

    await resolvePendingDbKeyRotation({ dbPath, safeStorage: stub, log });

    assert.ok(opensWith(dbPath, KEY_A), 'live db restored from the pre-rotation copy');
    assert.ok(!existsSync(getDbKeyRotationStagingPath(dataDir)));
    assert.ok(!existsSync(backupPath));
  });

  it('recovery is a no-op without a staged envelope', async () => {
    const dbPath = freshDbPath();
    const dataDir = join(dbPath, '..');
    const stub = makeStub();
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dataDir, { recursive: true });
    createKeyedDb(dbPath, KEY_A);
    writeSealedEnvelope(getDbKeyEnvelopePath(dataDir), KEY_A, stub);

    await resolvePendingDbKeyRotation({ dbPath, safeStorage: stub, log });
    assert.ok(opensWith(dbPath, KEY_A));
  });
});
