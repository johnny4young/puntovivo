/**
 * Versioned Drizzle migrations () — integration tests
 *
 * Covers three end-to-end scenarios:
 * - Fresh DB boot → the full migration journal lands exactly once.
 * - Pre- install adopted via the shim → baseline row is seeded
 * without re-running baseline DDL, then newer migrations run.
 * - Restarting the server against the same DB file → no-op, count stays
 * at the journal length, no errors.
 *
 * The baseline hash check doubles as a regression pin: anyone regenerating
 * the baseline SQL (tightening a default, removing a column, etc.) MUST
 * also update the snapshot — forcing a conscious review of the schema
 * change.
 */

import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDatabase, initDatabase } from '../db/index.js';
import { ensureMigrationBaseline } from '../db/migration-baseline.js';
import { tenants, users } from '../db/schema.js';

interface DrizzleMigrationRow {
  rowId: number;
  id: number | null;
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

function copyMigrationPrefix(destination: string, migrationCount: number): void {
  cpSync(MIGRATIONS_FOLDER, destination, { recursive: true });
  const journalPath = resolve(destination, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ idx: number }>;
  };
  journal.entries = journal.entries
    .toSorted((left, right) => left.idx - right.idx)
    .slice(0, migrationCount);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
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
    .prepare('SELECT rowid AS rowId, id, hash, created_at FROM __drizzle_migrations ORDER BY rowid')
    .all() as DrizzleMigrationRow[];
}

function getTableSql(sqlite: Database.Database, tableName: string): string {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: string } | undefined;
  return row?.sql ?? '';
}

describe('Versioned Drizzle migrations', () => {
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

    const transformationOutputColumns = new Set(
      (
        liveDb.$client
          .prepare('PRAGMA table_info(inventory_transformation_outputs)')
          .all() as Array<{ name: string }>
      ).map(column => column.name)
    );
    expect([...transformationOutputColumns]).toEqual(
      expect.arrayContaining([
        'previous_product_cost',
        'previous_product_initial_cost',
        'resulting_product_cost',
        'resulting_product_initial_cost',
        'resulting_product_sync_version',
        'resulting_balance_version',
      ])
    );
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

  it('adopts a pre- install by seeding only the baseline, then running newer DDL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'legacy.db');

    // Simulate a DB bootstrapped BEFORE versioned migrations existed:
    // the full squashed-baseline schema is already present, but
    // `__drizzle_migrations` is absent. The adoption shim must mark only
    // that baseline as applied; post-baseline migrations still have to
    // execute on top of the existing objects.
    const legacySqlite = new Database(dbPath);
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

  it('recovers a fully materialised checkout-timing schema whose journal stops at 0010', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-checkout-tracking-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'stale-checkout-tracking.db');
    const historicalMigrations = join(dir, 'migrations-through-0010');
    copyMigrationPrefix(historicalMigrations, 11);

    await initDatabase({
      dbPath,
      seedData: false,
      migrationsFolder: historicalMigrations,
    });
    closeDatabase();

    const stale = new Database(dbPath);
    stale.transaction(() => {
      stale
        .prepare('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)')
        .run('tracking-tenant', 'Tracking Tenant', 'tracking-tenant');
      stale
        .prepare('INSERT INTO companies (id, tenant_id, name) VALUES (?, ?, ?)')
        .run('tracking-company', 'tracking-tenant', 'Tracking Company');
      stale
        .prepare('INSERT INTO sites (id, tenant_id, company_id, name) VALUES (?, ?, ?, ?)')
        .run('tracking-site', 'tracking-tenant', 'tracking-company', 'Tracking Site');
      stale
        .prepare(
          'INSERT INTO users (id, tenant_id, email, name, password_hash) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          'tracking-user',
          'tracking-tenant',
          'tracking@example.test',
          'Tracking User',
          'not-a-real-password-hash'
        );
      stale
        .prepare(
          'INSERT INTO cash_sessions ' +
            '(id, tenant_id, site_id, cashier_id, register_name, opening_count_denominations, status, opened_at, closed_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          'tracking-session',
          'tracking-tenant',
          'tracking-site',
          'tracking-user',
          'Register 1',
          '{}',
          'closed',
          '2026-07-22T12:00:00.000Z',
          '2026-07-22T12:10:00.000Z'
        );
      stale
        .prepare('INSERT INTO products (id, tenant_id, name, sku) VALUES (?, ?, ?, ?)')
        .run('tracking-product', 'tracking-tenant', 'Tracking Product', 'TRACK-1');
      stale
        .prepare(
          'INSERT INTO sales ' +
            '(id, tenant_id, sale_number, status, cash_session_id, created_by) ' +
            'VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(
          'tracking-sale',
          'tracking-tenant',
          'TRACK-0001',
          'completed',
          'tracking-session',
          'tracking-user'
        );
      stale
        .prepare('INSERT INTO sale_items (id, sale_id, product_id, quantity) VALUES (?, ?, ?, ?)')
        .run('tracking-item', 'tracking-sale', 'tracking-product', 3);
      stale
        .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
        .run('tracking-sentinel', 'preserved');
    })();
    stale.exec(
      'ALTER TABLE cash_sessions ADD pace_items_per_minute real;' +
        'ALTER TABLE sales ADD checkout_started_at text;' +
        'ALTER TABLE sales ADD checkout_completed_at text;'
    );
    stale
      .prepare('UPDATE sales SET checkout_started_at = ?, checkout_completed_at = ? WHERE id = ?')
      .run('2026-07-22T12:08:00.000Z', '2026-07-22T12:09:00.000Z', 'tracking-sale');
    expect(listMigrationRows(stale)).toHaveLength(11);
    stale.close();

    await initDatabase({ dbPath, seedData: false });

    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as { $client: Database.Database };
    expectMigrationsMatchJournal(listMigrationRows(liveDb.$client));
    expect(
      liveDb.$client
        .prepare(
          'SELECT checkout_started_at AS startedAt, checkout_completed_at AS completedAt ' +
            'FROM sales WHERE id = ?'
        )
        .get('tracking-sale')
    ).toEqual({
      startedAt: '2026-07-22T12:08:00.000Z',
      completedAt: '2026-07-22T12:09:00.000Z',
    });
    expect(
      liveDb.$client
        .prepare('SELECT pace_items_per_minute AS pace FROM cash_sessions WHERE id = ?')
        .get('tracking-session')
    ).toEqual({ pace: 0.3 });
    expect(
      liveDb.$client
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get('tracking-sentinel')
    ).toEqual({ value: 'preserved' });
    expect(liveDb.$client.pragma('foreign_key_check')).toEqual([]);
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
    const staleSqlite = new Database(dbPath);
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
    const inspect = new Database(dbPath, { readonly: true });
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
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE products (id TEXT PRIMARY KEY, version INTEGER NOT NULL)');

    ensureMigrationBaseline(sqlite, MIGRATIONS_FOLDER);

    const eng209 = readExpectedMigrations().find(
      migration => migration.tag === '0011_eng209_checkout_timing'
    );
    expect(eng209).toBeDefined();
    const pinnedLatest = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng209!.when);
    expect(pinnedLatest).toBeUndefined();

    const eng129c = readExpectedMigrations().find(
      migration => migration.tag === '0012_eng129c_customer_privacy_disposition'
    );
    expect(eng129c).toBeDefined();
    const pinnedPrivacy = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng129c!.when);
    expect(pinnedPrivacy).toBeUndefined();

    const eng106a = readExpectedMigrations().find(
      migration => migration.tag === '0013_eng106a_staff_pin'
    );
    expect(eng106a).toBeDefined();
    const pinnedStaffPin = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng106a!.when);
    expect(pinnedStaffPin).toBeUndefined();

    const eng140d = readExpectedMigrations().find(
      migration => migration.tag === '0020_eng140d_cash_session_attendance'
    );
    expect(eng140d).toBeDefined();
    const pinnedCashAttendance = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng140d!.when);
    expect(pinnedCashAttendance).toBeUndefined();

    const eng142c = readExpectedMigrations().find(
      migration => migration.tag === '0023_eng142c_dual_approvals'
    );
    expect(eng142c).toBeDefined();
    const pinnedDualApproval = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng142c!.when);
    expect(pinnedDualApproval).toBeUndefined();

    const eng110b = readExpectedMigrations().find(
      migration => migration.tag === '0024_eng110b_product_variants'
    );
    expect(eng110b).toBeDefined();
    const pinnedVariants = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng110b!.when);
    expect(pinnedVariants).toBeUndefined();

    const eng110c = readExpectedMigrations().find(
      migration => migration.tag === '0025_eng110c_product_serials'
    );
    expect(eng110c).toBeDefined();
    const pinnedSerials = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng110c!.when);
    expect(pinnedSerials).toBeUndefined();

    for (const tag of [
      '0026_eng110d_serial_logistics',
      '0027_ux6a_task_measurement',
      '0028_sale_display_snapshots',
      '0029_receipt_identity_snapshots',
      '0030_receipt_presentation_snapshots',
      '0032_copilot_response_mode',
      '0034_illegal_bloodstrike',
      '0035_product_exact_lookup',
      '0036_product_fts_search',
      '0037_product_embedding_blob',
      '0038_product_tracks_stock',
      '0039_sale_item_tracks_stock_snapshot',
      '0040_tax_kind',
      '0041_price_tier',
      '0042_unit_standard_code_snapshot',
      '0043_audit_hash_chain',
      '0044_audit_head_mac',
      '0045_price_tier_unit_grid',
      '0046_quotation_tax_kind_snapshot',
      '0047_normalized_tax_components',
      '0048_audit_anchor_freshness',
      '0049_long_human_fly',
      '0050_hard_hercules',
      '0051_steep_thanos',
      '0052_neat_blazing_skull',
      '0053_minor_prism',
      '0054_retail_inventory_counts',
      '0055_lovely_misty_knight',
      '0056_mean_pandemic',
      '0057_pharmacy_policy_lot_recall',
    ]) {
      const migration = readExpectedMigrations().find(entry => entry.tag === tag);
      expect(migration).toBeDefined();
      const pinned = sqlite
        .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
        .get(migration!.when);
      expect(pinned).toBeUndefined();
    }
    sqlite.close();
  });

  it('keeps the movement-site migration pending when its ledger target exists', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE inventory_movements (id TEXT PRIMARY KEY)');

    ensureMigrationBaseline(sqlite, MIGRATIONS_FOLDER);

    const movementSiteMigration = readExpectedMigrations().find(
      migration => migration.tag === '0050_hard_hercules'
    );
    expect(movementSiteMigration).toBeDefined();
    const pinnedMovementSiteMigration = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(movementSiteMigration!.when);
    expect(pinnedMovementSiteMigration).toBeUndefined();

    sqlite.close();
  });

  it('pins absent late migrations for a purchase-only partial DB', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE purchases (id TEXT PRIMARY KEY)');

    ensureMigrationBaseline(sqlite, MIGRATIONS_FOLDER);

    const eng129c = readExpectedMigrations().find(
      migration => migration.tag === '0012_eng129c_customer_privacy_disposition'
    );
    expect(eng129c).toBeDefined();
    const pinnedPrivacy = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng129c!.when);
    expect(pinnedPrivacy).toBeDefined();

    const eng106a = readExpectedMigrations().find(
      migration => migration.tag === '0013_eng106a_staff_pin'
    );
    expect(eng106a).toBeDefined();
    const pinnedStaffPin = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng106a!.when);
    expect(pinnedStaffPin).toBeDefined();

    const eng140d = readExpectedMigrations().find(
      migration => migration.tag === '0020_eng140d_cash_session_attendance'
    );
    expect(eng140d).toBeDefined();
    const pinnedCashAttendance = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng140d!.when);
    expect(pinnedCashAttendance).toBeDefined();

    const eng142c = readExpectedMigrations().find(
      migration => migration.tag === '0023_eng142c_dual_approvals'
    );
    expect(eng142c).toBeDefined();
    const pinnedDualApproval = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng142c!.when);
    expect(pinnedDualApproval).toBeDefined();

    const eng110b = readExpectedMigrations().find(
      migration => migration.tag === '0024_eng110b_product_variants'
    );
    expect(eng110b).toBeDefined();
    const pinnedVariants = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng110b!.when);
    expect(pinnedVariants).toBeDefined();

    const eng110c = readExpectedMigrations().find(
      migration => migration.tag === '0025_eng110c_product_serials'
    );
    expect(eng110c).toBeDefined();
    const pinnedSerials = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(eng110c!.when);
    expect(pinnedSerials).toBeDefined();

    for (const tag of [
      '0026_eng110d_serial_logistics',
      '0027_ux6a_task_measurement',
      '0028_sale_display_snapshots',
      '0029_receipt_identity_snapshots',
      '0030_receipt_presentation_snapshots',
      '0032_copilot_response_mode',
      '0034_illegal_bloodstrike',
      '0035_product_exact_lookup',
      '0036_product_fts_search',
      '0037_product_embedding_blob',
      '0038_product_tracks_stock',
      '0039_sale_item_tracks_stock_snapshot',
      '0040_tax_kind',
      '0041_price_tier',
      '0042_unit_standard_code_snapshot',
      '0043_audit_hash_chain',
      '0044_audit_head_mac',
      '0045_price_tier_unit_grid',
      '0046_quotation_tax_kind_snapshot',
      '0047_normalized_tax_components',
      '0048_audit_anchor_freshness',
      '0049_long_human_fly',
      '0050_hard_hercules',
      '0051_steep_thanos',
      '0052_neat_blazing_skull',
      '0053_minor_prism',
      '0054_retail_inventory_counts',
      '0055_lovely_misty_knight',
      '0056_mean_pandemic',
      '0057_pharmacy_policy_lot_recall',
    ]) {
      const migration = readExpectedMigrations().find(entry => entry.tag === tag);
      expect(migration).toBeDefined();
      const pinned = sqlite
        .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
        .get(migration!.when);
      expect(pinned).toBeDefined();
    }
    sqlite.close();
  });

  it('keeps the exact-lot migration pending when its transfer rebuild target exists', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE transfer_order_items (id TEXT PRIMARY KEY)');

    ensureMigrationBaseline(sqlite, MIGRATIONS_FOLDER);

    const exactLotMigration = readExpectedMigrations().find(
      migration => migration.tag === '0056_mean_pandemic'
    );
    expect(exactLotMigration).toBeDefined();
    const pinned = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(exactLotMigration!.when);
    expect(pinned).toBeUndefined();

    sqlite.close();
  });

  it('keeps the pharmacy migration pending when an inventory-lot target exists', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec('CREATE TABLE inventory_lots (id TEXT PRIMARY KEY)');

    ensureMigrationBaseline(sqlite, MIGRATIONS_FOLDER);

    const pharmacyMigration = readExpectedMigrations().find(
      migration => migration.tag === '0057_pharmacy_policy_lot_recall'
    );
    expect(pharmacyMigration).toBeDefined();
    const pinned = sqlite
      .prepare('SELECT id FROM __drizzle_migrations WHERE created_at = ?')
      .get(pharmacyMigration!.when);
    expect(pinned).toBeUndefined();

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

  it('adopts legacy null base-unit rows and preserves one deterministic base through 0045', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-price-tier-grid-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'price-tier-grid.db');
    const historicalMigrations = join(dir, 'migrations-through-0044');
    copyMigrationPrefix(historicalMigrations, 45);

    await initDatabase({ dbPath, seedData: false, migrationsFolder: historicalMigrations });
    closeDatabase();

    const legacy = new Database(dbPath);
    legacy.exec(`
      INSERT INTO tenants (id, name, slug) VALUES ('tier-tenant', 'Tier Tenant', 'tier-tenant');
      INSERT INTO units (id, tenant_id, name, abbreviation) VALUES
        ('a-unit', 'tier-tenant', 'First unit', 'FST'),
        ('b-unit', 'tier-tenant', 'Second unit', 'SND');
      INSERT INTO products (id, tenant_id, name, sku) VALUES
        ('tier-product', 'tier-tenant', 'Tier Product', 'TIER-1');
      INSERT INTO users (id, tenant_id, email, name, password_hash) VALUES
        ('tier-user', 'tier-tenant', 'tier-user@example.test', 'Tier User', 'test-hash');
      INSERT INTO sales (id, tenant_id, sale_number, created_by) VALUES
        ('tier-sale', 'tier-tenant', 'TIER-000001', 'tier-user');
      INSERT INTO unit_x_product
        (id, product_id, unit_id, equivalence, price, is_base, created_at, updated_at)
      VALUES
        ('a-assignment', 'tier-product', 'a-unit', 1, 100, NULL, '2026-01-01', '2026-01-01'),
        ('b-assignment', 'tier-product', 'b-unit', 2, 180.005, NULL, '2026-01-01', '2026-01-01');
      INSERT INTO sale_items
        (id, sale_id, product_id, quantity, unit_price, unit_id, unit_equivalence,
         discount, tax_rate, tax_kind, tax_amount, cost_at_sale, total)
      VALUES
        ('tier-sale-item', 'tier-sale', 'tier-product', 2, 100, 'a-unit', 1,
         0, 19, 'iva', 38, 60, 238);
    `);
    legacy.close();

    await initDatabase({ dbPath, seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as { $client: Database.Database };
    expect(
      liveDb.$client
        .prepare(
          'SELECT id, is_base AS isBase, price, price2, price3 FROM unit_x_product ' +
            'WHERE product_id = ? ORDER BY id'
        )
        .all('tier-product')
    ).toEqual([
      { id: 'a-assignment', isBase: 1, price: 100, price2: 0, price3: 0 },
      { id: 'b-assignment', isBase: 0, price: 180.01, price2: 0, price3: 0 },
    ]);
    expect(
      liveDb.$client
        .prepare(
          'SELECT id, quantity, unit_price AS unitPrice, ' +
            'catalog_unit_price1 AS catalogPrice1, catalog_unit_price2 AS catalogPrice2, ' +
            'catalog_unit_price3 AS catalogPrice3, total FROM sale_items WHERE id = ?'
        )
        .get('tier-sale-item')
    ).toEqual({
      id: 'tier-sale-item',
      quantity: 2,
      unitPrice: 100,
      catalogPrice1: null,
      catalogPrice2: null,
      catalogPrice3: null,
      total: 238,
    });
    expect(liveDb.$client.pragma('foreign_key_check')).toEqual([]);
  });

  it('backfills the attached customer tier only for open drafts through 0049', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-sale-price-tier-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'sale-price-tier.db');
    const historicalMigrations = join(dir, 'migrations-through-0048');
    copyMigrationPrefix(historicalMigrations, 49);

    await initDatabase({ dbPath, seedData: false, migrationsFolder: historicalMigrations });
    closeDatabase();

    const legacy = new Database(dbPath);
    legacy.exec(`
      INSERT INTO tenants (id, name, slug) VALUES
        ('sale-tier-tenant', 'Sale Tier Tenant', 'sale-tier-tenant');
      INSERT INTO users (id, tenant_id, email, name, password_hash) VALUES
        ('sale-tier-user', 'sale-tier-tenant', 'sale-tier@example.test', 'Tier User', 'test-hash');
      INSERT INTO customers (id, tenant_id, name, price_tier) VALUES
        ('sale-tier-customer', 'sale-tier-tenant', 'Wholesale Customer', 2);
      INSERT INTO sales (id, tenant_id, sale_number, customer_id, status, created_by) VALUES
        ('customer-draft', 'sale-tier-tenant', 'TIER-000001', 'sale-tier-customer', 'draft', 'sale-tier-user'),
        ('walk-in-draft', 'sale-tier-tenant', 'TIER-000002', NULL, 'draft', 'sale-tier-user');
    `);
    legacy.close();

    await initDatabase({ dbPath, seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as { $client: Database.Database };
    expect(
      liveDb.$client.prepare('SELECT id, price_tier AS priceTier FROM sales ORDER BY id').all()
    ).toEqual([
      { id: 'customer-draft', priceTier: 2 },
      { id: 'walk-in-draft', priceTier: 1 },
    ]);
    expect(liveDb.$client.pragma('foreign_key_check')).toEqual([]);
  });

  it('backfills movement sites only from authoritative aggregates through 0050', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-movement-sites-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'movement-sites.db');
    const historicalMigrations = join(dir, 'migrations-through-0049');
    copyMigrationPrefix(historicalMigrations, 50);

    await initDatabase({ dbPath, seedData: false, migrationsFolder: historicalMigrations });
    closeDatabase();

    const legacy = new Database(dbPath);
    legacy.exec(`
      INSERT INTO tenants (id, name, slug) VALUES
        ('movement-tenant', 'Movement Tenant', 'movement-tenant');
      INSERT INTO companies (id, tenant_id, name) VALUES
        ('movement-company', 'movement-tenant', 'Movement Company');
      INSERT INTO sites (id, tenant_id, company_id, name) VALUES
        ('movement-site-a', 'movement-tenant', 'movement-company', 'Site A'),
        ('movement-site-b', 'movement-tenant', 'movement-company', 'Site B');
      INSERT INTO users (id, tenant_id, email, name, password_hash) VALUES
        ('movement-user', 'movement-tenant', 'movement@example.test', 'Movement User', 'test-hash');
      INSERT INTO providers (id, tenant_id, name) VALUES
        ('movement-provider', 'movement-tenant', 'Movement Provider');
      INSERT INTO products (id, tenant_id, name, sku) VALUES
        ('movement-product', 'movement-tenant', 'Movement Product', 'MOVE-1');
      INSERT INTO units (id, tenant_id, name, abbreviation) VALUES
        ('movement-unit', 'movement-tenant', 'Unit', 'UND');
      INSERT INTO cash_sessions
        (id, tenant_id, site_id, cashier_id, register_name, opening_count_denominations)
      VALUES
        ('movement-session', 'movement-tenant', 'movement-site-a', 'movement-user', 'Register 1', '{}');
      INSERT INTO sales
        (id, tenant_id, sale_number, status, cash_session_id, created_by)
      VALUES
        ('movement-sale', 'movement-tenant', 'SALE-0001', 'completed', 'movement-session', 'movement-user');
      INSERT INTO purchases
        (id, tenant_id, purchase_number, provider_id, site_id, created_by)
      VALUES
        ('movement-purchase', 'movement-tenant', 'PUR-0001', 'movement-provider', 'movement-site-b', 'movement-user');
      INSERT INTO purchase_returns
        (id, tenant_id, purchase_id, created_by)
      VALUES
        ('movement-purchase-return', 'movement-tenant', 'movement-purchase', 'movement-user');
      INSERT INTO initial_inventory
        (id, tenant_id, product_id, unit_id, site_id, mode, quantity,
         normalized_quantity, previous_stock, new_stock, created_by)
      VALUES
        ('movement-entry', 'movement-tenant', 'movement-product', 'movement-unit',
         'movement-site-a', 'initial', 1, 1, 0, 1, 'movement-user');
      INSERT INTO inventory_movements
        (id, tenant_id, product_id, type, quantity, previous_stock, new_stock, reference, created_by)
      VALUES
        ('movement-from-sale-id', 'movement-tenant', 'movement-product', 'sale', 1, 5, 4, 'movement-sale', 'movement-user'),
        ('movement-from-sale-number', 'movement-tenant', 'movement-product', 'return', 1, 4, 5, 'SALE-0001', 'movement-user'),
        ('movement-from-purchase', 'movement-tenant', 'movement-product', 'purchase', 2, 5, 7, 'PUR-0001', 'movement-user'),
        ('movement-from-purchase-return', 'movement-tenant', 'movement-product', 'return', -1, 7, 6, 'movement-purchase-return', 'movement-user'),
        ('movement-from-entry', 'movement-tenant', 'movement-product', 'adjustment', 1, 0, 1, 'movement-entry', 'movement-user'),
        ('movement-ambiguous-manual', 'movement-tenant', 'movement-product', 'adjustment', 1, 1, 2, 'manual-adjustment', 'movement-user'),
        ('movement-ambiguous-transfer', 'movement-tenant', 'movement-product', 'transfer', 1, 2, 1, 'transfer-legacy', 'movement-user');
    `);
    legacy.close();

    await initDatabase({ dbPath, seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as { $client: Database.Database };
    expect(
      liveDb.$client
        .prepare('SELECT id, site_id AS siteId FROM inventory_movements ORDER BY id')
        .all()
    ).toEqual([
      { id: 'movement-ambiguous-manual', siteId: null },
      { id: 'movement-ambiguous-transfer', siteId: null },
      { id: 'movement-from-entry', siteId: 'movement-site-a' },
      { id: 'movement-from-purchase', siteId: 'movement-site-b' },
      { id: 'movement-from-purchase-return', siteId: 'movement-site-b' },
      { id: 'movement-from-sale-id', siteId: 'movement-site-a' },
      { id: 'movement-from-sale-number', siteId: 'movement-site-a' },
    ]);
    expect(
      liveDb.$client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = " +
            "'idx_inventory_movements_tenant_site_created'"
        )
        .get()
    ).toEqual({ name: 'idx_inventory_movements_tenant_site_created' });
    expect(liveDb.$client.pragma('foreign_key_check')).toEqual([]);
  });

  it('backfills quotation tax kind from its frozen product reference through 0046', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-quotation-tax-kind-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'quotation-tax-kind.db');
    const historicalMigrations = join(dir, 'migrations-through-0045');
    copyMigrationPrefix(historicalMigrations, 46);

    await initDatabase({ dbPath, seedData: false, migrationsFolder: historicalMigrations });
    closeDatabase();

    const legacy = new Database(dbPath);
    legacy.exec(`
      INSERT INTO tenants (id, name, slug) VALUES ('tax-tenant', 'Tax Tenant', 'tax-tenant');
      INSERT INTO companies (id, tenant_id, name) VALUES
        ('tax-company', 'tax-tenant', 'Tax Company');
      INSERT INTO sites (id, tenant_id, company_id, name) VALUES
        ('tax-site', 'tax-tenant', 'tax-company', 'Tax Site');
      INSERT INTO users (id, tenant_id, email, name, password_hash) VALUES
        ('tax-user', 'tax-tenant', 'tax-user@example.test', 'Tax User', 'test-hash');
      INSERT INTO products (id, tenant_id, name, sku, tax_rate, tax_kind) VALUES
        ('inc-product', 'tax-tenant', 'INC Product', 'INC-1', 8, 'inc');
      INSERT INTO quotations
        (id, tenant_id, site_id, quotation_number, created_by)
      VALUES
        ('tax-quote', 'tax-tenant', 'tax-site', 'TAX-000001', 'tax-user');
      INSERT INTO quotation_items
        (id, quotation_id, product_id, quantity, unit_price, tax_rate, tax_amount, total)
      VALUES
        ('tax-quote-item', 'tax-quote', 'inc-product', 1, 108, 8, 8, 108);
    `);
    legacy.close();

    await initDatabase({ dbPath, seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as { $client: Database.Database };
    expect(
      liveDb.$client
        .prepare('SELECT tax_kind AS taxKind FROM quotation_items WHERE id = ?')
        .get('tax-quote-item')
    ).toEqual({ taxKind: 'inc' });
    expect(
      liveDb.$client
        .prepare(
          'SELECT tenant_id AS tenantId, tax_kind AS taxKind, tax_rate AS taxRate, position ' +
            'FROM product_tax_components WHERE product_id = ?'
        )
        .all('inc-product')
    ).toEqual([{ tenantId: 'tax-tenant', taxKind: 'inc', taxRate: 8, position: 0 }]);
    expect(
      liveDb.$client
        .prepare(
          'SELECT tenant_id AS tenantId, tax_kind AS taxKind, taxable_amount AS taxableAmount, ' +
            'tax_amount AS taxAmount, position FROM quotation_item_tax_components ' +
            'WHERE quotation_item_id = ?'
        )
        .all('tax-quote-item')
    ).toEqual([
      { tenantId: 'tax-tenant', taxKind: 'inc', taxableAmount: 100, taxAmount: 8, position: 0 },
    ]);
    expect(liveDb.$client.pragma('foreign_key_check')).toEqual([]);
  });

  it('backfills quotation units only when one explicit base assignment is provable through 0051', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-quotation-unit-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'quotation-unit.db');
    const historicalMigrations = join(dir, 'migrations-through-0050');
    copyMigrationPrefix(historicalMigrations, 51);

    await initDatabase({ dbPath, seedData: false, migrationsFolder: historicalMigrations });
    closeDatabase();

    const legacy = new Database(dbPath);
    legacy.exec(`
      INSERT INTO tenants (id, name, slug) VALUES ('unit-tenant', 'Unit Tenant', 'unit-tenant');
      INSERT INTO companies (id, tenant_id, name) VALUES
        ('unit-company', 'unit-tenant', 'Unit Company');
      INSERT INTO sites (id, tenant_id, company_id, name) VALUES
        ('unit-site', 'unit-tenant', 'unit-company', 'Unit Site');
      INSERT INTO users (id, tenant_id, email, name, password_hash) VALUES
        ('unit-user', 'unit-tenant', 'unit-user@example.test', 'Unit User', 'test-hash');
      INSERT INTO units (id, tenant_id, name, abbreviation) VALUES
        ('unit-each', 'unit-tenant', 'Each', 'EA'),
        ('unit-box', 'unit-tenant', 'Box', 'BOX');
      INSERT INTO products (id, tenant_id, name, sku) VALUES
        ('unit-product-unique', 'unit-tenant', 'Unique Product', 'UNIT-1'),
        ('unit-product-ambiguous', 'unit-tenant', 'Ambiguous Product', 'UNIT-2'),
        ('unit-product-missing', 'unit-tenant', 'Missing Product', 'UNIT-3');
      INSERT INTO unit_x_product
        (id, product_id, unit_id, equivalence, price, is_base)
      VALUES
        ('uxp-unique', 'unit-product-unique', 'unit-each', 1, 10, 1),
        ('uxp-ambiguous-each', 'unit-product-ambiguous', 'unit-each', 1, 10, 1),
        ('uxp-ambiguous-box', 'unit-product-ambiguous', 'unit-box', 12, 100, 1);
      INSERT INTO quotations
        (id, tenant_id, site_id, quotation_number, created_by)
      VALUES
        ('unit-quote', 'unit-tenant', 'unit-site', 'UNIT-000001', 'unit-user');
      INSERT INTO quotation_items
        (id, quotation_id, product_id, quantity, unit_price, tax_rate, tax_amount, total)
      VALUES
        ('unit-item-unique', 'unit-quote', 'unit-product-unique', 1, 10, 0, 0, 10),
        ('unit-item-ambiguous', 'unit-quote', 'unit-product-ambiguous', 1, 10, 0, 0, 10),
        ('unit-item-missing', 'unit-quote', 'unit-product-missing', 1, 10, 0, 0, 10);
    `);
    legacy.close();

    await initDatabase({ dbPath, seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as { $client: Database.Database };
    expect(
      liveDb.$client
        .prepare(
          'SELECT id, unit_id AS unitId, unit_equivalence AS unitEquivalence ' +
            'FROM quotation_items WHERE quotation_id = ? ORDER BY id'
        )
        .all('unit-quote')
    ).toEqual([
      { id: 'unit-item-ambiguous', unitId: null, unitEquivalence: null },
      { id: 'unit-item-missing', unitId: null, unitEquivalence: null },
      { id: 'unit-item-unique', unitId: 'unit-each', unitEquivalence: 1 },
    ]);
    for (const table of [
      'provider_payable_invoices',
      'provider_payable_payments',
      'provider_payable_credits',
      'provider_payable_allocations',
      'quotation_sale_links',
    ]) {
      expect(
        liveDb.$client
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table)
      ).toEqual({ name: table });
    }
    expect(liveDb.$client.pragma('foreign_key_check')).toEqual([]);
  });

  it('upgrades a legacy full return through 0052 and 0053 without losing restaurant money', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-partial-returns-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'partial-returns.db');
    const historicalMigrations = join(dir, 'migrations-through-0051');
    copyMigrationPrefix(historicalMigrations, 52);

    await initDatabase({ dbPath, seedData: false, migrationsFolder: historicalMigrations });
    closeDatabase();

    const legacy = new Database(dbPath);
    legacy.exec(`
      INSERT INTO tenants (id, name, slug) VALUES
        ('return-tenant', 'Return Tenant', 'return-tenant'),
        ('foreign-return-tenant', 'Foreign Return Tenant', 'foreign-return-tenant');
      INSERT INTO companies (id, tenant_id, name) VALUES
        ('return-company', 'return-tenant', 'Return Company');
      INSERT INTO sites (id, tenant_id, company_id, name) VALUES
        ('return-site', 'return-tenant', 'return-company', 'Return Site');
      INSERT INTO users (id, tenant_id, email, name, password_hash) VALUES
        ('return-user', 'return-tenant', 'return-user@example.test', 'Return User', 'test-hash');
      INSERT INTO cash_sessions
        (id, tenant_id, site_id, cashier_id, register_name, opening_count_denominations)
      VALUES
        ('return-session', 'return-tenant', 'return-site', 'return-user', 'Return Register', '[]');
      INSERT INTO products (id, tenant_id, name, sku, cost, price) VALUES
        ('return-product', 'return-tenant', 'Frozen product', 'RET-PROD', 30, 80);
      INSERT INTO sales
        (id, tenant_id, sale_number, subtotal, tip_amount, service_charge_amount,
         discount_amount, tax_amount, total, currency_code, payment_status, status,
         cash_session_id, created_by)
      VALUES
        ('return-sale', 'return-tenant', 'RET-000001', 80, 10, 5, 3, 8, 100,
         'COP', 'refunded', 'completed', 'return-session', 'return-user');
      INSERT INTO sale_items
        (id, sale_id, product_id, product_name_snapshot, product_sku_snapshot,
         quantity, unit_price, unit_equivalence, discount, tax_kind, tax_rate,
         tax_amount, cost_at_sale, total, currency_code)
      VALUES
        ('return-line', 'return-sale', 'return-product', 'Frozen product', 'RET-PROD',
         1, 80, 1, 0, 'iva', 10, 8, 30, 88, 'COP');
      -- The historical child FKs are single-column, so a damaged database can
      -- point another tenant's tax row at this line. The 0052 backfill must
      -- ignore it rather than freeze foreign evidence under return-tenant.
      INSERT INTO sale_item_tax_components
        (id, tenant_id, sale_item_id, component_key, tax_kind, tax_rate,
         position, taxable_amount, tax_amount)
      VALUES
        ('foreign-return-tax', 'foreign-return-tenant', 'return-line',
         'foreign:iva', 'iva', 99, 0, 1, 1);
      INSERT INTO sale_payments (id, tenant_id, sale_id, method, amount) VALUES
        ('return-payment', 'return-tenant', 'return-sale', 'cash', 100);
      INSERT INTO sale_returns
        (id, tenant_id, sale_id, refund_amount, reason, created_by)
      VALUES
        ('legacy-return', 'return-tenant', 'return-sale', 100, 'Legacy full return', 'return-user');
    `);
    legacy.close();

    await initDatabase({ dbPath, seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as { $client: Database.Database };
    expect(
      liveDb.$client
        .prepare(
          'SELECT destination, subtotal, tip_amount AS tipAmount, ' +
            'service_charge_amount AS serviceChargeAmount, discount_amount AS discountAmount, ' +
            'tax_amount AS taxAmount, refund_amount AS refundAmount, currency_code AS currencyCode ' +
            'FROM sale_returns WHERE id = ?'
        )
        .get('legacy-return')
    ).toEqual({
      destination: 'original',
      subtotal: 80,
      tipAmount: 10,
      serviceChargeAmount: 5,
      discountAmount: 3,
      taxAmount: 8,
      refundAmount: 100,
      currencyCode: 'COP',
    });
    const { resolveFiscalDocumentSnapshot } =
      await import('../services/fiscal/orchestrator/snapshots.js');
    const fiscalSnapshot = await resolveFiscalDocumentSnapshot(getDatabase(), {
      tenantId: 'return-tenant',
      source: 'return',
      sourceId: 'legacy-return',
      saleId: 'return-sale',
      sale: { subtotal: 80, taxAmount: 8, discountAmount: 3, total: 100 },
    });
    expect(fiscalSnapshot.amounts).toEqual({
      subtotal: 95,
      taxAmount: 8,
      discountAmount: 3,
      total: 100,
    });
    expect(fiscalSnapshot.lines.map(line => line.lineTotal)).toEqual([88, 10, 5]);
    expect(
      liveDb.$client
        .prepare(
          'SELECT sale_item_id AS saleItemId, product_name_snapshot AS productName, ' +
            'quantity, base_quantity AS baseQuantity, subtotal, tax_amount AS taxAmount, total ' +
            'FROM sale_return_items WHERE sale_return_id = ?'
        )
        .all('legacy-return')
    ).toEqual([
      {
        saleItemId: 'return-line',
        productName: 'Frozen product',
        quantity: 1,
        baseQuantity: 1,
        subtotal: 80,
        taxAmount: 8,
        total: 88,
      },
    ]);
    expect(
      liveDb.$client
        .prepare(
          'SELECT tenant_id AS tenantId, component_key AS componentKey, ' +
            'tax_rate AS taxRate, taxable_amount AS taxableAmount, tax_amount AS taxAmount ' +
            'FROM sale_return_item_tax_components WHERE sale_return_item_id = ?'
        )
        .all('legacy-return-item:legacy-return:return-line')
    ).toEqual([
      {
        tenantId: 'return-tenant',
        componentKey: 'legacy:iva:10.000000',
        taxRate: 10,
        taxableAmount: 80,
        taxAmount: 8,
      },
    ]);
    expect(
      liveDb.$client
        .prepare(
          'SELECT original_method AS method, destination, amount ' +
            'FROM sale_return_payment_allocations WHERE sale_return_id = ?'
        )
        .all('legacy-return')
    ).toEqual([{ method: 'cash', destination: 'cash', amount: 100 }]);
    for (const table of [
      'sale_return_items',
      'sale_return_item_tax_components',
      'sale_return_item_lots',
      'sale_return_item_serials',
      'sale_return_payment_allocations',
      'sale_exchanges',
      'store_credit_accounts',
      'store_credit_movements',
    ]) {
      expect(
        liveDb.$client
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table)
      ).toEqual({ name: table });
    }
    expect(
      liveDb.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get('idx_sale_returns_sale_unique')
    ).toBeUndefined();
    liveDb.$client
      .prepare(
        'INSERT INTO sale_returns ' +
          '(id, tenant_id, sale_id, destination, subtotal, refund_amount, currency_code, created_by) ' +
          "VALUES ('second-return', 'return-tenant', 'return-sale', 'original', 0, 0, 'COP', 'return-user')"
      )
      .run();
    expect(liveDb.$client.pragma('foreign_key_check')).toEqual([]);
    expectMigrationsMatchJournal(listMigrationRows(liveDb.$client));

    closeDatabase();
    await initDatabase({ dbPath, seedData: false });
    const reopened = getDatabase() as unknown as { $client: Database.Database };
    expect(
      reopened.$client
        .prepare('SELECT COUNT(*) AS count FROM sale_returns WHERE sale_id = ?')
        .get('return-sale')
    ).toEqual({ count: 2 });
    expectMigrationsMatchJournal(listMigrationRows(reopened.$client));
  });

  it('repairs timestamp drift on Drizzle tracking rows whose SERIAL ids are null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-drift-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'drift.db');

    await initDatabase({ dbPath, seedData: false });
    closeDatabase();

    const drifted = new Database(dbPath);
    const expectedCount = readExpectedMigrations().length;
    expect(
      (
        drifted
          .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations WHERE id IS NULL')
          .get() as { count: number }
      ).count
    ).toBe(expectedCount);
    drifted.prepare('UPDATE __drizzle_migrations SET created_at = created_at - 1000000000').run();
    drifted.close();

    // A row-id-based repair must restore the current journal timestamps before
    // drizzleMigrate decides what is pending. Addressing these rows through the
    // null SERIAL id would update nothing and replay the baseline into an
    // already materialised schema.
    await initDatabase({ dbPath, seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as { $client: Database.Database };
    expectMigrationsMatchJournal(listMigrationRows(liveDb.$client));
  });

  it('adds balance revisions and blind counts to 0053 without inventing operational rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-retail-counts-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'retail-counts.db');
    const historicalMigrations = join(dir, 'migrations-through-0053');
    copyMigrationPrefix(historicalMigrations, 54);

    await initDatabase({ dbPath, seedData: false, migrationsFolder: historicalMigrations });
    closeDatabase();

    const legacy = new Database(dbPath);
    legacy.exec(`
      INSERT INTO tenants (id, name, slug) VALUES
        ('count-tenant', 'Count Tenant', 'count-tenant');
      INSERT INTO companies (id, tenant_id, name) VALUES
        ('count-company', 'count-tenant', 'Count Company');
      INSERT INTO sites (id, tenant_id, company_id, name) VALUES
        ('count-site', 'count-tenant', 'count-company', 'Count Site');
      INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES
        ('count-user', 'count-tenant', 'count@example.test', 'Count User', 'test-hash', 'manager');
      INSERT INTO units (id, tenant_id, name, abbreviation) VALUES
        ('count-unit', 'count-tenant', 'Each', 'EA');
      INSERT INTO products (id, tenant_id, name, sku, min_stock) VALUES
        ('count-product', 'count-tenant', 'Count Product', 'COUNT-1', 10);
      INSERT INTO inventory_balances
        (id, tenant_id, site_id, product_id, on_hand, reserved)
      VALUES
        ('count-balance', 'count-tenant', 'count-site', 'count-product', 7, 0);
    `);
    legacy.close();

    await initDatabase({ dbPath, seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as { $client: Database.Database };
    expect(
      liveDb.$client
        .prepare('SELECT on_hand AS onHand, version FROM inventory_balances WHERE id = ?')
        .get('count-balance')
    ).toEqual({ onHand: 7, version: 0 });
    expect(
      liveDb.$client.prepare('SELECT COUNT(*) AS count FROM inventory_count_sessions').get()
    ).toEqual({ count: 0 });
    expect(
      liveDb.$client.prepare('SELECT COUNT(*) AS count FROM inventory_count_lines').get()
    ).toEqual({ count: 0 });

    liveDb.$client.exec(`
      INSERT INTO inventory_count_sessions
        (id, tenant_id, site_id, status, created_by, version, sync_version)
      VALUES
        ('count-session', 'count-tenant', 'count-site', 'submitted', 'count-user', 2, 2);
      INSERT INTO inventory_count_lines
        (id, tenant_id, session_id, product_id, unit_id, expected_quantity,
         expected_balance_version, counted_quantity, discrepancy, counted_by, version, sync_version)
      VALUES
        ('count-line', 'count-tenant', 'count-session', 'count-product', 'count-unit',
         7, 4, 6, -1, 'count-user', 1, 1);
    `);
    expect(liveDb.$client.pragma('foreign_key_check')).toEqual([]);
    expectMigrationsMatchJournal(listMigrationRows(liveDb.$client));

    closeDatabase();
    await initDatabase({ dbPath, seedData: false });
    const reopened = getDatabase() as unknown as { $client: Database.Database };
    expect(
      reopened.$client
        .prepare(
          'SELECT expected_quantity AS expectedQuantity, counted_quantity AS countedQuantity, ' +
            'expected_balance_version AS expectedBalanceVersion, discrepancy ' +
            'FROM inventory_count_lines WHERE id = ?'
        )
        .get('count-line')
    ).toEqual({
      expectedQuantity: 7,
      countedQuantity: 6,
      expectedBalanceVersion: 4,
      discrepancy: -1,
    });
    expectMigrationsMatchJournal(listMigrationRows(reopened.$client));
  });

  it('upgrades 0054 customer-value ledgers and sale tenders without losing history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-promotions-loyalty-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'promotions-loyalty.db');
    const historicalMigrations = join(dir, 'migrations-through-0054');
    copyMigrationPrefix(historicalMigrations, 55);

    await initDatabase({ dbPath, seedData: false, migrationsFolder: historicalMigrations });
    closeDatabase();

    const legacy = new Database(dbPath);
    legacy.exec(`
      INSERT INTO tenants (id, name, slug) VALUES
        ('value-tenant', 'Value Tenant', 'value-tenant');
      INSERT INTO companies (id, tenant_id, name) VALUES
        ('value-company', 'value-tenant', 'Value Company');
      INSERT INTO sites (id, tenant_id, company_id, name) VALUES
        ('value-site', 'value-tenant', 'value-company', 'Value Site');
      INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES
        ('value-user', 'value-tenant', 'value@example.test', 'Value User', 'test-hash', 'manager');
      INSERT INTO customers (id, tenant_id, name) VALUES
        ('value-customer', 'value-tenant', 'Value Customer');
      INSERT INTO cash_sessions
        (id, tenant_id, site_id, cashier_id, register_name, opening_count_denominations)
      VALUES
        ('value-session', 'value-tenant', 'value-site', 'value-user', 'Register 1', '[]');
      INSERT INTO products (id, tenant_id, name, sku, price) VALUES
        ('value-product', 'value-tenant', 'Value Product', 'VALUE-1', 100);
      INSERT INTO sales
        (id, tenant_id, sale_number, customer_id, subtotal, total, payment_method,
         payment_status, status, cash_session_id, created_by)
      VALUES
        ('value-sale', 'value-tenant', 'VALUE-000001', 'value-customer', 100, 100,
         'cash', 'partially_refunded', 'completed', 'value-session', 'value-user');
      INSERT INTO sale_items
        (id, sale_id, product_id, product_name_snapshot, product_sku_snapshot,
         quantity, unit_price, discount, tax_kind, tax_rate, tax_amount, total)
      VALUES
        ('value-line', 'value-sale', 'value-product', 'Value Product', 'VALUE-1',
         1, 100, 0, 'iva', 0, 0, 100);
      INSERT INTO sale_payments (id, tenant_id, sale_id, method, amount) VALUES
        ('value-payment', 'value-tenant', 'value-sale', 'cash', 100);
      INSERT INTO sale_returns
        (id, tenant_id, sale_id, destination, subtotal, refund_amount, currency_code, created_by)
      VALUES
        ('value-return', 'value-tenant', 'value-sale', 'original', 20, 20, 'COP', 'value-user');
      INSERT INTO sale_return_payment_allocations
        (id, tenant_id, sale_return_id, sale_payment_id, original_method,
         destination, amount)
      VALUES
        ('value-allocation', 'value-tenant', 'value-return', 'value-payment',
         'cash', 'cash', 20);
      INSERT INTO loyalty_accounts (id, tenant_id, customer_id, points) VALUES
        ('value-loyalty-account', 'value-tenant', 'value-customer', 7);
      INSERT INTO loyalty_movements
        (id, tenant_id, account_id, sale_id, kind, points, rate_at_earn, created_by)
      VALUES
        ('value-loyalty-movement', 'value-tenant', 'value-loyalty-account',
         'value-sale', 'earn', 7, 0.001, 'value-user');
      INSERT INTO store_credit_accounts
        (id, tenant_id, customer_id, currency_code, balance)
      VALUES
        ('value-store-account', 'value-tenant', 'value-customer', 'COP', 25);
      INSERT INTO store_credit_movements
        (id, tenant_id, account_id, customer_id, sale_return_id, sale_id, kind,
         amount, balance_after, currency_code, created_by)
      VALUES
        ('value-store-movement', 'value-tenant', 'value-store-account',
         'value-customer', 'value-return', 'value-sale', 'issue', 25, 25, 'COP',
         'value-user');
    `);
    legacy.close();

    await initDatabase({ dbPath, seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as { $client: Database.Database };

    expect(
      liveDb.$client
        .prepare(
          'SELECT points, sale_payment_id AS salePaymentId, source_movement_id AS sourceMovementId, ' +
            'value_per_point AS valuePerPoint, money_amount AS moneyAmount, currency_code AS currencyCode ' +
            'FROM loyalty_movements WHERE id = ?'
        )
        .get('value-loyalty-movement')
    ).toEqual({
      points: 7,
      salePaymentId: null,
      sourceMovementId: null,
      valuePerPoint: null,
      moneyAmount: null,
      currencyCode: null,
    });
    expect(
      liveDb.$client
        .prepare(
          'SELECT amount, balance_after AS balanceAfter, sale_payment_id AS salePaymentId, ' +
            'source_movement_id AS sourceMovementId FROM store_credit_movements WHERE id = ?'
        )
        .get('value-store-movement')
    ).toEqual({ amount: 25, balanceAfter: 25, salePaymentId: null, sourceMovementId: null });
    expect(
      liveDb.$client
        .prepare('SELECT amount, loyalty_points AS loyaltyPoints FROM sale_payments WHERE id = ?')
        .get('value-payment')
    ).toEqual({ amount: 100, loyaltyPoints: null });
    expect(
      liveDb.$client
        .prepare(
          'SELECT amount, loyalty_points AS loyaltyPoints FROM sale_return_payment_allocations WHERE id = ?'
        )
        .get('value-allocation')
    ).toEqual({ amount: 20, loyaltyPoints: null });
    expect(
      liveDb.$client
        .prepare('SELECT manual_discount_rate AS manualDiscountRate FROM sale_items WHERE id = ?')
        .get('value-line')
    ).toEqual({ manualDiscountRate: null });
    expect(liveDb.$client.prepare('SELECT COUNT(*) AS count FROM promotions').get()).toEqual({
      count: 0,
    });
    expect(
      liveDb.$client.prepare('SELECT COUNT(*) AS count FROM sale_item_promotions').get()
    ).toEqual({ count: 0 });
    expect(liveDb.$client.pragma('foreign_key_check')).toEqual([]);
    expectMigrationsMatchJournal(listMigrationRows(liveDb.$client));

    closeDatabase();
    await initDatabase({ dbPath, seedData: false });
    const reopened = getDatabase() as unknown as { $client: Database.Database };
    expect(
      reopened.$client
        .prepare('SELECT points FROM loyalty_accounts WHERE id = ?')
        .get('value-loyalty-account')
    ).toEqual({ points: 7 });
    expect(
      reopened.$client
        .prepare('SELECT balance FROM store_credit_accounts WHERE id = ?')
        .get('value-store-account')
    ).toEqual({ balance: 25 });
    expectMigrationsMatchJournal(listMigrationRows(reopened.$client));
  });

  it('upgrades 0055 transfer history without inventing a resulting balance revision', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-migrations-exact-lots-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'exact-lots.db');
    const historicalMigrations = join(dir, 'migrations-through-0055');
    copyMigrationPrefix(historicalMigrations, 56);

    await initDatabase({ dbPath, seedData: false, migrationsFolder: historicalMigrations });
    closeDatabase();

    const legacy = new Database(dbPath);
    legacy.exec(`
      INSERT INTO tenants (id, name, slug) VALUES
        ('lot-tenant', 'Lot Tenant', 'lot-tenant');
      INSERT INTO companies (id, tenant_id, name) VALUES
        ('lot-company', 'lot-tenant', 'Lot Company');
      INSERT INTO sites (id, tenant_id, company_id, name) VALUES
        ('lot-from', 'lot-tenant', 'lot-company', 'Lot From'),
        ('lot-to', 'lot-tenant', 'lot-company', 'Lot To');
      INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES
        ('lot-user', 'lot-tenant', 'lot@example.test', 'Lot User', 'test-hash', 'manager');
      INSERT INTO products (id, tenant_id, name, sku, price) VALUES
        ('lot-product', 'lot-tenant', 'Lot Product', 'LOT-1', 100);
      INSERT INTO transfer_orders
        (id, tenant_id, from_site_id, to_site_id, status, created_by)
      VALUES
        ('lot-transfer', 'lot-tenant', 'lot-from', 'lot-to', 'completed', 'lot-user');
      INSERT INTO transfer_order_items
        (id, transfer_order_id, product_id, quantity, received_quantity)
      VALUES
        ('lot-transfer-item', 'lot-transfer', 'lot-product', 2, 2);
    `);
    legacy.close();

    await initDatabase({ dbPath, seedData: false });
    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as { $client: Database.Database };

    expect(
      liveDb.$client
        .prepare(
          'SELECT destination_resulting_balance_version AS destinationResultingBalanceVersion ' +
            'FROM transfer_order_items WHERE id = ?'
        )
        .get('lot-transfer-item')
    ).toEqual({ destinationResultingBalanceVersion: null });
    expect(
      liveDb.$client.prepare('SELECT COUNT(*) AS count FROM purchase_item_lots').get()
    ).toEqual({ count: 0 });
    expect(liveDb.$client.pragma('foreign_key_check')).toEqual([]);
    expectMigrationsMatchJournal(listMigrationRows(liveDb.$client));
  });

  it('hard-fails with an actionable error when the migrations folder is missing', async () => {
    // Step 3 — the legacy `runSchemaSync()` fallback used to
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
    // Step 3 regression pin: adopted DBs whose baseline is
    // pinned by ensureMigrationBaseline() still rely on seedCatalogs()
    // to write the catalog rows on every boot. This test materialises
    // the full baseline schema without Drizzle's tracking table and
    // asserts the post-migration hook refills the empty catalogs after
    // newer migrations run.
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-adopted-catalogs-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'adopted.db');

    const legacy = new Database(dbPath);
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
    // `dian_identification_types` renamed to
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
