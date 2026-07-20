import { afterEach, beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migrateCleartextDatabase, type MigrationLogger } from '../db-migrate-encryption.ts';

// regression pins, exercised against REAL database files
// and the REAL better-sqlite3-multiple-ciphers binding:
// 1. A cleartext DB is encrypted in place, verifiable with the key
// and unreadable without it; the .bak and stale sidecars are gone.
// 2. The migration is idempotent (second boot: already-encrypted).
// 3. Fresh installs (no file) and the dev-shared route (skip) are
// no-ops.
// 4. A failed attempt restores the cleartext original byte-for-byte
// and throws — the boot must never proceed on a half-written file.
//
// Run via `pnpm --filter @puntovivo/desktop run test` (node --test
// --experimental-strip-types; the script runs native:ensure:node
// first so the Node-ABI binding is in place).

const KEY = 'ab'.repeat(32);

const silentLog: MigrationLogger = {
  info() {},
  warn() {},
  error() {},
};

let dir: string;
let dbPath: string;

function seedCleartextDb(path: string): void {
  const db = new Database(path);
  try {
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE invariants (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO invariants (label) VALUES (?)');
    for (let i = 0; i < 50; i += 1) {
      insert.run(`row-${i}`);
    }
  } finally {
    db.close();
  }
}

function openEncrypted(path: string, key: string): Database.Database {
  const db = new Database(path, { fileMustExist: true });
  db.pragma("cipher = 'sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(`key = "x'${key}'"`);
  return db;
}

async function fileMissing(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch {
    return true;
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eng167b-migrate-'));
  dbPath = join(dir, 'local.db');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('migrateCleartextDatabase', () => {
  it('encrypts a cleartext database in place and cleans up the .bak and sidecars', async () => {
    seedCleartextDb(dbPath);

    const outcome = await migrateCleartextDatabase({
      dbPath,
      encryptionKey: KEY,
      log: silentLog,
    });
    assert.equal(outcome, 'migrated');

    // Header is no longer readable as plain SQLite.
    const head = (await readFile(dbPath)).subarray(0, 16).toString('latin1');
    assert.equal(head.startsWith('SQLite format 3'), false);

    // Opens with the key and the data survived.
    const db = openEncrypted(dbPath, KEY);
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM invariants').get() as {
        n: number;
      };
      assert.equal(row.n, 50);
    } finally {
      db.close();
    }

    // A keyless open fails on first read.
    const keyless = new Database(dbPath, { fileMustExist: true });
    try {
      assert.throws(() => keyless.prepare('SELECT 1 FROM invariants').get());
    } finally {
      keyless.close();
    }

    // Cleartext copy and stale WAL sidecars are gone.
    assert.equal(await fileMissing(`${dbPath}.pre-encryption.bak`), true);
    assert.equal(await fileMissing(`${dbPath}-wal`), true);
    assert.equal(await fileMissing(`${dbPath}-shm`), true);
  });

  it('is idempotent — a second boot reports already-encrypted and leaves the file alone', async () => {
    seedCleartextDb(dbPath);
    await migrateCleartextDatabase({ dbPath, encryptionKey: KEY, log: silentLog });
    const before = await readFile(dbPath);

    const outcome = await migrateCleartextDatabase({
      dbPath,
      encryptionKey: KEY,
      log: silentLog,
    });
    assert.equal(outcome, 'already-encrypted');
    assert.deepEqual(await readFile(dbPath), before);
  });

  it('reports no-database for a fresh install', async () => {
    const outcome = await migrateCleartextDatabase({
      dbPath: join(dir, 'never-created.db'),
      encryptionKey: KEY,
      log: silentLog,
    });
    assert.equal(outcome, 'no-database');
  });

  it('skips the dev-shared database route without touching the file', async () => {
    seedCleartextDb(dbPath);
    const before = await readFile(dbPath);

    const outcome = await migrateCleartextDatabase({
      dbPath,
      encryptionKey: KEY,
      skipReason: 'dev-shared DATABASE_URL database',
      log: silentLog,
    });
    assert.equal(outcome, 'skipped');
    assert.deepEqual(await readFile(dbPath), before);
  });

  it('recovers from a previous attempt that crashed mid-rekey (stale .bak + unreadable target)', async () => {
    seedCleartextDb(dbPath);
    // Simulate the crash window: the .bak exists and the target file
    // is garbage that no key opens (mid-rewrite state).
    const { copyFile, writeFile } = await import('node:fs/promises');
    await copyFile(dbPath, `${dbPath}.pre-encryption.bak`);
    await writeFile(dbPath, Buffer.from('garbage-mid-rekey-not-sqlite-or-cipher'));

    const outcome = await migrateCleartextDatabase({
      dbPath,
      encryptionKey: KEY,
      log: silentLog,
    });

    // The recovery restored the cleartext copy and the migration ran
    // to completion on it.
    assert.equal(outcome, 'migrated');
    const db = openEncrypted(dbPath, KEY);
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM invariants').get() as {
        n: number;
      };
      assert.equal(row.n, 50);
    } finally {
      db.close();
    }
    assert.equal(await fileMissing(`${dbPath}.pre-encryption.bak`), true);
  });

  it('finishes the cleanup when a previous attempt completed but the .bak deletion was lost', async () => {
    seedCleartextDb(dbPath);
    await migrateCleartextDatabase({ dbPath, encryptionKey: KEY, log: silentLog });
    // Re-plant a stale .bak as if the post-verify cleanup had crashed.
    const { copyFile } = await import('node:fs/promises');
    await copyFile(dbPath, `${dbPath}.pre-encryption.bak`);

    const outcome = await migrateCleartextDatabase({
      dbPath,
      encryptionKey: KEY,
      log: silentLog,
    });
    assert.equal(outcome, 'already-encrypted');
    assert.equal(await fileMissing(`${dbPath}.pre-encryption.bak`), true);
  });

  it('aborts before touching anything when the WAL checkpoint cannot complete', async () => {
    seedCleartextDb(dbPath);

    // Hold an old read snapshot on a second connection, then advance
    // the WAL past it: the TRUNCATE checkpoint cannot back-fill the
    // newer frames (busy = 1 after busy_timeout) and the raw-copyFile
    // .bak would silently miss committed data — the migration must
    // refuse to start instead.
    const holder = new Database(dbPath, { fileMustExist: true });
    try {
      holder.exec('BEGIN');
      holder.prepare('SELECT COUNT(*) AS n FROM invariants').get();

      const writer = new Database(dbPath, { fileMustExist: true });
      try {
        writer.prepare('INSERT INTO invariants (label) VALUES (?)').run('past-snapshot');
      } finally {
        writer.close();
      }

      await assert.rejects(
        migrateCleartextDatabase({
          dbPath,
          encryptionKey: KEY,
          log: silentLog,
          checkpointBusyTimeoutMs: 100,
        }),
        /WAL checkpoint could not complete/
      );

      // Nothing was attempted: no .bak, and the file is still a
      // healthy cleartext database carrying every committed row.
      assert.equal(await fileMissing(`${dbPath}.pre-encryption.bak`), true);
    } finally {
      holder.close();
    }

    const head = (await readFile(dbPath)).subarray(0, 16).toString('latin1');
    assert.equal(head.startsWith('SQLite format 3'), true);
    const keyless = new Database(dbPath, { fileMustExist: true });
    try {
      const row = keyless.prepare('SELECT COUNT(*) AS n FROM invariants').get() as {
        n: number;
      };
      assert.equal(row.n, 51);
    } finally {
      keyless.close();
    }
  });

  it('restores the cleartext original and throws when the attempt fails', async () => {
    seedCleartextDb(dbPath);
    // Checkpoint what seeding left in the WAL so the pre/post byte
    // comparison runs against the settled main file.
    const settle = new Database(dbPath, { fileMustExist: true });
    settle.pragma('wal_checkpoint(TRUNCATE)');
    settle.close();
    const before = await readFile(dbPath);

    // A malformed key fails inside the rekey step — AFTER the .bak
    // copy exists — which exercises the real restore path end to end.
    await assert.rejects(
      migrateCleartextDatabase({
        dbPath,
        encryptionKey: 'not-a-valid-key',
        log: silentLog,
      }),
      /migration failed and the original cleartext database was restored/
    );

    // Original file is back, still cleartext, and the .bak is gone.
    assert.deepEqual(await readFile(dbPath), before);
    const head = before.subarray(0, 16).toString('latin1');
    assert.equal(head.startsWith('SQLite format 3'), true);
    assert.equal(await fileMissing(`${dbPath}.pre-encryption.bak`), true);
  });
});
