import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { alignMigrationTrackingTimestamps } from '../db/migration-tracking.js';

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('alignMigrationTrackingTimestamps', () => {
  it('is a no-op before Drizzle creates its tracking table', () => {
    const folder = mkdtempSync(join(tmpdir(), 'puntovivo-migration-tracking-'));
    scratchDirectories.push(folder);
    mkdirSync(join(folder, 'meta'));
    writeFileSync(join(folder, 'meta', '_journal.json'), '{"entries":[]}');
    const sqlite = new Database(':memory:');
    expect(alignMigrationTrackingTimestamps(sqlite, folder)).toBe(0);
    sqlite.close();
  });

  it('repairs known tracking rows by migration hash and leaves unknown rows untouched', () => {
    const folder = mkdtempSync(join(tmpdir(), 'puntovivo-migration-tracking-'));
    scratchDirectories.push(folder);
    mkdirSync(join(folder, 'meta'));
    const sqlA = 'CREATE TABLE a (id text);';
    const sqlB = 'CREATE TABLE b (id text);';
    writeFileSync(join(folder, '0000_a.sql'), sqlA);
    writeFileSync(join(folder, '0001_b.sql'), sqlB);
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({
        entries: [
          { idx: 0, tag: '0000_a', when: 100 },
          { idx: 1, tag: '0001_b', when: 200 },
        ],
      })
    );

    const sqlite = new Database(':memory:');
    sqlite.exec(
      'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)'
    );
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run(hash(sqlA), 999);
    sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run(hash(sqlB), 50);
    sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run('unknown', 777);

    expect(alignMigrationTrackingTimestamps(sqlite, folder)).toBe(2);
    expect(
      sqlite
        .prepare('SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY id')
        .all()
    ).toEqual([
      { hash: hash(sqlA), createdAt: 100 },
      { hash: hash(sqlB), createdAt: 200 },
      { hash: 'unknown', createdAt: 777 },
    ]);
    expect(alignMigrationTrackingTimestamps(sqlite, folder)).toBe(0);
    sqlite.close();
  });
});
