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
 * scale automatically when new migrations are added (Iter 2 added
 * `0001_receipt_templates` on top of the original baseline). Each row in
 * the live `__drizzle_migrations` table must match one journal entry by
 * order, hash, and timestamp.
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
    // check keys off its existence; the rest of the schema is assumed to
    // have been materialised by a transitional release before the
    // upgrade (the seedCatalogs hook skips missing catalog tables with
    // an actionable warning).
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

  it('preserves bridge-build sync_queue rows before dropping the legacy table', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-sync-cutover-'));
    createdPaths.push(dir);
    const dbPath = join(dir, 'bridge.db');
    const bridgeSqlite = new Database(dbPath);
    const expected = readExpectedMigrations();
    const now = new Date().toISOString();

    bridgeSqlite.exec(`
      CREATE TABLE __drizzle_migrations (
        id INTEGER PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );

      -- ENG-176a — stub every FK target referenced by the
      -- __new_X recreation blocks in 0035. The SQLCipher fork
      -- validates that referenced tables exist at INSERT-from-SELECT
      -- parse time, even inside the foreign_keys=OFF window the
      -- migration opens.
      CREATE TABLE tenants (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        slug text NOT NULL,
        -- ENG-176b -- migration 0037 reads settings/is_active/created_at
        -- and updated_at from the legacy tenants shape during the
        -- recreation backfill. Stub them so the SELECT chain compiles.
        settings text,
        is_active integer DEFAULT 1,
        created_at text,
        updated_at text
      );
      CREATE TABLE users (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        email text NOT NULL,
        password_hash text NOT NULL,
        name text NOT NULL,
        role text NOT NULL
      );
      CREATE TABLE sites (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        company_id text,
        name text NOT NULL
      );
      CREATE TABLE categories (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        name text NOT NULL
      );
      CREATE TABLE providers (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        name text NOT NULL
      );
      CREATE TABLE vat_rates (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        name text NOT NULL,
        rate real DEFAULT 0 NOT NULL
      );
      CREATE TABLE units (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        name text NOT NULL
      );

      CREATE TABLE sync_queue (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        entity_type text NOT NULL,
        entity_id text NOT NULL,
        operation text NOT NULL,
        data text,
        local_version integer,
        attempts integer,
        last_error text,
        created_at text NOT NULL
      );

      CREATE TABLE sync_outbox (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        status text NOT NULL DEFAULT 'queued',
        entity_type text NOT NULL,
        entity_id text NOT NULL,
        operation text NOT NULL,
        conflict_policy text NOT NULL DEFAULT 'auto_lww',
        payload text NOT NULL,
        payload_version integer NOT NULL DEFAULT 1,
        attempts integer NOT NULL DEFAULT 0,
        last_error text,
        priority real NOT NULL DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      -- ENG-067b — stub the hardware_outbox shape so migrations that
      -- run AFTER 0017 (e.g. 0018's ALTER + partial unique idx) have
      -- a target. A real bridge-build DB would have this table from
      -- migration 0015; the in-test bridge has historically only
      -- needed sync_outbox + sync_queue, so we add a minimal mirror
      -- of the post-0015 schema to keep the cutover-only test
      -- forward-compatible with new migrations.
      CREATE TABLE hardware_outbox (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        status text NOT NULL DEFAULT 'queued',
        kind text NOT NULL,
        peripheral_id text,
        payload text NOT NULL,
        payload_version integer NOT NULL DEFAULT 1,
        attempts integer NOT NULL DEFAULT 0,
        next_retry_at text,
        last_error text,
        priority real NOT NULL DEFAULT 0,
        claim_token text,
        locked_at text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      -- ENG-075 — stub the devices table shape from migration 0010 so
      -- later topology metadata migrations have their real bridge-build
      -- target while this test stays focused on sync_queue preservation.
      CREATE TABLE devices (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        kind text NOT NULL,
        name text NOT NULL,
        registered_by_user_id text NOT NULL,
        last_seen_at text,
        is_active integer DEFAULT 1 NOT NULL,
        metadata text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      -- ENG-039c — stub the post-0002 sales table shape so the 0024
      -- ALTER TABLE sales ADD COLUMN table_id finds an existing
      -- target. A real bridge-build DB would have this table from
      -- migration 0000 + the 0002 suspend/reprint additions. The FK
      -- on created_by etc. is dropped here because the parent
      -- tables are not stubbed and SQLite default is foreign_keys=OFF.
      CREATE TABLE sales (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        sale_number text NOT NULL,
        customer_id text,
        subtotal real DEFAULT 0 NOT NULL,
        tax_amount real DEFAULT 0 NOT NULL,
        discount_amount real DEFAULT 0 NOT NULL,
        total real DEFAULT 0 NOT NULL,
        payment_method text DEFAULT 'cash' NOT NULL,
        payment_status text DEFAULT 'pending' NOT NULL,
        status text DEFAULT 'draft' NOT NULL,
        cash_session_id text,
        notes text,
        created_by text NOT NULL,
        suspended_at text,
        suspended_by text,
        suspended_label text,
        reprint_count integer DEFAULT 0 NOT NULL,
        last_reprinted_at text,
        last_reprinted_by text,
        sync_status text DEFAULT 'pending',
        sync_version integer DEFAULT 0,
        created_at text DEFAULT (datetime('now')) NOT NULL,
        updated_at text DEFAULT (datetime('now')) NOT NULL
      );

      -- ENG-039c — stub the post-0023 restaurant_tables shape so the
      -- 0024 ALTER TABLE sales ... REFERENCES restaurant_tables(id)
      -- parses against an existing target.
      CREATE TABLE restaurant_tables (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        site_id text NOT NULL,
        name text NOT NULL,
        seat_count integer,
        area text,
        notes text,
        is_active integer DEFAULT 1 NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      -- ENG-089 — stub the baseline customers shape so the
      -- 0031 ALTER TABLE customers ADD COLUMN credit_limit parses
      -- against an existing target. The real bridge-build DB would
      -- carry this table from migration 0000; the stub only needs
      -- the column shape the ALTER targets.
      CREATE TABLE customers (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        name text NOT NULL,
        email text,
        phone text,
        address text,
        city text,
        state text,
        postal_code text,
        country text,
        tax_id text,
        identification_type_id text,
        person_type_id text,
        regime_type_id text,
        client_type_id text,
        commercial_activity_id text,
        notes text,
        is_active integer DEFAULT 1,
        sync_status text DEFAULT 'pending',
        sync_version integer DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      -- ENG-039d2 — stub the baseline sale_items shape so the 0033
      -- ALTER TABLE sale_items ADD COLUMN notes parses against an
      -- existing target. The real bridge-build DB would carry this
      -- table from migration 0000; the stub only needs the columns
      -- already in place at the cutover so the later ALTER lands
      -- against a real table.
      CREATE TABLE sale_items (
        id text PRIMARY KEY NOT NULL,
        sale_id text NOT NULL,
        product_id text NOT NULL,
        quantity real DEFAULT 1 NOT NULL,
        unit_price real DEFAULT 0 NOT NULL,
        unit_id text,
        unit_equivalence real DEFAULT 1 NOT NULL,
        discount real DEFAULT 0 NOT NULL,
        tax_rate real DEFAULT 0 NOT NULL,
        tax_amount real DEFAULT 0 NOT NULL,
        cost_at_sale real DEFAULT 0 NOT NULL,
        total real DEFAULT 0 NOT NULL
      );

      -- ENG-175 — stub the four tables that 0034 creates composite
      -- indexes on. The real bridge-build DB carries these from
      -- migration 0000; the stubs only need the columns the indexes
      -- reference so CREATE INDEX parses against a real table.
      CREATE TABLE audit_logs (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        action text NOT NULL,
        created_at text NOT NULL
      );
      CREATE TABLE inventory_movements (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        created_at text NOT NULL
      );
      CREATE TABLE operation_events (
        id text PRIMARY KEY NOT NULL,
        status text NOT NULL,
        created_at text NOT NULL
      );
      CREATE TABLE quotations (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        site_id text NOT NULL,
        quotation_number text NOT NULL,
        customer_id text,
        status text NOT NULL,
        subtotal real DEFAULT 0 NOT NULL,
        tax_amount real DEFAULT 0 NOT NULL,
        discount_amount real DEFAULT 0 NOT NULL,
        total real DEFAULT 0 NOT NULL,
        valid_until text,
        notes text,
        created_by text NOT NULL,
        status_changed_at text,
        status_changed_by text,
        sync_status text DEFAULT 'pending',
        sync_version integer DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );

      -- ENG-176a — stub the 13 monetary tables that 0035 recreates
      -- via the __new_X table-recreation pattern. The bridge-build
      -- fixture needs each one in place before 0035 can ALTER +
      -- RENAME against an existing target. Columns mirror the
      -- post-baseline shape; only the columns the 0035 INSERT-from-
      -- SELECT touches need to be present, but we include the full
      -- known set for forward compatibility with future ENG-176b
      -- column additions.
      CREATE TABLE products (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        name text NOT NULL,
        sku text NOT NULL,
        description text,
        category_id text,
        price real DEFAULT 0 NOT NULL,
        price2 real DEFAULT 0 NOT NULL,
        price3 real DEFAULT 0 NOT NULL,
        cost real DEFAULT 0 NOT NULL,
        margin_percent1 real DEFAULT 0 NOT NULL,
        margin_percent2 real DEFAULT 0 NOT NULL,
        margin_percent3 real DEFAULT 0 NOT NULL,
        margin_amount1 real DEFAULT 0 NOT NULL,
        margin_amount2 real DEFAULT 0 NOT NULL,
        margin_amount3 real DEFAULT 0 NOT NULL,
        tax_rate real DEFAULT 0 NOT NULL,
        vat_rate_id text,
        provider_id text,
        location_id text,
        initial_cost real DEFAULT 0 NOT NULL,
        stock real DEFAULT 0 NOT NULL,
        min_stock real DEFAULT 0 NOT NULL,
        sell_by_fraction integer DEFAULT 0 NOT NULL,
        fraction_step real,
        fraction_minimum real,
        is_active integer DEFAULT 1,
        barcode text,
        image_url text,
        embedding text,
        embedding_model text,
        embedded_at text,
        sync_status text DEFAULT 'pending',
        sync_version integer DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE purchases (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        purchase_number text NOT NULL,
        provider_id text NOT NULL,
        site_id text NOT NULL,
        order_id text,
        status text NOT NULL,
        subtotal real DEFAULT 0 NOT NULL,
        total real DEFAULT 0 NOT NULL,
        notes text,
        received_at text,
        created_by text NOT NULL,
        sync_status text DEFAULT 'pending',
        sync_version integer DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE purchase_items (
        id text PRIMARY KEY NOT NULL,
        purchase_id text NOT NULL,
        product_id text NOT NULL,
        source_order_item_id text,
        quantity real DEFAULT 1 NOT NULL,
        unit_id text NOT NULL,
        unit_equivalence real DEFAULT 1 NOT NULL,
        cost_per_unit real DEFAULT 0 NOT NULL,
        base_unit_cost real DEFAULT 0 NOT NULL,
        total real DEFAULT 0 NOT NULL
      );
      CREATE TABLE purchase_returns (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        purchase_id text NOT NULL,
        return_amount real DEFAULT 0 NOT NULL,
        reason text,
        created_by text NOT NULL,
        sync_status text DEFAULT 'pending',
        sync_version integer DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE orders (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        order_number text NOT NULL,
        provider_id text NOT NULL,
        site_id text NOT NULL,
        status text NOT NULL,
        subtotal real DEFAULT 0 NOT NULL,
        total real DEFAULT 0 NOT NULL,
        notes text,
        created_by text NOT NULL,
        sync_status text DEFAULT 'pending',
        sync_version integer DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE order_items (
        id text PRIMARY KEY NOT NULL,
        order_id text NOT NULL,
        product_id text NOT NULL,
        quantity real DEFAULT 1 NOT NULL,
        unit_id text NOT NULL,
        unit_equivalence real DEFAULT 1 NOT NULL,
        cost_per_unit real DEFAULT 0 NOT NULL,
        base_unit_cost real DEFAULT 0 NOT NULL,
        total real DEFAULT 0 NOT NULL
      );
      CREATE TABLE cash_sessions (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        site_id text NOT NULL,
        cashier_id text NOT NULL,
        register_name text NOT NULL,
        opening_float real DEFAULT 0 NOT NULL,
        opening_count_denominations text NOT NULL,
        expected_balance real DEFAULT 0 NOT NULL,
        actual_count real,
        actual_count_denominations text,
        over_short real,
        status text NOT NULL,
        opened_at text NOT NULL,
        closed_at text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE denomination_templates (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        site_id text NOT NULL,
        register_name text NOT NULL,
        label text NOT NULL,
        opening_float real DEFAULT 0 NOT NULL,
        denominations text NOT NULL,
        sort_order integer DEFAULT 0 NOT NULL,
        is_active integer DEFAULT 1 NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE cash_movements (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        session_id text NOT NULL,
        type text NOT NULL,
        amount real DEFAULT 0 NOT NULL,
        reference_id text,
        note text,
        created_by text NOT NULL,
        created_at text NOT NULL
      );
      CREATE TABLE sale_payments (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        sale_id text NOT NULL,
        method text NOT NULL,
        amount real NOT NULL,
        reference text,
        sync_status text DEFAULT 'pending',
        sync_version integer DEFAULT 0,
        created_at text NOT NULL
      );
      CREATE TABLE sale_returns (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        sale_id text NOT NULL,
        refund_amount real DEFAULT 0 NOT NULL,
        reason text,
        created_by text NOT NULL,
        sync_status text DEFAULT 'pending',
        sync_version integer DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE initial_inventory (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        product_id text NOT NULL,
        unit_id text NOT NULL,
        site_id text,
        mode text NOT NULL,
        quantity real NOT NULL,
        unit_equivalence real DEFAULT 1 NOT NULL,
        normalized_quantity real NOT NULL,
        cost real DEFAULT 0 NOT NULL,
        previous_stock real NOT NULL,
        new_stock real NOT NULL,
        notes text,
        created_by text NOT NULL,
        sync_status text DEFAULT 'pending',
        sync_version integer DEFAULT 0,
        created_at text NOT NULL
      );
      CREATE TABLE quotation_items (
        id text PRIMARY KEY NOT NULL,
        quotation_id text NOT NULL,
        product_id text NOT NULL,
        quantity real DEFAULT 1 NOT NULL,
        unit_price real DEFAULT 0 NOT NULL,
        discount real DEFAULT 0 NOT NULL,
        tax_rate real DEFAULT 0 NOT NULL,
        tax_amount real DEFAULT 0 NOT NULL,
        total real DEFAULT 0 NOT NULL,
        created_at text NOT NULL
      );
      -- ENG-176b -- migration 0037 recreates tenants, three fiscal
      -- tables, and payment_outbox while back-filling currency_code
      -- from the locale catalogs (added by migration 0003, also
      -- skipped on the bridge). Stub the minimum set of tables the
      -- migration touches so the recreation runs against this
      -- fixture cleanly.
      CREATE TABLE currency_catalog (
        code text PRIMARY KEY NOT NULL,
        name_en text NOT NULL,
        name_es text NOT NULL,
        symbol text NOT NULL,
        decimals integer NOT NULL,
        display_decimals integer NOT NULL
      );
      CREATE TABLE country_catalog (
        code text PRIMARY KEY NOT NULL,
        name_en text NOT NULL,
        name_es text NOT NULL,
        default_locale text NOT NULL,
        general_locale text NOT NULL,
        default_currency_code text NOT NULL,
        additional_currency_codes text,
        default_timezone text NOT NULL,
        first_day_of_week integer NOT NULL,
        date_format_short text NOT NULL,
        date_format_long text NOT NULL,
        tax_id_types_hint text,
        ui_locale_ready integer DEFAULT 1 NOT NULL
      );
      CREATE TABLE tenant_locale_settings (
        tenant_id text PRIMARY KEY NOT NULL,
        country_code text NOT NULL,
        locale_override text,
        currency_override text,
        timezone_override text,
        first_day_of_week_override integer,
        updated_at text NOT NULL
      );
      CREATE TABLE dian_identification_types (
        code text PRIMARY KEY NOT NULL,
        abbr text NOT NULL,
        name_es text NOT NULL,
        name_en text NOT NULL,
        natural_person integer NOT NULL
      );
      CREATE TABLE fiscal_numbering_resolutions (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        site_id text NOT NULL,
        kind text NOT NULL,
        resolution_number text NOT NULL,
        prefix text NOT NULL,
        from_number integer NOT NULL,
        to_number integer NOT NULL,
        current_number integer NOT NULL,
        technical_key text NOT NULL,
        valid_from text NOT NULL,
        valid_until text NOT NULL,
        is_active integer DEFAULT 1 NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE fiscal_documents (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        source text NOT NULL,
        source_id text NOT NULL,
        kind text NOT NULL,
        resolution_id text NOT NULL,
        consecutive integer NOT NULL,
        document_number text NOT NULL,
        cufe text NOT NULL,
        status text DEFAULT 'pending' NOT NULL,
        customer_id text,
        buyer_tax_id text NOT NULL,
        buyer_tax_id_type_code text NOT NULL,
        buyer_name text NOT NULL,
        buyer_email text,
        buyer_address text,
        buyer_city text,
        buyer_department text,
        buyer_country text,
        subtotal real DEFAULT 0 NOT NULL,
        tax_amount real DEFAULT 0 NOT NULL,
        discount_amount real DEFAULT 0 NOT NULL,
        total_amount real DEFAULT 0 NOT NULL,
        currency_code text NOT NULL,
        locale_code text NOT NULL,
        original_cufe text,
        reason_code text,
        provider_id text NOT NULL,
        provider_response text,
        xml_ref text,
        retries integer DEFAULT 0 NOT NULL,
        emitted_by_user_id text NOT NULL,
        emitted_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE fiscal_document_items (
        id text PRIMARY KEY NOT NULL,
        fiscal_document_id text NOT NULL,
        line_number integer NOT NULL,
        product_id text,
        product_name text NOT NULL,
        product_sku text,
        unit_measure_code text DEFAULT 'EA' NOT NULL,
        quantity real NOT NULL,
        unit_price real NOT NULL,
        discount_amount real DEFAULT 0 NOT NULL,
        tax_rate real DEFAULT 0 NOT NULL,
        tax_amount real DEFAULT 0 NOT NULL,
        tax_category_code text DEFAULT '01' NOT NULL,
        line_total real NOT NULL
      );
      CREATE TABLE payment_outbox (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL,
        sale_payment_id text,
        rail_id text NOT NULL,
        kind text DEFAULT 'charge' NOT NULL,
        status text DEFAULT 'queued' NOT NULL,
        amount real NOT NULL,
        currency_code text DEFAULT 'COP' NOT NULL,
        reference text NOT NULL,
        provider_transaction_id text,
        payload text DEFAULT '{}' NOT NULL,
        payload_version integer DEFAULT 1 NOT NULL,
        attempts integer DEFAULT 0 NOT NULL,
        next_retry_at text,
        last_error text,
        priority real DEFAULT 0 NOT NULL,
        claim_token text,
        locked_at text,
        idempotency_key text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
    `);

    // ENG-067b — drizzle-kit's better-sqlite3 migrator decides which
    // migrations to run by counting rows in `__drizzle_migrations`,
    // not by hash-matching individual entries. The legacy filter
    // `entry.tag !== '0017_drop_sync_queue'` happened to work when
    // 0017 was the last migration, but as soon as any migration
    // landed after 0017 (e.g. 0018), the row count would still match
    // the journal length and the migrator would skip 0017 entirely.
    // The slice-by-position approach pins "everything before 0017
    // applied" so the cutover migration AND every later migration
    // (0018+) run against the bridge DB the test simulates.
    const insertMigration = bridgeSqlite.prepare(
      'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)'
    );
    const cutoverIdx = expected.findIndex(
      entry => entry.tag === '0017_drop_sync_queue'
    );
    if (cutoverIdx === -1) {
      throw new Error('0017_drop_sync_queue must exist in the journal');
    }
    for (const migration of expected.slice(0, cutoverIdx)) {
      insertMigration.run(migration.hash, migration.when);
    }

    bridgeSqlite
      .prepare(
        `INSERT INTO sync_outbox (
          id, tenant_id, status, entity_type, entity_id, operation,
          conflict_policy, payload, payload_version, attempts,
          last_error, priority, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'already-backfilled',
        'tenant-bridge',
        'queued',
        'products',
        'product-1',
        'update',
        'auto_lww',
        '{"name":"already copied"}',
        1,
        0,
        null,
        0,
        now,
        now
      );
    bridgeSqlite
      .prepare(
        `INSERT INTO sync_outbox (
          id, tenant_id, status, entity_type, entity_id, operation,
          conflict_policy, payload, payload_version, attempts,
          last_error, priority, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'already-backfilled-purchase',
        'tenant-bridge',
        'queued',
        'purchases',
        'purchase-1',
        'create',
        'auto_lww',
        '{"total":200}',
        1,
        0,
        null,
        0,
        now,
        now
      );

    const insertLegacyQueue = bridgeSqlite.prepare(
      `INSERT INTO sync_queue (
        id, tenant_id, entity_type, entity_id, operation,
        data, local_version, attempts, last_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertLegacyQueue.run(
      'already-backfilled',
      'tenant-bridge',
      'products',
      'product-1',
      'update',
      '{"name":"should not overwrite"}',
      2,
      4,
      'stale duplicate',
      now
    );
    insertLegacyQueue.run(
      'late-sale',
      'tenant-bridge',
      'sales',
      'sale-1',
      'create',
      '{"total":100}',
      7,
      2,
      'network unavailable',
      now
    );
    bridgeSqlite.close();

    await initDatabase({ dbPath, seedData: false });

    const { getDatabase } = await import('../db/index.js');
    const liveDb = getDatabase() as unknown as {
      $client: Database.Database;
    };

    const preservedLateRow = liveDb.$client
      .prepare(
        `SELECT entity_type, operation, conflict_policy, payload,
          payload_version, attempts, last_error
         FROM sync_outbox
         WHERE id = ?`
      )
      .get('late-sale') as
      | {
          entity_type: string;
          operation: string;
          conflict_policy: string;
          payload: string;
          payload_version: number;
          attempts: number;
          last_error: string | null;
        }
      | undefined;
    expect(preservedLateRow).toEqual({
      entity_type: 'sales',
      operation: 'create',
      conflict_policy: 'manual',
      payload: '{"total":100}',
      payload_version: 7,
      attempts: 2,
      last_error: 'network unavailable',
    });

    const preexistingRows = liveDb.$client
      .prepare('SELECT payload FROM sync_outbox WHERE id = ?')
      .all('already-backfilled') as Array<{ payload: string }>;
    expect(preexistingRows).toEqual([{ payload: '{"name":"already copied"}' }]);

    const correctedPolicy = liveDb.$client
      .prepare('SELECT conflict_policy FROM sync_outbox WHERE id = ?')
      .get('already-backfilled-purchase') as
      | { conflict_policy: string }
      | undefined;
    expect(correctedPolicy?.conflict_policy).toBe('manual');

    const legacyTable = liveDb.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_queue'")
      .get() as { name: string } | undefined;
    expect(legacyTable).toBeUndefined();
    expectMigrationsMatchJournal(listMigrationRows(liveDb.$client));
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

    const legacy = new Database(dbPath);
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
