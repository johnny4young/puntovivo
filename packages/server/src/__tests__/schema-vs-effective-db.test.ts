/**
 * What `schema.ts` declares must match what the migrations actually build.
 *
 * Drizzle's snapshots are generated FROM `schema.ts`, so every existing gate
 * compares the schema against itself. Nothing compares it against the database
 * the migration chain really produces. Two defects in this branch lived in
 * exactly that gap: a rebuild generated from a stale snapshot silently dropped
 * `sales.return_state`, and `0026` declared
 * `product_serials.source_purchase_item_id` with no ON DELETE clause while the
 * schema says `restrict`.
 *
 * This gate migrates a real empty database and reads its shape back out of
 * `sqlite_master` / `PRAGMA`, then compares that against the newest snapshot —
 * the artifact drizzle will generate the NEXT migration from. Any place they
 * disagree is a place a future `drizzle-kit generate` will emit a surprise.
 *
 * Hand-written SQL is allowed to be ahead of the schema in shapes drizzle
 * cannot express; those live in `KNOWN_DIVERGENCES` with a reason, so the
 * list is a visible debt register rather than an invisible drift.
 *
 * @module __tests__/schema-vs-effective-db.test
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type DatabaseType from 'better-sqlite3';

import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';

const MIGRATIONS = resolve(process.cwd(), 'src/db/migrations');

interface SnapshotColumn {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
}

interface SnapshotForeignKey {
  name: string;
  tableFrom: string;
  columnsFrom: string[];
  tableTo: string;
  columnsTo: string[];
  onDelete?: string;
  onUpdate?: string;
}

interface SnapshotTable {
  name: string;
  columns: Record<string, SnapshotColumn>;
  foreignKeys: Record<string, SnapshotForeignKey>;
}

/**
 * A divergence that is understood and deliberately left in place. Removing an
 * entry must make the gate pass, not fail — an entry that no longer describes
 * a real divergence is itself a failure, so this list cannot rot.
 */
const KNOWN_DIVERGENCES: Array<{ table: string; column: string; because: string }> = [
  {
    table: 'product_serials',
    column: 'source_purchase_item_id',
    because:
      '0026 added the column with a bare REFERENCES and no ON DELETE clause, so the effective ' +
      'database carries NO ACTION while the schema declares restrict. Repairing it means a table ' +
      'rebuild of product_serials, which is the exact migration shape that already lost a column ' +
      'twice in this branch. Left divergent on purpose; SQLite enforces both as a refusal to ' +
      'delete a referenced parent under PRAGMA foreign_keys=ON, and the difference only shows ' +
      'with deferred constraints, which this schema never declares.',
  },
];

let workdir: string;
let sqlite: DatabaseType.Database;

/** The newest snapshot: what drizzle will generate the next migration from. */
function latestSnapshot(): Record<string, SnapshotTable> {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number }>;
  };
  const newest = Math.max(...journal.entries.map(entry => entry.idx));
  const snapshot = JSON.parse(
    readFileSync(
      join(MIGRATIONS, 'meta', `${String(newest).padStart(4, '0')}_snapshot.json`),
      'utf8'
    )
  ) as { tables: Record<string, SnapshotTable> };
  return snapshot.tables;
}

function effectiveTables(): Set<string> {
  const rows = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map(row => row.name));
}

function effectiveColumns(table: string): Map<string, { type: string; notNull: boolean }> {
  const rows = sqlite.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }>;
  return new Map(
    rows.map(row => [row.name, { type: row.type.toLowerCase(), notNull: row.notnull === 1 }])
  );
}

function effectiveForeignKeys(
  table: string
): Map<string, { table: string; to: string; onDelete: string }> {
  const rows = sqlite.prepare(`PRAGMA foreign_key_list(${JSON.stringify(table)})`).all() as Array<{
    table: string;
    from: string;
    to: string | null;
    on_delete: string;
  }>;
  return new Map(
    rows.map(row => [
      row.from,
      { table: row.table, to: row.to ?? 'id', onDelete: row.on_delete.toLowerCase() },
    ])
  );
}

/** Drizzle writes 'no action' for an omitted clause; SQLite reports the same. */
function normalizeAction(action: string | undefined): string {
  return (action ?? 'no action').toLowerCase().replace(/_/g, ' ');
}

describe('schema vs the database the migrations actually build', () => {
  beforeAll(async () => {
    workdir = mkdtempSync(join(tmpdir(), 'puntovivo-effective-'));
    await initDatabase({
      dbPath: join(workdir, 'effective.db'),
      seedData: false,
      migrationsFolder: MIGRATIONS,
    });
    sqlite = (getDatabase() as unknown as { $client: DatabaseType.Database }).$client;
  }, 180_000);

  afterAll(() => {
    closeDatabase();
    rmSync(workdir, { recursive: true, force: true });
  });

  it('builds a database with the tables the snapshot declares', () => {
    const snapshot = latestSnapshot();
    const built = effectiveTables();
    // Guards the guard: an empty snapshot or an unmigrated database would make
    // every comparison below vacuous.
    expect(Object.keys(snapshot).length).toBeGreaterThan(100);
    const missing = Object.keys(snapshot).filter(name => !built.has(name));
    expect(missing, 'the snapshot declares tables the migrations never create').toEqual([]);
  });

  it('agrees on every column name, type and nullability', () => {
    const mismatches: string[] = [];
    for (const [tableName, table] of Object.entries(latestSnapshot())) {
      const built = effectiveColumns(tableName);
      for (const column of Object.values(table.columns)) {
        const actual = built.get(column.name);
        if (!actual) {
          mismatches.push(`${tableName}.${column.name}: declared, not built`);
          continue;
        }
        if (actual.notNull !== (column.notNull || column.primaryKey)) {
          mismatches.push(
            `${tableName}.${column.name}: snapshot notNull=${column.notNull}, database notNull=${actual.notNull}`
          );
        }
      }
      for (const built_name of built.keys()) {
        if (!Object.values(table.columns).some(column => column.name === built_name)) {
          mismatches.push(`${tableName}.${built_name}: built, not declared`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('agrees on every foreign key ON DELETE action', () => {
    const allowed = new Set(KNOWN_DIVERGENCES.map(entry => `${entry.table}.${entry.column}`));
    const mismatches: string[] = [];
    const confirmed = new Set<string>();

    for (const [tableName, table] of Object.entries(latestSnapshot())) {
      const built = effectiveForeignKeys(tableName);
      for (const fk of Object.values(table.foreignKeys)) {
        // Composite keys are rare here and their per-column mapping is not
        // what this gate is about; the ON DELETE action is.
        const column = fk.columnsFrom[0];
        if (!column) continue;
        const actual = built.get(column);
        if (!actual) continue;
        if (normalizeAction(fk.onDelete) === actual.onDelete) continue;
        const key = `${tableName}.${column}`;
        if (allowed.has(key)) {
          confirmed.add(key);
          continue;
        }
        mismatches.push(
          `${key} -> ${fk.tableTo}: snapshot ${normalizeAction(fk.onDelete)}, database ${actual.onDelete}`
        );
      }
    }

    expect(mismatches).toEqual([]);
    // Every declared divergence must still BE one. A stale entry would quietly
    // license a future real drift on the same column.
    const stale = [...allowed].filter(key => !confirmed.has(key));
    expect(stale, 'KNOWN_DIVERGENCES entries that no longer describe a divergence').toEqual([]);
  });

  it('states a reason for every divergence it tolerates', () => {
    for (const entry of KNOWN_DIVERGENCES) {
      expect(entry.because.length, `${entry.table}.${entry.column}`).toBeGreaterThan(80);
    }
  });
});
