/**
 * ENG-167 — pins the SQLCipher boot behaviour added by Step-1.
 *
 * `initDatabase({ encryptionKey })` must:
 *   1. Select SQLCipher v4 (`PRAGMA cipher='sqlcipher'` +
 *      `PRAGMA legacy=4`) and apply `PRAGMA key` BEFORE any other
 *      PRAGMA, so the very first read (the ENG-174 PRAGMA cluster)
 *      speaks to a successfully-keyed page cipher.
 *   2. Leave the on-disk file unreadable by a vanilla `new Database()`
 *      open (no key) — the canonical "stolen laptop" defence.
 *   3. Reject obviously-broken keys (truncated, non-hex, wrong length)
 *      at boot rather than at the first SELECT.
 *   4. Tolerate `dbPath === ':memory:'` (the fork rejects keys on
 *      transient DBs; we skip the PRAGMA when there is no on-disk
 *      surface to protect).
 *   5. Still apply the ENG-174 PRAGMAs (WAL, foreign_keys, cache_size,
 *      …) on the encrypted connection.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import type DatabaseT from 'better-sqlite3';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { resolveCachedNodeBinding } from '../db/native-binding.js';

// Raw probe connections must load the same Node-ABI addon initDatabase
// selects, or they die on dlopen whenever the on-disk default carries the
// Electron build.
const nativeBinding = resolveCachedNodeBinding();

interface LiveDatabase {
  $client: DatabaseT.Database;
}

const HEX64 = 'a'.repeat(64);
const HEX64_ALT = 'b'.repeat(64);

const createdDirs: string[] = [];

afterEach(() => {
  closeDatabase();
  for (const dir of createdDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

function freshTempDbPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `puntovivo-${prefix}-`));
  createdDirs.push(dir);
  return join(dir, 'local.db');
}

function writeCanary(live: DatabaseT.Database, value: number): void {
  live.prepare('CREATE TABLE IF NOT EXISTS canary (id INTEGER)').run();
  live.prepare('INSERT INTO canary (id) VALUES (?)').run(value);
}

describe('SQLite encryption at rest (ENG-167)', () => {
  it('writes an encrypted DB that vanilla better-sqlite3 cannot open', async () => {
    const dbPath = freshTempDbPath('enc-roundtrip');
    await initDatabase({ dbPath, seedData: false, encryptionKey: HEX64 });
    const live = (getDatabase() as unknown as LiveDatabase).$client;
    writeCanary(live, 1);
    closeDatabase();

    // Re-open the file WITHOUT supplying a key. The fork mirrors the
    // standard SQLCipher contract: the page header is unreadable, so
    // the first prepare crashes with SQLITE_NOTADB.
    const plain = new Database(dbPath, { nativeBinding });
    expect(() => plain.prepare('SELECT 1 FROM canary').get()).toThrow(
      /SQLITE_NOTADB|file is not a database/
    );
    plain.close();
  });

  it('re-opens cleanly when the same key is supplied a second time', async () => {
    const dbPath = freshTempDbPath('enc-reboot');
    await initDatabase({ dbPath, seedData: false, encryptionKey: HEX64 });
    const live = (getDatabase() as unknown as LiveDatabase).$client;
    writeCanary(live, 7);
    closeDatabase();

    // Second boot: same key, same file.
    await initDatabase({
      dbPath,
      seedData: false,
      runMigrations: false,
      encryptionKey: HEX64,
    });
    const reopened = (getDatabase() as unknown as LiveDatabase).$client;
    const row = reopened.prepare('SELECT id FROM canary').get() as { id: number } | undefined;
    expect(row?.id).toBe(7);
  });

  it('rejects an obviously-broken key shape before the first prepare', async () => {
    const dbPath = freshTempDbPath('enc-shape');
    await expect(
      initDatabase({ dbPath, seedData: false, encryptionKey: 'not-hex' })
    ).rejects.toThrow(/64-character hex string/);
  });

  it('a connection that supplies the wrong key cannot read the rows', async () => {
    const dbPath = freshTempDbPath('enc-wrongkey');
    await initDatabase({ dbPath, seedData: false, encryptionKey: HEX64 });
    const live = (getDatabase() as unknown as LiveDatabase).$client;
    writeCanary(live, 42);
    closeDatabase();

    // Re-open with a DIFFERENT key. SQLCipher accepts the PRAGMA
    // syntactically but the page-decrypt step fails on the first read.
    const wrong = new Database(dbPath, { nativeBinding });
    wrong.pragma("cipher = 'sqlcipher'");
    wrong.pragma('legacy = 4');
    wrong.pragma(`key = "x'${HEX64_ALT}'"`);
    expect(() => wrong.prepare('SELECT id FROM canary').get()).toThrow(
      /SQLITE_NOTADB|file is not a database/
    );
    wrong.close();
  });

  it(':memory: tolerates an encryptionKey without throwing (PRAGMA skipped)', async () => {
    // The fork (`better-sqlite3-multiple-ciphers`) raises "Setting
    // key not supported for in-memory or temporary databases" when
    // PRAGMA key targets `:memory:`. `initDatabase` guards on the
    // sentinel and skips the PRAGMA — the call must succeed and the
    // DB must remain usable for the existing in-memory test fleet.
    const db = await initDatabase({
      dbPath: ':memory:',
      seedData: false,
      encryptionKey: HEX64,
    });
    expect(db).toBeDefined();
    const live = (getDatabase() as unknown as LiveDatabase).$client;
    writeCanary(live, 1);
    const row = live.prepare('SELECT id FROM canary').get() as { id: number };
    expect(row.id).toBe(1);
  });

  it('preserves the ENG-174 PRAGMA cluster on the encrypted connection', async () => {
    const dbPath = freshTempDbPath('enc-pragma-cluster');
    await initDatabase({ dbPath, seedData: false, encryptionKey: HEX64 });
    const live = (getDatabase() as unknown as LiveDatabase).$client;

    expect(live.pragma('cipher', { simple: true })).toBe('sqlcipher');
    expect(live.pragma('legacy', { simple: true })).toBe('4');
    expect(live.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(live.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(live.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(live.pragma('cache_size', { simple: true })).toBe(-64000);
    expect(live.pragma('mmap_size', { simple: true })).toBe(268435456);
    expect(live.pragma('temp_store', { simple: true })).toBe(2);
    expect(live.pragma('wal_autocheckpoint', { simple: true })).toBe(1000);
  });

  it('omitting encryptionKey leaves the file readable in cleartext (legacy dev mode)', async () => {
    // Standalone `dev:server` boots without `PUNTOVIVO_DB_KEY` until
    // ENG-167b ships the migration UX. The legacy cleartext path
    // therefore MUST remain functional so the dev workflow does not
    // require running Electron just to seed the DB.
    const dbPath = freshTempDbPath('enc-omitted');
    await initDatabase({ dbPath, seedData: false });
    const live = (getDatabase() as unknown as LiveDatabase).$client;
    writeCanary(live, 1);
    closeDatabase();

    // Vanilla open (no key) succeeds because no key was ever applied.
    const plain = new Database(dbPath, { nativeBinding });
    const row = plain.prepare('SELECT id FROM canary').get() as { id: number };
    expect(row.id).toBe(1);
    plain.close();
  });
});
