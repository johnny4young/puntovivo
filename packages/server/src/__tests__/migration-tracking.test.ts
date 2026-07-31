import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  alignMigrationTrackingTimestamps,
  recoverMaterializedCheckoutTimingMigration,
} from '../db/migration-tracking.js';

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
    // Mirror drizzle-orm's production SQLite DDL exactly. SQLite does not
    // treat SERIAL as an INTEGER PRIMARY KEY alias, so rows inserted by the
    // migrator have a null id and must be addressed through rowid.
    sqlite.exec(
      'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)'
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

    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations WHERE id IS NULL').get()
    ).toEqual({ count: 3 });

    expect(alignMigrationTrackingTimestamps(sqlite, folder)).toBe(2);
    expect(
      sqlite
        .prepare('SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY rowid')
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

describe('recoverMaterializedCheckoutTimingMigration', () => {
  function createMigrationFolder(): {
    folder: string;
    hash: (value: string) => string;
    baselineSql: string;
    checkoutSql: string;
  } {
    const folder = mkdtempSync(join(tmpdir(), 'puntovivo-checkout-tracking-'));
    scratchDirectories.push(folder);
    mkdirSync(join(folder, 'meta'));
    const baselineSql = 'CREATE TABLE baseline_marker (id text);';
    const checkoutSql = 'checkout timing migration identity';
    writeFileSync(join(folder, '0000_baseline.sql'), baselineSql);
    writeFileSync(join(folder, '0011_eng209_checkout_timing.sql'), checkoutSql);
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({
        entries: [
          { idx: 0, tag: '0000_baseline', when: 100 },
          { idx: 1, tag: '0011_eng209_checkout_timing', when: 200 },
        ],
      })
    );
    return {
      folder,
      hash: value => createHash('sha256').update(value).digest('hex'),
      baselineSql,
      checkoutSql,
    };
  }

  function createTrackingTable(sqlite: Database.Database): void {
    sqlite.exec(
      'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)'
    );
  }

  it('completes missing derived pace and records the exact migration identity', () => {
    const { folder, hash, baselineSql, checkoutSql } = createMigrationFolder();
    const sqlite = new Database(':memory:');
    createTrackingTable(sqlite);
    sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run(hash(baselineSql), 999);
    sqlite.exec(`
      CREATE TABLE cash_sessions (
        id text PRIMARY KEY,
        tenant_id text NOT NULL,
        status text NOT NULL,
        opened_at text NOT NULL,
        closed_at text,
        pace_items_per_minute real
      );
      CREATE TABLE sales (
        id text PRIMARY KEY,
        tenant_id text NOT NULL,
        cash_session_id text,
        status text NOT NULL,
        checkout_started_at text,
        checkout_completed_at text
      );
      CREATE TABLE sale_items (sale_id text NOT NULL, quantity real NOT NULL);
      INSERT INTO cash_sessions
        (id, tenant_id, status, opened_at, closed_at, pace_items_per_minute)
      VALUES
        ('missing-pace', 'tenant-1', 'closed', '2026-07-22T12:00:00.000Z', '2026-07-22T12:10:00.000Z', NULL),
        ('preserved-pace', 'tenant-1', 'closed', '2026-07-22T12:00:00.000Z', '2026-07-22T12:10:00.000Z', 9.9);
      INSERT INTO sales (id, tenant_id, cash_session_id, status)
      VALUES ('sale-1', 'tenant-1', 'missing-pace', 'completed');
      INSERT INTO sale_items (sale_id, quantity) VALUES ('sale-1', 3);
    `);

    expect(recoverMaterializedCheckoutTimingMigration(sqlite, folder)).toBe(1);
    expect(
      sqlite
        .prepare('SELECT id, pace_items_per_minute AS pace FROM cash_sessions ORDER BY id')
        .all()
    ).toEqual([
      { id: 'missing-pace', pace: 0.3 },
      { id: 'preserved-pace', pace: 9.9 },
    ]);
    expect(
      sqlite.prepare('SELECT hash, created_at AS createdAt FROM __drizzle_migrations').all()
    ).toEqual([
      { hash: hash(baselineSql), createdAt: 999 },
      { hash: hash(checkoutSql), createdAt: 200 },
    ]);
    expect(recoverMaterializedCheckoutTimingMigration(sqlite, folder)).toBe(0);
    sqlite.close();
  });

  it('refuses a partial schema without advancing the tracking journal', () => {
    const { folder, hash, baselineSql } = createMigrationFolder();
    const sqlite = new Database(':memory:');
    createTrackingTable(sqlite);
    sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run(hash(baselineSql), 100);
    sqlite.exec(`
      CREATE TABLE cash_sessions (pace_items_per_minute real);
      CREATE TABLE sales (checkout_started_at text);
    `);

    expect(() => recoverMaterializedCheckoutTimingMigration(sqlite, folder)).toThrow(
      /schema is only partially materialised.*sales\.checkout_completed_at/
    );
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({
      count: 1,
    });
    sqlite.close();
  });

  it('leaves a normal pending checkout migration for Drizzle to apply', () => {
    const { folder, hash, baselineSql } = createMigrationFolder();
    const sqlite = new Database(':memory:');
    createTrackingTable(sqlite);
    sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run(hash(baselineSql), 100);
    sqlite.exec(`
      CREATE TABLE cash_sessions (id text PRIMARY KEY);
      CREATE TABLE sales (id text PRIMARY KEY);
    `);

    expect(recoverMaterializedCheckoutTimingMigration(sqlite, folder)).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({
      count: 1,
    });
    sqlite.close();
  });

  it('does not advance a non-matching migration prefix', () => {
    const { folder } = createMigrationFolder();
    const sqlite = new Database(':memory:');
    createTrackingTable(sqlite);
    sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run('unknown-prefix', 100);
    sqlite.exec(`
      CREATE TABLE cash_sessions (pace_items_per_minute real);
      CREATE TABLE sales (checkout_started_at text, checkout_completed_at text);
    `);

    expect(recoverMaterializedCheckoutTimingMigration(sqlite, folder)).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()).toEqual({
      count: 1,
    });
    sqlite.close();
  });
});
