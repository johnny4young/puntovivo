/**
 * pins the SQLite PRAGMA cluster applied by `initDatabase`.
 *
 * If a future maintainer drops or tweaks one of these PRAGMAs the
 * production-config code path (db/index.ts) regresses to under-tuned
 * defaults: lock collisions abort instead of waiting (busy_timeout),
 * hot reads thrash on syscalls instead of mmap (mmap_size), large
 * intermediate sorts spill to disk (temp_store), and the WAL grows
 * unbounded (wal_autocheckpoint). The values pinned here mirror the
 * audit's recommendations and the SECURITY.md doc.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';

interface LiveDatabase {
  $client: Database.Database;
}

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

function readPragma(name: string): number | string | undefined | null {
  const sqlite = (getDatabase() as unknown as LiveDatabase).$client;
  return sqlite.pragma(name, { simple: true }) as number | string | undefined | null;
}

describe('SQLite PRAGMA cluster', () => {
  it('pins the file-based PRAGMA values to the audit floor', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-pragma-'));
    createdDirs.push(dir);
    const dbPath = join(dir, 'pragma-floor.db');
    await initDatabase({ dbPath, seedData: false });

    expect(readPragma('journal_mode')).toBe('wal');
    expect(readPragma('foreign_keys')).toBe(1);
    expect(readPragma('busy_timeout')).toBe(5000);
    // SQLite reports cache_size as the negative kibibyte value when set
    // with the `-N` convention. The audit asked for ~64 MiB → -64000.
    expect(readPragma('cache_size')).toBe(-64000);
    expect(readPragma('mmap_size')).toBe(268435456);
    // SQLite's temp_store enum: 0=DEFAULT, 1=FILE, 2=MEMORY. We pin MEMORY.
    expect(readPragma('temp_store')).toBe(2);
    expect(readPragma('wal_autocheckpoint')).toBe(1000);
  });

  it('still applies the connection-level PRAGMAs in `:memory:` mode', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });

    expect(readPragma('foreign_keys')).toBe(1);
    expect(readPragma('busy_timeout')).toBe(5000);
    expect(readPragma('cache_size')).toBe(-64000);
    expect(readPragma('temp_store')).toBe(2);
    // mmap_size + wal_autocheckpoint are skipped for in-memory DBs (no
    // underlying file to map or checkpoint). SQLite returns 0 or
    // undefined for mmap_size on a memory DB depending on the version;
    // the contract we assert is "initDatabase did NOT set it to 256 MiB".
    const mmapSize = readPragma('mmap_size');
    expect(mmapSize === 0 || mmapSize === undefined || mmapSize === null).toBe(true);
    // journal_mode for `:memory:` is MEMORY (SQLite cannot use WAL on
    // a memory DB; we already skip the pragma in that branch).
    expect(readPragma('journal_mode')).toBe('memory');
  });

  it('allows high-contention harnesses to raise busy_timeout explicitly', async () => {
    await initDatabase({
      dbPath: ':memory:',
      seedData: false,
      sqliteBusyTimeoutMs: 15_000,
    });

    expect(readPragma('busy_timeout')).toBe(15_000);
  });
});
