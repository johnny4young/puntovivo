/**
 * Durable desktop state writes must survive Windows fsync semantics.
 *
 * On Windows, fsync is FlushFileBuffers, which requires a handle opened for
 * writing: a read-only descriptor fails with EPERM, where POSIX accepts it.
 * The update history, update floor, and audit anchor writers each synced their
 * temporary file through a read-only descriptor, and the database restore
 * transaction synced every durable copy the same way. On Windows that logged
 * failed to persist auto-update history on every launch, reported the sealed
 * update floor unavailable (which disables auto-update entirely), left audit
 * anchors unwritable, and failed every restore at its first backup copy. The
 * directory fsync those paths skip on win32 was never the failing call.
 *
 * CI runs these tests on POSIX, so the Windows rule is emulated below, and the
 * last test proves the emulation itself rejects what Windows rejects.
 *
 * @module __tests__/durable-writes-windows.test
 */

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';

import { createSafeStorageAuditAnchorStore } from '../audit-anchor-store.ts';
import { loadOrAdvanceUpdateFloor } from '../auto-updater/update-floor-store.ts';
import { recordVersionTransition } from '../auto-updater/update-history.ts';
import { runRecoverableDatabaseRestore } from '../database-restore-transaction.ts';
import type { SafeStorageLike } from '../db-key-store.ts';

const quietLog = { info() {}, warn() {}, error() {} };

function eperm(): Error {
  return Object.assign(new Error('EPERM: operation not permitted, fsync'), {
    code: 'EPERM',
    syscall: 'fsync',
  });
}

function createMarkedDatabase(path: string, marker: string): void {
  const database = new Database(path);
  try {
    database.exec('CREATE TABLE restore_marker (value TEXT NOT NULL)');
    database.prepare('INSERT INTO restore_marker (value) VALUES (?)').run(marker);
  } finally {
    database.close();
  }
}

function safeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`sealed:${value}`),
    decryptString: value => value.toString().replace(/^sealed:/, ''),
    getSelectedStorageBackend: () => 'unknown',
  };
}

/**
 * Make fsync on a read-only descriptor fail with EPERM and report win32, the
 * way a Windows runner behaves. Returns the function that restores both.
 */
function emulateWindowsFsync(): () => void {
  const original = { openSync: fs.openSync, closeSync: fs.closeSync, fsyncSync: fs.fsyncSync };
  const originalOpenHandle = fsPromises.open;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const readOnly = new Set<number>();
  const writableFlags = fs.constants.O_WRONLY | fs.constants.O_RDWR;
  const isWritable = (flags: fs.OpenMode | undefined) =>
    flags !== undefined &&
    (typeof flags === 'number' ? (flags & writableFlags) !== 0 : /[wa+]/.test(flags));

  fs.openSync = ((path: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode | null) => {
    const descriptor = original.openSync(path, flags ?? 'r', mode);
    if (!isWritable(flags)) readOnly.add(descriptor);
    return descriptor;
  }) as typeof fs.openSync;
  fs.closeSync = ((descriptor: number) => {
    readOnly.delete(descriptor);
    original.closeSync(descriptor);
  }) as typeof fs.closeSync;
  fs.fsyncSync = ((descriptor: number) => {
    if (readOnly.has(descriptor)) throw eperm();
    original.fsyncSync(descriptor);
  }) as typeof fs.fsyncSync;
  fsPromises.open = (async (path: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode) => {
    const handle = await originalOpenHandle(path, flags, mode);
    if (!isWritable(flags)) {
      const rejectSync = () => Promise.reject(eperm());
      Object.defineProperty(handle, 'sync', { value: rejectSync });
      Object.defineProperty(handle, 'datasync', { value: rejectSync });
    }
    return handle;
  }) as typeof fsPromises.open;
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  syncBuiltinESMExports();

  return () => {
    Object.assign(fs, original);
    fsPromises.open = originalOpenHandle;
    Object.defineProperty(process, 'platform', platform);
    syncBuiltinESMExports();
  };
}

describe('durable desktop writes under Windows fsync semantics', () => {
  let root: string;
  let restore: () => void;
  let nativeProbe: Database.Database;

  before(() => {
    // The SQLite addon picks its prebuild from process.platform when it first
    // loads. Load it for the real host before any test reports win32.
    nativeProbe = new Database(':memory:');
  });

  after(() => {
    nativeProbe.close();
  });

  beforeEach(() => {
    root = fs.mkdtempSync(join(tmpdir(), 'puntovivo-windows-fsync-'));
    restore = emulateWindowsFsync();
  });

  afterEach(() => {
    restore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('persists the auto-update history', () => {
    const file = join(root, 'auto-update-history.json');
    assert.equal(recordVersionTransition(file, '1.14.0').version, '1.14.0');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, '1.14.0');
  });

  it('seals the auto-update floor that auto-update refuses to run without', () => {
    const floor = loadOrAdvanceUpdateFloor({
      dataDir: root,
      currentVersion: '1.14.0',
      safeStorage: safeStorage(),
      platform: 'win32',
    });
    assert.equal(floor.floorVersion, '1.14.0');
    assert.equal(floor.established, true);
  });

  it('persists audit anchors', () => {
    const state = { version: 2 as const, confirmed: { counter: 4, headHash: 'head' }, pending: [] };
    createSafeStorageAuditAnchorStore({
      dataDir: root,
      safeStorage: safeStorage(),
      platform: 'win32',
    }).write('tenant-a', state);

    const reopened = createSafeStorageAuditAnchorStore({
      dataDir: root,
      safeStorage: safeStorage(),
      platform: 'win32',
    });
    assert.deepEqual(reopened.read('tenant-a'), state);
  });

  it('restores a database through its durable copies', async () => {
    const dbPath = join(root, 'local.db');
    const targetPath = join(root, 'target.db');
    const anchorPath = join(root, '.audit-anchor-state.enc');
    createMarkedDatabase(dbPath, 'previous');
    createMarkedDatabase(targetPath, 'restored');
    fs.writeFileSync(anchorPath, 'sealed-previous-anchor', { mode: 0o600 });

    await runRecoverableDatabaseRestore({
      dbPath,
      targetDatabasePath: targetPath,
      currentEncryptionKey: undefined,
      auditAnchorStatePath: anchorPath,
      targetAuditAnchorPoints: [{ tenantId: 'tenant-a', counter: 4, headHash: 'restored-head' }],
      replaceAuditAnchorState: async points => {
        fs.writeFileSync(anchorPath, JSON.stringify(points), { mode: 0o600 });
      },
      log: quietLog,
    });

    const restored = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      assert.deepEqual(restored.prepare('SELECT value FROM restore_marker').get(), {
        value: 'restored',
      });
    } finally {
      restored.close();
    }
  });

  it('rejects exactly what Windows rejects, so the tests above are not vacuous', async () => {
    const probe = join(root, 'probe');
    fs.writeFileSync(probe, 'x');
    const readOnly = fs.openSync(probe, 'r');
    try {
      assert.throws(() => fs.fsyncSync(readOnly), { code: 'EPERM' });
    } finally {
      fs.closeSync(readOnly);
    }
    const writable = fs.openSync(probe, 'r+');
    try {
      assert.doesNotThrow(() => fs.fsyncSync(writable));
    } finally {
      fs.closeSync(writable);
    }

    const readOnlyHandle = await fsPromises.open(probe, 'r');
    try {
      await assert.rejects(readOnlyHandle.sync(), { code: 'EPERM' });
    } finally {
      await readOnlyHandle.close();
    }
    const writableHandle = await fsPromises.open(probe, 'r+');
    try {
      await writableHandle.sync();
    } finally {
      await writableHandle.close();
    }
    assert.equal(process.platform, 'win32');
  });
});
