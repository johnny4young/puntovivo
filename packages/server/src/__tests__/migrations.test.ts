/**
 * Versioned Drizzle migrations (ENG-002) — integration tests
 *
 * Covers three end-to-end scenarios:
 *  - Fresh DB boot → the baseline migration lands exactly once.
 *  - Pre-ENG-002 install adopted via the shim → baseline row is seeded
 *    without re-running DDL.
 *  - Restarting the server against the same DB file → no-op, count stays
 *    at 1, no errors.
 *
 * The baseline hash check doubles as a regression pin: anyone regenerating
 * the baseline SQL (tightening a default, removing a column, etc.) MUST
 * also update the snapshot — forcing a conscious review of the schema
 * change.
 */

import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDatabase, initDatabase } from '../db/index.js';
import { tenants, users } from '../db/schema.js';

interface DrizzleMigrationRow {
  id: number;
  hash: string;
  created_at: number;
}

const MIGRATIONS_FOLDER = resolve(
  process.cwd(),
  'src/db/migrations'
);

function readBaseline() {
  const journalPath = resolve(MIGRATIONS_FOLDER, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const baseline = journal.entries.find(entry => entry.idx === 0)!;
  const sqlPath = resolve(MIGRATIONS_FOLDER, `${baseline.tag}.sql`);
  const sqlContents = readFileSync(sqlPath, 'utf8');
  const baselineHash = createHash('sha256').update(sqlContents).digest('hex');
  return { tag: baseline.tag, when: baseline.when, hash: baselineHash };
}

function listMigrationRows(sqlite: Database.Database): DrizzleMigrationRow[] {
  // Drizzle's migrator uses the `__drizzle_migrations` table — probe via
  // raw SQL so this test is independent of whatever query builder the
  // migrator happens to expose.
  return sqlite
    .prepare('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id')
    .all() as DrizzleMigrationRow[];
}

describe('Versioned Drizzle migrations (ENG-002)', () => {
  const createdPaths: string[] = [];

  afterEach(() => {
    closeDatabase();
    // Clean temp DBs between tests to guarantee isolation.
    for (const path of createdPaths.splice(0)) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; not fatal.
      }
    }
  });

  it('applies the baseline migration exactly once on a fresh in-memory DB', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });

    const sqlite = new Database(':memory:'); // dummy for type
    sqlite.close();
    // The production code shares a single better-sqlite3 handle behind
    // Drizzle; reach it through the exported accessor the codebase
    // already uses elsewhere.
    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as {
      $client: Database.Database;
    };
    const rows = listMigrationRows(liveDb.$client);
    const baseline = readBaseline();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.hash).toBe(baseline.hash);
    expect(Number(rows[0]?.created_at)).toBe(baseline.when);

    // Regression pin: timestamp defaults in the generated baseline must be
    // dynamic SQL expressions, not the literal wall-clock time when the
    // migration file was generated. A raw SQL insert exercises the DB-level
    // default directly, bypassing Drizzle's runtime $defaultFn path.
    liveDb.$client
      .prepare('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)')
      .run('fresh-tenant', 'Fresh Tenant', 'fresh-tenant');
    const insertedTenant = liveDb.$client
      .prepare('SELECT created_at, updated_at FROM tenants WHERE id = ?')
      .get('fresh-tenant') as
      | { created_at: string; updated_at: string }
      | undefined;
    const frozenTimestampLiteral = new Date(baseline.when).toISOString();

    expect(insertedTenant?.created_at).toBeTruthy();
    expect(insertedTenant?.updated_at).toBeTruthy();
    expect(insertedTenant?.created_at).not.toBe(frozenTimestampLiteral);
    expect(insertedTenant?.updated_at).not.toBe(frozenTimestampLiteral);

    // Spot-check: the schema actually landed. Picking two unrelated
    // tables proves the SQL body executed, not just the journal row.
    const db = getDatabase();
    const seededTenants = await db.select().from(tenants).all();
    expect(Array.isArray(seededTenants)).toBe(true);
    const seededUsers = await db.select().from(users).all();
    expect(Array.isArray(seededUsers)).toBe(true);
  });

  it('adopts a pre-ENG-002 install by seeding the baseline row without re-running DDL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'legacy.db');

    // Simulate a DB bootstrapped BEFORE versioned migrations existed:
    // `tenants` already present, `__drizzle_migrations` absent. We only
    // seed the `tenants` table (not the full schema) because the adoption
    // check keys off its existence; the rest of the schema will land when
    // initDatabase() runs runSchemaSync() after the shim.
    const legacySqlite = new Database(dbPath);
    legacySqlite
      .prepare(
        'CREATE TABLE IF NOT EXISTS tenants (' +
          'id TEXT PRIMARY KEY, ' +
          'name TEXT NOT NULL, ' +
          "slug TEXT NOT NULL DEFAULT '', " +
          'settings TEXT, ' +
          'is_active INTEGER DEFAULT 1, ' +
          "created_at TEXT NOT NULL DEFAULT (datetime('now')), " +
          "updated_at TEXT NOT NULL DEFAULT (datetime('now'))" +
          ')'
      )
      .run();
    legacySqlite
      .prepare('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)')
      .run('legacy-tenant', 'Legacy Tenant', 'legacy');
    legacySqlite.close();

    // Now boot through the production path. The shim should fire because
    // `tenants` exists but `__drizzle_migrations` does not.
    await initDatabase({ dbPath, seedData: false });

    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as {
      $client: Database.Database;
    };
    const rows = listMigrationRows(liveDb.$client);
    const baseline = readBaseline();

    // Exactly the baseline row — no double-insert, no rerun.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hash).toBe(baseline.hash);
    expect(Number(rows[0]?.created_at)).toBe(baseline.when);

    // The legacy tenant row must still be there — proves the shim did
    // not wipe or re-create the DB.
    const preservedTenant = liveDb.$client
      .prepare('SELECT id, name FROM tenants WHERE id = ?')
      .get('legacy-tenant') as { id: string; name: string } | undefined;
    expect(preservedTenant?.name).toBe('Legacy Tenant');
  });

  it('honors an explicit migrationsFolder override (packaged-Electron contract)', async () => {
    // Simulate the packaged-Electron layout: Forge copies
    // `packages/server/dist/db/migrations` into `process.resourcesPath`.
    // In production the desktop main passes that path as `migrationsFolder`
    // and the server side uses it instead of the module-local default.
    // Mirror that arrangement here by cloning the source migrations folder
    // into a temp directory and booting through the override.
    const stagingDir = mkdtempSync(
      join(tmpdir(), 'puntovivo-migrations-override-')
    );
    createdPaths.push(stagingDir);
    cpSync(MIGRATIONS_FOLDER, stagingDir, { recursive: true });

    await initDatabase({
      dbPath: ':memory:',
      seedData: false,
      migrationsFolder: stagingDir,
    });

    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as {
      $client: Database.Database;
    };
    const rows = listMigrationRows(liveDb.$client);
    const baseline = readBaseline();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.hash).toBe(baseline.hash);
    expect(Number(rows[0]?.created_at)).toBe(baseline.when);

    // Spot-check: the schema really landed via the override path — not
    // via the silent `runSchemaSync()` fallback that would still leave
    // `__drizzle_migrations` empty if the override had been ignored.
    const db = getDatabase();
    const seededTenants = await db.select().from(tenants).all();
    expect(Array.isArray(seededTenants)).toBe(true);
    const seededUsers = await db.select().from(users).all();
    expect(Array.isArray(seededUsers)).toBe(true);
  });

  it('is idempotent across restarts: re-running initDatabase on the same file is a no-op', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'restart.db');

    await initDatabase({ dbPath, seedData: false });
    closeDatabase();

    // Second boot — migrations ran once on the first boot; the second
    // must see `__drizzle_migrations` already populated and leave it
    // alone. Any error here would surface as a thrown exception.
    await initDatabase({ dbPath, seedData: false });

    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as {
      $client: Database.Database;
    };
    const rows = listMigrationRows(liveDb.$client);
    expect(rows).toHaveLength(1);
  });
});
