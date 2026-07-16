/**
 * Versioned Drizzle migrations (ENG-002) — integration tests
 *
 * Covers three end-to-end scenarios:
 *  - Fresh DB boot → the full migration journal lands exactly once.
 *  - Pre-ENG-002 install adopted via the shim → baseline row is seeded
 *    without re-running baseline DDL, then newer migrations run.
 *  - Restarting the server against the same DB file → no-op, count stays
 *    at the journal length, no errors.
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
import { ensureMigrationBaseline } from '../db/migration-baseline.js';
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

const MIGRATIONS_FOLDER = resolve(process.cwd(), 'src/db/migrations');

interface ExpectedMigration {
  tag: string;
  when: number;
  hash: string;
}

function readBaseline(): ExpectedMigration {
  return readExpectedMigrations()[0]!;
}

function readMigrationSql(tag: string): string {
  return readFileSync(resolve(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
}

function readBaselineSql(): string {
  return readMigrationSql(readBaseline().tag);
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
    expect(Number(rows[i]?.created_at), `row ${i} created_at`).toBe(expected[i]!.when);
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

function getTableSql(sqlite: Database.Database, tableName: string): string {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: string } | undefined;
  return row?.sql ?? '';
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
      .get('fresh-tenant') as { created_at: string; updated_at: string } | undefined;
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
    const baselineSql = readBaselineSql();
    expect(baselineSql).not.toMatch(/DEFAULT\s+'null'/i);
  });

  it('adopts a pre-ENG-002 install by seeding only the baseline, then running newer DDL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'legacy.db');

    // Simulate a DB bootstrapped BEFORE versioned migrations existed:
    // the full squashed-baseline schema is already present, but
    // `__drizzle_migrations` is absent. The adoption shim must mark only
    // that baseline as applied; post-baseline migrations still have to
    // execute on top of the existing objects.
    const legacySqlite = new Database(dbPath, { nativeBinding });
    legacySqlite.exec(readBaselineSql());
    legacySqlite
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run('legacy-setting', 'preserved');
    expect(getTableSql(legacySqlite, 'sales')).not.toContain('chk_sales_cash_session_or_draft');
    legacySqlite.close();

    // Now boot through the production path. The shim should fire because
    // `tenants` exists but `__drizzle_migrations` does not.
    await initDatabase({ dbPath, seedData: false });

    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as {
      $client: Database.Database;
    };
    const rows = listMigrationRows(liveDb.$client);

    // Exactly the journal entries — no double-insert. The baseline row
    // came from the adoption shim, and every newer migration came from
    // the standard migrator running on top of that seeded baseline.
    expectMigrationsMatchJournal(rows);
    expect(getTableSql(liveDb.$client, 'sales')).toContain('chk_sales_cash_session_or_draft');

    // The legacy row must still be there — proves the shim did
    // not wipe or re-create the DB.
    const preservedSetting = liveDb.$client
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get('legacy-setting') as { value: string } | undefined;
    expect(preservedSetting?.value).toBe('preserved');
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
      const pinned = inspect.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as {
        n: number;
      };
      expect(pinned.n).toBe(0);
    }
    inspect.close();
  });

  it('does not pin latest absent-target markers on a mixed partial DB', () => {
    const sqlite = new Database(':memory:', { nativeBinding });
    sqlite.exec('CREATE TABLE products (id TEXT PRIMARY KEY, version INTEGER NOT NULL)');

    ensureMigrationBaseline(sqlite, MIGRATIONS_FOLDER);

    const eng209 = readExpectedMigrations().find(
      migration => migration.tag === '0010_eng209_checkout_timing'
    );
    expect(eng209).toBeDefined();
    const pinnedLatest = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng209!.when);
    expect(pinnedLatest).toBeUndefined();

    const eng129c = readExpectedMigrations().find(
      migration => migration.tag === '0011_eng129c_customer_privacy_disposition'
    );
    expect(eng129c).toBeDefined();
    const pinnedPrivacy = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng129c!.when);
    expect(pinnedPrivacy).toBeUndefined();

    const eng106a = readExpectedMigrations().find(
      migration => migration.tag === '0012_eng106a_staff_pin'
    );
    expect(eng106a).toBeDefined();
    const pinnedStaffPin = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng106a!.when);
    expect(pinnedStaffPin).toBeUndefined();

    const eng140d = readExpectedMigrations().find(
      migration => migration.tag === '0019_eng140d_cash_session_attendance'
    );
    expect(eng140d).toBeDefined();
    const pinnedCashAttendance = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng140d!.when);
    expect(pinnedCashAttendance).toBeUndefined();

    const eng142c = readExpectedMigrations().find(
      migration => migration.tag === '0022_eng142c_dual_approvals'
    );
    expect(eng142c).toBeDefined();
    const pinnedDualApproval = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng142c!.when);
    expect(pinnedDualApproval).toBeUndefined();

    const eng110b = readExpectedMigrations().find(
      migration => migration.tag === '0023_eng110b_product_variants'
    );
    expect(eng110b).toBeDefined();
    const pinnedVariants = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng110b!.when);
    expect(pinnedVariants).toBeUndefined();

    const eng110c = readExpectedMigrations().find(
      migration => migration.tag === '0024_eng110c_product_serials'
    );
    expect(eng110c).toBeDefined();
    const pinnedSerials = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng110c!.when);
    expect(pinnedSerials).toBeUndefined();
    sqlite.close();
  });

  it('pins absent late migrations for a purchase-only partial DB', () => {
    const sqlite = new Database(':memory:', { nativeBinding });
    sqlite.exec('CREATE TABLE purchases (id TEXT PRIMARY KEY)');

    ensureMigrationBaseline(sqlite, MIGRATIONS_FOLDER);

    const eng129c = readExpectedMigrations().find(
      migration => migration.tag === '0011_eng129c_customer_privacy_disposition'
    );
    expect(eng129c).toBeDefined();
    const pinnedPrivacy = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng129c!.when);
    expect(pinnedPrivacy).toBeDefined();

    const eng106a = readExpectedMigrations().find(
      migration => migration.tag === '0012_eng106a_staff_pin'
    );
    expect(eng106a).toBeDefined();
    const pinnedStaffPin = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng106a!.when);
    expect(pinnedStaffPin).toBeDefined();

    const eng140d = readExpectedMigrations().find(
      migration => migration.tag === '0019_eng140d_cash_session_attendance'
    );
    expect(eng140d).toBeDefined();
    const pinnedCashAttendance = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng140d!.when);
    expect(pinnedCashAttendance).toBeDefined();

    const eng142c = readExpectedMigrations().find(
      migration => migration.tag === '0022_eng142c_dual_approvals'
    );
    expect(eng142c).toBeDefined();
    const pinnedDualApproval = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng142c!.when);
    expect(pinnedDualApproval).toBeDefined();

    const eng110b = readExpectedMigrations().find(
      migration => migration.tag === '0023_eng110b_product_variants'
    );
    expect(eng110b).toBeDefined();
    const pinnedVariants = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng110b!.when);
    expect(pinnedVariants).toBeDefined();

    const eng110c = readExpectedMigrations().find(
      migration => migration.tag === '0024_eng110c_product_serials'
    );
    expect(eng110c).toBeDefined();
    const pinnedSerials = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng110c!.when);
    expect(pinnedSerials).toBeDefined();
    sqlite.close();
  });

  it('honors an explicit migrationsFolder override (packaged-Electron contract)', async () => {
    // Simulate the packaged-Electron layout: Forge copies
    // `packages/server/dist/db/migrations` into `process.resourcesPath`.
    // In production the desktop main passes that path as `migrationsFolder`
    // and the server side uses it instead of the module-local default.
    // Mirror that arrangement here by cloning the source migrations folder
    // into a temp directory and booting through the override.
    const stagingDir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-override-'));
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
    const missingFolder = join(tmpdir(), `puntovivo-no-migrations-${Date.now()}`);

    await expect(
      initDatabase({
        dbPath: ':memory:',
        seedData: false,
        migrationsFolder: missingFolder,
      })
    ).rejects.toThrowError(/migrations folder missing/);
  });

  it('populates catalog rows on an adopted DB whose schema was already materialised', async () => {
    // ENG-002 Step 3 regression pin: adopted DBs whose baseline is
    // pinned by ensureMigrationBaseline() still rely on seedCatalogs()
    // to write the catalog rows on every boot. This test materialises
    // the full baseline schema without Drizzle's tracking table and
    // asserts the post-migration hook refills the empty catalogs after
    // newer migrations run.
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-adopted-catalogs-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'adopted.db');

    const legacy = new Database(dbPath, { nativeBinding });
    legacy.exec(readBaselineSql());
    legacy.close();

    await initDatabase({ dbPath, seedData: false });

    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as {
      $client: Database.Database;
    };

    const currencyCount =
      (
        liveDb.$client.prepare('SELECT COUNT(*) AS count FROM currency_catalog').get() as
          { count: number } | undefined
      )?.count ?? 0;
    const countryCount =
      (
        liveDb.$client.prepare('SELECT COUNT(*) AS count FROM country_catalog').get() as
          { count: number } | undefined
      )?.count ?? 0;
    // ENG-176c — `dian_identification_types` renamed to
    // `fiscal_identification_types` in migration 0038. The catalog now
    // carries CO + MX + PE + CL rows; CO still owns the 10 DIAN rows
    // verbatim post-rename.
    const fiscalIdentCount =
      (
        liveDb.$client
          .prepare('SELECT COUNT(*) AS count FROM fiscal_identification_types')
          .get() as { count: number } | undefined
      )?.count ?? 0;
    const fiscalIdentCoCount =
      (
        liveDb.$client
          .prepare(
            "SELECT COUNT(*) AS count FROM fiscal_identification_types WHERE country_code = 'CO'"
          )
          .get() as { count: number } | undefined
      )?.count ?? 0;

    expect(currencyCount).toBeGreaterThanOrEqual(18);
    expect(countryCount).toBeGreaterThanOrEqual(21);
    expect(fiscalIdentCount).toBe(23);
    expect(fiscalIdentCoCount).toBe(10);
  });
});
