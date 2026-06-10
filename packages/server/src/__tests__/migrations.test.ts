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
import { resolveCachedNodeBinding } from '../db/native-binding.js';

// Raw probe connections must load the same Node-ABI addon initDatabase
// selects, or they die on dlopen whenever the on-disk default carries the
// Electron build.
const nativeBinding = resolveCachedNodeBinding();

interface DrizzleMigrationRow {
  id: number;
  hash: string;
  created_at: number;
}

const MIGRATIONS_FOLDER = resolve(
  process.cwd(),
  'src/db/migrations'
);

interface ExpectedMigration {
  tag: string;
  when: number;
  hash: string;
}

function readBaseline(): ExpectedMigration {
  return readExpectedMigrations()[0]!;
}

/**
 * Read every migration entry from `meta/_journal.json` so the assertions
 * scale automatically when new migrations are added on top of the
 * squashed `0000_baseline` (the 2026-06 squash condensed the
 * pre-production 44-file chain into one file). Each row in the live
 * `__drizzle_migrations` table must match one journal entry by order,
 * hash, and timestamp.
 */
function readExpectedMigrations(): ExpectedMigration[] {
  const journalPath = resolve(MIGRATIONS_FOLDER, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);
  return ordered.map(entry => {
    const sqlPath = resolve(MIGRATIONS_FOLDER, `${entry.tag}.sql`);
    const sqlContents = readFileSync(sqlPath, 'utf8');
    const hash = createHash('sha256').update(sqlContents).digest('hex');
    return { tag: entry.tag, when: entry.when, hash };
  });
}

function expectMigrationsMatchJournal(rows: DrizzleMigrationRow[]): void {
  const expected = readExpectedMigrations();
  expect(rows).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(rows[i]?.hash, `row ${i} hash`).toBe(expected[i]!.hash);
    expect(Number(rows[i]?.created_at), `row ${i} created_at`).toBe(
      expected[i]!.when
    );
  }
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

    const sqlite = new Database(':memory:', { nativeBinding }); // dummy for type
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
    expectMigrationsMatchJournal(rows);

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

  it('never bakes a stringified null default into the baseline (json-mode .default(null) trap)', () => {
    // Drizzle serializes `.default(null)` on `{ mode: 'json' }` text
    // columns through JSON.stringify, emitting DEFAULT 'null' — the
    // 4-character STRING, not SQL NULL. A row inserted without that
    // column would then carry 'null' and silently dodge IS NULL checks.
    // The 2026-06 squash removed every instance; this pin keeps any
    // regenerated baseline (or future migration) honest.
    const baselineSql = readFileSync(
      resolve(MIGRATIONS_FOLDER, `${readBaseline().tag}.sql`),
      'utf8'
    );
    expect(baselineSql).not.toMatch(/DEFAULT\s+'null'/i);
  });

  it('adopts a pre-ENG-002 install by seeding the baseline row without re-running DDL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'legacy.db');

    // Simulate a DB bootstrapped BEFORE versioned migrations existed:
    // `tenants` already present, `__drizzle_migrations` absent. We only
    // seed the `tenants` table (not the full schema) because the adoption
    // check keys off its existence; the rest of the schema is assumed to
    // have been materialised by a transitional release before the
    // upgrade (the seedCatalogs hook skips missing catalog tables with
    // an actionable warning).
    const legacySqlite = new Database(dbPath, { nativeBinding });
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

    // Exactly the journal entries — no double-insert, no rerun. The shim
    // adopts pre-ENG-002 installs by seeding the baseline row, and any
    // migration applied after the baseline (e.g. Iter 2's
    // `0001_receipt_templates`) must also be present because the
    // standard migrator runs them on top of the seeded baseline.
    expectMigrationsMatchJournal(rows);

    // The legacy tenant row must still be there — proves the shim did
    // not wipe or re-create the DB.
    const preservedTenant = liveDb.$client
      .prepare('SELECT id, name FROM tenants WHERE id = ?')
      .get('legacy-tenant') as { id: string; name: string } | undefined;
    expect(preservedTenant?.name).toBe('Legacy Tenant');
  });

  it('refuses to adopt a DB whose tables predate the journal (sentinel column missing)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-stale-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'stale.db');

    // Simulate an install that skipped the transitional release: it has a
    // `products` table from an era BEFORE 0039_eng177a_catalog_version, so
    // the `version` column never landed. Pinning the journal here would
    // mark 0039 as applied and the first catalog write would crash at
    // runtime instead — the adoption guard must refuse the boot with an
    // actionable error and must NOT seed the journal.
    const staleSqlite = new Database(dbPath, { nativeBinding });
    staleSqlite
      .prepare(
        'CREATE TABLE IF NOT EXISTS products (' +
          'id TEXT PRIMARY KEY, ' +
          'tenant_id TEXT NOT NULL, ' +
          'name TEXT NOT NULL' +
          ')'
      )
      .run();
    staleSqlite.close();

    await expect(initDatabase({ dbPath, seedData: false })).rejects.toThrow(
      /Cannot adopt this database: table 'products' is missing column 'version'/
    );

    // The guard fired BEFORE the journal seed: a follow-up inspection of
    // the raw file must show no pinned migrations, so a corrected upgrade
    // path (bridge release) can still adopt it properly later.
    const inspect = new Database(dbPath, { readonly: true, nativeBinding });
    const trackingTable = inspect
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = '__drizzle_migrations'"
      )
      .get() as { name: string } | undefined;
    if (trackingTable) {
      const pinned = inspect
        .prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations')
        .get() as { n: number };
      expect(pinned.n).toBe(0);
    }
    inspect.close();
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
    expectMigrationsMatchJournal(rows);

    // Spot-check: the schema really landed via the override path. If
    // the override had been ignored, drizzleMigrate would have thrown
    // because the default path is unlikely to resolve inside the temp
    // staging directory.
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
    expectMigrationsMatchJournal(rows);
  });

  it('hard-fails with an actionable error when the migrations folder is missing', async () => {
    // ENG-002 Step 3 — the legacy `runSchemaSync()` fallback used to
    // cover the missing-folder case with a warn. After retirement the
    // path must throw loudly so malformed deployments surface instead
    // of silently booting against an empty schema.
    const missingFolder = join(
      tmpdir(),
      `puntovivo-no-migrations-${Date.now()}`
    );

    await expect(
      initDatabase({
        dbPath: ':memory:',
        seedData: false,
        migrationsFolder: missingFolder,
      })
    ).rejects.toThrowError(/migrations folder missing/);
  });

  it('populates catalog rows on an adopted DB whose schema was already materialised', async () => {
    // ENG-002 Step 3 regression pin: adopted DBs whose journal is
    // pinned by ensureMigrationBaseline() skip every migration, so
    // seedCatalogs() is the only path that still writes the seed
    // rows on every boot. This test seeds the catalog tables empty
    // (mimicking a DB that went through dual-path materialisation at
    // least once but whose catalog rows got wiped or never populated)
    // and asserts the post-migration hook refills them.
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-adopted-catalogs-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'adopted.db');

    const legacy = new Database(dbPath, { nativeBinding });
    const runDdl = (sql: string): void => {
      legacy.prepare(sql).run();
    };
    // Pre-existing schema: a handful of tables that the shim probe
    // keys off (tenants) plus the catalog tables the seeder targets,
    // empty. This is a realistic shape for an install that booted
    // under dual-path code and then had its catalog rows cleared
    // for a test scenario — the seeder is the recovery path.
    runDdl(
      'CREATE TABLE IF NOT EXISTS tenants (' +
        'id TEXT PRIMARY KEY, ' +
        'name TEXT NOT NULL, ' +
        "slug TEXT NOT NULL DEFAULT '', " +
        'settings TEXT, ' +
        'is_active INTEGER DEFAULT 1, ' +
        "created_at TEXT NOT NULL DEFAULT (datetime('now')), " +
        "updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
    );
    runDdl(
      'CREATE TABLE IF NOT EXISTS currency_catalog (' +
        'code TEXT PRIMARY KEY, ' +
        'name_en TEXT NOT NULL, ' +
        'name_es TEXT NOT NULL, ' +
        'symbol TEXT NOT NULL, ' +
        'decimals INTEGER NOT NULL, ' +
        'display_decimals INTEGER NOT NULL)'
    );
    runDdl(
      'CREATE TABLE IF NOT EXISTS country_catalog (' +
        'code TEXT PRIMARY KEY, ' +
        'name_en TEXT NOT NULL, ' +
        'name_es TEXT NOT NULL, ' +
        'default_locale TEXT NOT NULL, ' +
        'general_locale TEXT NOT NULL, ' +
        'default_currency_code TEXT NOT NULL, ' +
        "additional_currency_codes TEXT NOT NULL DEFAULT '[]', " +
        'default_timezone TEXT NOT NULL, ' +
        'first_day_of_week INTEGER NOT NULL, ' +
        'date_format_short TEXT NOT NULL, ' +
        'date_format_long TEXT NOT NULL, ' +
        "tax_id_types_hint TEXT NOT NULL DEFAULT '[]', " +
        'ui_locale_ready INTEGER NOT NULL DEFAULT 1)'
    );
    // ENG-176c — adopted DBs that ran through every migration up to
    // 0038 carry the renamed `fiscal_identification_types` (composite
    // PK) shape; the bridge shim keeps that name intact on rollout.
    runDdl(
      'CREATE TABLE IF NOT EXISTS fiscal_identification_types (' +
        'country_code TEXT NOT NULL, ' +
        'code TEXT NOT NULL, ' +
        'abbr TEXT NOT NULL, ' +
        'name_es TEXT NOT NULL, ' +
        'name_en TEXT NOT NULL, ' +
        'natural_person INTEGER NOT NULL, ' +
        'PRIMARY KEY (country_code, code))'
    );
    legacy.close();

    await initDatabase({ dbPath, seedData: false });

    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as {
      $client: Database.Database;
    };

    const currencyCount = (liveDb.$client
      .prepare('SELECT COUNT(*) AS count FROM currency_catalog')
      .get() as { count: number } | undefined)?.count ?? 0;
    const countryCount = (liveDb.$client
      .prepare('SELECT COUNT(*) AS count FROM country_catalog')
      .get() as { count: number } | undefined)?.count ?? 0;
    // ENG-176c — `dian_identification_types` renamed to
    // `fiscal_identification_types` in migration 0038. The catalog now
    // carries CO + MX + PE + CL rows; CO still owns the 10 DIAN rows
    // verbatim post-rename.
    const fiscalIdentCount = (liveDb.$client
      .prepare('SELECT COUNT(*) AS count FROM fiscal_identification_types')
      .get() as { count: number } | undefined)?.count ?? 0;
    const fiscalIdentCoCount = (liveDb.$client
      .prepare(
        "SELECT COUNT(*) AS count FROM fiscal_identification_types WHERE country_code = 'CO'"
      )
      .get() as { count: number } | undefined)?.count ?? 0;

    expect(currencyCount).toBeGreaterThanOrEqual(18);
    expect(countryCount).toBeGreaterThanOrEqual(21);
    expect(fiscalIdentCount).toBe(23);
    expect(fiscalIdentCoCount).toBe(10);
  });
});
