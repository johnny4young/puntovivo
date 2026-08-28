/**
 * versioned-migration adoption shim.
 *
 * Seeds the squashed-baseline `__drizzle_migrations` marker for DBs that
 * predate versioned migrations so the first real `drizzleMigrate()` call
 * skips baseline DDL that would collide with pre-existing objects. Owns
 * the `_journal.json` shape (`DrizzleJournal*`) shared with `connection.ts`.
 *
 * @module db/migration-baseline
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

export interface DrizzleJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface DrizzleJournal {
  version: string;
  dialect: string;
  entries: DrizzleJournalEntry[];
}

/**
 * adoption shim for DBs that predate versioned migrations.
 *
 * If the DB already carries application data (probed via any user
 * table) but has no `__drizzle_migrations` row, this function seeds the
 * squashed baseline entry with the exact (hash, created_at) tuple that
 * drizzle-orm's migrator would have written itself. That way the first
 * real `drizzleMigrate()` call skips the baseline DDL that would collide
 * with the existing objects, then applies every newer migration that is
 * relevant to the adopted schema.
 *
 * No-op on fresh DBs (let migrate() run everything from scratch) and
 * on already-adopted DBs (tracking row exists).
 *
 * Rationale for seeding the baseline: legacy installs reached the
 * baseline schema shape via a now-retired raw-DDL bootstrap. Replaying
 * that baseline would collide with the existing tables, but pinning the
 * whole journal would also skip newer constraints/data fixes (for
 * example 's sales CHECK). Operators who skipped the
 * transitional release that ran the raw-DDL path must adopt a bridge
 * build once before upgrading — the post-migration `seedCatalogs()`
 * hook logs an actionable warning when the expected tables are absent.
 * Partial test/legacy DBs may omit a post-baseline target table entirely;
 * those specific migrations can be marked applied because there is
 * nothing for them to rewrite.
 */
export function ensureMigrationBaseline(sqlite: Database.Database, migrationsFolder: string): void {
  const journalPath = resolve(migrationsFolder, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    // No migrations folder yet. Defer to drizzleMigrate which will throw
    // a loud, actionable error pointing at the missing metadata.
    return;
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as DrizzleJournal;
  if (journal.entries.length === 0) {
    return;
  }

  // Probe: this DB has pre-existing application tables iff sqlite_master
  // lists anything beyond internals (`sqlite_*`) and drizzle's own tracking
  // table. A fresh sqlite file returns no rows at all; a legacy install
  // may have any subset of the schema (some tests seed only a couple of
  // tables to exercise migration fast-paths — `tenants` is not guaranteed).
  const preExistingUserTable = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' " +
        "AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' LIMIT 1"
    )
    .get();
  if (!preExistingUserTable) {
    return;
  }

  // Pre-create the tracking table so we can seed rows. The drizzle-orm
  // migrator CREATE IF NOT EXISTS below will find it and reuse it.
  sqlite
    .prepare(
      'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)'
    )
    .run();

  const existingRow = sqlite.prepare('SELECT id FROM __drizzle_migrations LIMIT 1').get();
  if (existingRow) {
    // Either this DB already adopted the shim, or drizzleMigrate already
    // ran on a fresh boot. Either way, hands off.
    return;
  }

  // Adoption guard — pinning the baseline marks the whole squashed
  // pre-production history as applied, so an install whose tables predate
  // that history (the operator skipped the transitional release) would
  // silently adopt and then break on the first write that touches a column
  // it never received. Probe a small set of sentinel columns from the
  // structural money / catalog migrations: when the table exists but the
  // column is missing, refuse the adoption with an actionable upgrade path
  // instead. Absent sentinel tables stay out of this guard so bootstrap
  // tests can still exercise minimal DB shapes, but real legacy upgrades
  // are expected to carry the full baseline schema before post-baseline
  // migrations run.
  const ADOPTION_SENTINELS: ReadonlyArray<{
    table: string;
    column: string;
    migration: string;
  }> = [
    { table: 'cash_sessions', column: 'expected_balance', migration: '0000_baseline' },
    { table: 'sales', column: 'currency_code', migration: '0000_baseline' },
    { table: 'products', column: 'version', migration: '0000_baseline' },
  ];
  for (const sentinel of ADOPTION_SENTINELS) {
    const tableRow = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
      .get(sentinel.table);
    if (!tableRow) {
      continue;
    }
    const columns = sqlite.prepare(`PRAGMA table_info(${sentinel.table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some(column => column.name === sentinel.column)) {
      throw new Error(
        `Cannot adopt this database: table '${sentinel.table}' is missing column '${sentinel.column}' (added by migration ${sentinel.migration}). ` +
          'This install predates the versioned-migration baseline, so adopting it would silently skip schema changes it never received. ' +
          'Upgrade through a transitional release that still runs the legacy bootstrap, or start from a fresh database and restore your data.'
      );
    }
  }

  const orderedEntries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const tableExists = (name: string): boolean =>
    Boolean(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
        .get(name)
    );

  const baselineEntries = orderedEntries.filter(entry => entry.tag.endsWith('_baseline'));
  if (baselineEntries.length === 0) {
    throw new Error(
      'Cannot adopt this database: the migrations journal does not include a baseline entry. ' +
        'Fresh databases can run the full journal, but existing pre-migration databases need a squashed baseline marker to avoid replaying CREATE TABLE statements.'
    );
  }
  const shouldSeedPostBaselineMigration = (entry: DrizzleJournalEntry): boolean => {
    // if a partial adopted DB does not even have `sales`,
    // the table-rebuild CHECK migration has no target. Mark it applied
    // so minimal legacy/test DBs keep booting; when `sales` exists, the
    // migration remains pending and applies the DB-level invariant.
    if (entry.tag === '0001_eng177c_sales_cash_session_check') {
      return !tableExists('sales');
    }
    // Auditoría 2026-07 — the units-foundation migration ALTERs `units`.
    // A partial legacy/test DB without a `units` table has no target, so
    // mark it applied to keep minimal shapes booting; a real adopted DB
    // carries `units` (baseline) and the ALTER runs normally.
    if (entry.tag === '0003_unit_dimension_standard_code') {
      return !tableExists('units');
    }
    // Auditoría 2026-07 — packaging-barcode migration ALTERs
    // `unit_x_product`; same partial-legacy guard.
    if (entry.tag === '0004_unit_x_product_barcode') {
      return !tableExists('unit_x_product');
    }
    // Auditoría 2026-07 — lots migration ALTERs `products` (tracks_lots) and
    // creates `inventory_lots`. A partial legacy DB without `products` has no
    // ALTER target; mark applied so minimal shapes keep booting.
    if (entry.tag === '0005_inventory_lots') {
      return !tableExists('products');
    }
    // Auditoría 2026-07 — the stock-unification migration backfills
    // `inventory_balances` and DROPs `products.stock`. A partial legacy DB
    // without `products` has no target; mark applied so minimal shapes keep
    // booting; a real adopted DB carries `products` and the drop runs.
    if (entry.tag === '0007_drop_products_stock') {
      return !tableExists('products');
    }
    // the stock-rollup migration backfills from and attaches
    // triggers to `inventory_balances`. A partial legacy DB without that
    // table has no target; mark applied so minimal shapes keep booting; a
    // real adopted DB carries `inventory_balances` and the rollup lands.
    if (entry.tag === '0008_product_stock_totals') {
      return !tableExists('inventory_balances');
    }
    // price_suggestions carries an FK to `inventory_lots`, which
    // migration 0005 creates. Guard on `products` (the SAME condition 0005
    // guards on): if products is missing, 0005 was marked applied and lots
    // will never exist, so 0009 has no FK target either. Do NOT guard on
    // `inventory_lots` itself — a full-baseline adoption legitimately lacks
    // it until 0005 runs, and seeding 0009 there would make drizzle treat
    // every older migration as already applied (the migrator only runs
    // entries newer than the last recorded row).
    if (entry.tag === '0009_price_suggestions') {
      return !tableExists('products');
    }
    // loyalty tables carry FKs to `customers` (baseline) and
    // `sales`. A partial legacy DB without customers cannot host them; mark
    // applied so minimal shapes keep booting. Guard on the BASELINE table,
    // never on a table a post-baseline migration creates ( lesson:
    // seeding a newer entry makes the migrator skip every older one).
    if (entry.tag === '0010_loyalty') {
      return !tableExists('customers');
    }
    // checkout timing ALTERs `sales` and materializes pace on
    // `cash_sessions`. Seed this latest marker only for truly minimal
    // partial DBs that have neither the sales target nor the products
    // sentinel used by 0009. A mixed DB with products but no sales must
    // not advance Drizzle past older applicable migrations.
    if (entry.tag === '0011_eng209_checkout_timing') {
      return !tableExists('sales') && !tableExists('products');
    }
    // customer privacy disposition ALTERs `customers`. The
    // purchase-only adoption fixture has none of the post-baseline targets,
    // so 0011 is already safe to pin and this latest migration is a no-op as
    // well. Keep the sales/products guard: a mixed partial DB must not advance
    // Drizzle past older applicable migrations merely because customers is
    // absent.
    if (entry.tag === '0012_eng129c_customer_privacy_disposition') {
      return !tableExists('customers') && !tableExists('sales') && !tableExists('products');
    }
    // staff PIN enrollment ALTERs `users`. Pin it only for a
    // truly minimal partial DB with none of the preceding late-migration
    // targets; otherwise advancing to this latest marker could skip an
    // applicable customer, checkout-timing, or product migration.
    if (entry.tag === '0013_eng106a_staff_pin') {
      return (
        !tableExists('users') &&
        !tableExists('customers') &&
        !tableExists('sales') &&
        !tableExists('products')
      );
    }
    // cash/attendance linkage ALTERs `cash_sessions` after the
    // staff-foundation migrations. A purchase-only adoption fixture has none
    // of those targets, so pin the latest marker as another absent-target
    // no-op. Keep every earlier sentinel in the guard: a mixed partial DB with
    // any applicable staff, cash, sales, customer, or catalog surface must let
    // Drizzle run the pending chain instead of advancing past it.
    if (entry.tag === '0020_eng140d_cash_session_attendance') {
      return (
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers') &&
        !tableExists('sales') &&
        !tableExists('products')
      );
    }
    // dual approvals ALTERs `manager_approval_requests`. A
    // purchase-only partial DB has neither that target nor `tenants`, so the
    // intervening attendance-correction and loss-prevention tables cannot be
    // used by that fixture either. Pin the latest marker only for that truly
    // isolated shape. Requiring every earlier late-migration target to be
    // absent prevents Drizzle's newest-created_at semantics from skipping an
    // applicable migration on a mixed partial DB.
    if (entry.tag === '0023_eng142c_dual_approvals') {
      return (
        !tableExists('manager_approval_requests') &&
        !tableExists('tenants') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers') &&
        !tableExists('sales') &&
        !tableExists('products')
      );
    }
    // variant metadata ALTERs `products`. Preserve the same
    // narrow purchase-only fixture guard as 0023 before advancing the newest
    // marker: a mixed partial DB with any intervening target must still run
    // its applicable migrations rather than skipping ahead.
    if (entry.tag === '0024_eng110b_product_variants') {
      return (
        !tableExists('products') &&
        !tableExists('manager_approval_requests') &&
        !tableExists('tenants') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers') &&
        !tableExists('sales')
      );
    }
    // serialized inventory creates tenant/product/sale child
    // tables and ALTERs products. The purchase-only adoption fixture has
    // none of those targets, so advance the marker only for that same narrow
    // shape; mixed partial databases must still run the migration.
    if (entry.tag === '0025_eng110c_product_serials') {
      return (
        !tableExists('products') &&
        !tableExists('sales') &&
        !tableExists('tenants') &&
        !tableExists('manager_approval_requests') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers')
      );
    }
    // serial logistics ALTERs `product_serials` and creates a
    // transfer bridge that references the  tables. A purchase-only
    // adoption fixture that legitimately skipped 0025 has no ALTER target,
    // so pin this migration under the exact same narrow partial-DB guard.
    if (entry.tag === '0026_eng110d_serial_logistics') {
      return (
        !tableExists('product_serials') &&
        !tableExists('products') &&
        !tableExists('sales') &&
        !tableExists('tenants') &&
        !tableExists('manager_approval_requests') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers')
      );
    }
    // Task-measurement evidence creates a tenant/user-owned table. A
    // purchase-only partial DB has neither parent nor any preceding
    // operational target, so advancing this marker is safe only under the
    // same narrow guard as the serialized-inventory migrations.
    if (entry.tag === '0027_ux6a_task_measurement') {
      return (
        !tableExists('product_serials') &&
        !tableExists('products') &&
        !tableExists('sales') &&
        !tableExists('tenants') &&
        !tableExists('manager_approval_requests') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers')
      );
    }
    // Receipt display snapshots ALTER both sales tables. They have no target
    // in the purchase-only adoption fixture; pinning them under the complete
    // late-target guard keeps that fixture bootable without allowing a mixed
    // partial DB to skip an applicable migration.
    if (entry.tag === '0028_sale_display_snapshots') {
      return (
        !tableExists('sale_items') &&
        !tableExists('product_serials') &&
        !tableExists('products') &&
        !tableExists('sales') &&
        !tableExists('tenants') &&
        !tableExists('manager_approval_requests') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers')
      );
    }
    // Receipt identity snapshots ALTER sales only. Use the same complete
    // late-target guard as the preceding receipt migration so a purchase-only
    // fixture can boot while any partial database that owns sales must apply
    // the new columns.
    if (entry.tag === '0029_receipt_identity_snapshots') {
      return (
        !tableExists('sale_items') &&
        !tableExists('product_serials') &&
        !tableExists('products') &&
        !tableExists('sales') &&
        !tableExists('tenants') &&
        !tableExists('manager_approval_requests') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers')
      );
    }
    // Ordinary receipt presentation snapshots ALTER sales only. Keep the
    // narrow purchase-only adoption behavior of the preceding receipt
    // migrations; any database that owns sales must apply the new columns.
    if (entry.tag === '0030_receipt_presentation_snapshots') {
      return (
        !tableExists('sale_items') &&
        !tableExists('product_serials') &&
        !tableExists('products') &&
        !tableExists('sales') &&
        !tableExists('tenants') &&
        !tableExists('manager_approval_requests') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers')
      );
    }
    // Co-pilot response-mode evidence ALTERs ai_audit_log. The narrow
    // purchase-only adoption fixture has no AI, tenant, sales, or identity
    // tables, so it has no valid ALTER target; mark this migration as a no-op
    // only for that exact partial shape. Any adopted database that owns the AI
    // audit table must still apply the new column.
    if (entry.tag === '0032_copilot_response_mode') {
      return (
        !tableExists('ai_audit_log') &&
        !tableExists('sale_items') &&
        !tableExists('product_serials') &&
        !tableExists('products') &&
        !tableExists('sales') &&
        !tableExists('tenants') &&
        !tableExists('manager_approval_requests') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers')
      );
    }
    // AI cost-state accounting ALTERs ai_audit_log. The purchase-only
    // adoption fixture has neither that target nor the tenant-owned alert
    // tables introduced immediately before it. Advancing to this marker is
    // safe only for the same isolated legacy shape; any real adopted database
    // with an AI audit surface must run the ALTER normally.
    if (entry.tag === '0034_illegal_bloodstrike') {
      return (
        !tableExists('ai_audit_log') &&
        !tableExists('operational_alerts') &&
        !tableExists('sale_items') &&
        !tableExists('product_serials') &&
        !tableExists('products') &&
        !tableExists('sales') &&
        !tableExists('tenants') &&
        !tableExists('manager_approval_requests') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers')
      );
    }
    // Exact-search indexes replace indexes on products and unit_x_product.
    // SQLite cannot condition CREATE INDEX on table existence, so the
    // purchase-only adoption shape must pin this no-op. Preserve every prior
    // late target in the guard: pinning the newest marker on a mixed partial
    // database would otherwise make Drizzle skip an earlier applicable ALTER.
    if (entry.tag === '0035_product_exact_lookup') {
      return (
        !tableExists('unit_x_product') &&
        !tableExists('products') &&
        !tableExists('ai_audit_log') &&
        !tableExists('operational_alerts') &&
        !tableExists('sale_items') &&
        !tableExists('product_serials') &&
        !tableExists('sales') &&
        !tableExists('tenants') &&
        !tableExists('manager_approval_requests') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers')
      );
    }
    // FTS5 creation backfills products and installs product triggers. The
    // purchase-only adoption fixture has no valid source/trigger target, so
    // pin the custom migration only under the complete absent-target guard.
    if (entry.tag === '0036_product_fts_search') {
      return (
        !tableExists('product_search_fts') &&
        !tableExists('unit_x_product') &&
        !tableExists('products') &&
        !tableExists('ai_audit_log') &&
        !tableExists('operational_alerts') &&
        !tableExists('sale_items') &&
        !tableExists('product_serials') &&
        !tableExists('sales') &&
        !tableExists('tenants') &&
        !tableExists('manager_approval_requests') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers')
      );
    }
    // Product-vector BLOB storage ALTERs `products`. The purchase-only
    // adoption fixture that safely pinned every preceding late migration has
    // no target for this ALTER either. Reuse the complete 0036 absent-target
    // guard so a mixed partial database can never skip an earlier applicable
    // migration merely because `products` itself is absent.
    if (entry.tag === '0037_product_embedding_blob') {
      return (
        !tableExists('product_search_fts') &&
        !tableExists('unit_x_product') &&
        !tableExists('products') &&
        !tableExists('ai_audit_log') &&
        !tableExists('operational_alerts') &&
        !tableExists('sale_items') &&
        !tableExists('product_serials') &&
        !tableExists('sales') &&
        !tableExists('tenants') &&
        !tableExists('manager_approval_requests') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers')
      );
    }
    // service items ALTER `products` (tracks_stock) and
    // `sale_items` (tracks_stock_snapshot). Same narrow purchase-only
    // fixture guard as the preceding product migrations: a mixed partial DB
    // carrying any of these targets must still run the pending chain rather
    // than advancing past it.
    if (
      entry.tag === '0038_product_tracks_stock' ||
      entry.tag === '0039_sale_item_tracks_stock_snapshot' ||
      // tax-kind ALTERs vat_rates, products and sale_items.
      // vat_rates joins the absence list below because it is the first
      // guarded migration touching a table outside the shared set - a
      // partial DB carrying vat_rates must still run the ALTER or the
      // first vatRates.list would hit 'no such column: kind'.
      entry.tag === '0040_tax_kind' ||
      // price-tier ALTERs customers, which the shared absence
      // list below already covers.
      entry.tag === '0041_price_tier' ||
      // unit-code snapshot ALTERs sale_items, also covered below.
      entry.tag === '0042_unit_standard_code_snapshot' ||
      // audit hash chain ALTERs audit_logs and creates the
      // heads table; audit_logs joins the absence list below (same
      // precedent as vat_rates in 0040) so a partial DB that carries
      // audit_logs without the shared tables still runs the ALTERs
      // instead of failing the first writeAuditLog at runtime.
      entry.tag === '0043_audit_hash_chain' ||
      // head-mac anchor ALTERs audit_chain_heads (created in 0043);
      // a DB carrying that table must run the ALTER.
      entry.tag === '0044_audit_head_mac' ||
      // Price-tier unit grids rebuild unit_x_product and sale_items, then
      // ALTER quotations. A purchase-only adoption has none of those targets,
      // so it must pin the migration instead of executing its first UPDATE
      // against a table that does not exist.
      entry.tag === '0045_price_tier_unit_grid'
    ) {
      return (
        (entry.tag !== '0040_tax_kind' || !tableExists('vat_rates')) &&
        (entry.tag !== '0043_audit_hash_chain' || !tableExists('audit_logs')) &&
        // 0044 must NOT be seeded when 0043 is about to run: 0043
        // creates audit_chain_heads WITHOUT head_mac, so seeding 0044
        // past it leaves the column missing while the journal claims
        // it applied. Gate on audit_logs exactly like 0043 so the two
        // always seed (or run) together.
        (entry.tag !== '0044_audit_head_mac' ||
          (!tableExists('audit_chain_heads') && !tableExists('audit_logs'))) &&
        (entry.tag !== '0045_price_tier_unit_grid' || !tableExists('quotations')) &&
        !tableExists('product_search_fts') &&
        !tableExists('unit_x_product') &&
        !tableExists('products') &&
        !tableExists('ai_audit_log') &&
        !tableExists('operational_alerts') &&
        !tableExists('sale_items') &&
        !tableExists('product_serials') &&
        !tableExists('sales') &&
        !tableExists('tenants') &&
        !tableExists('manager_approval_requests') &&
        !tableExists('cash_sessions') &&
        !tableExists('employee_shifts') &&
        !tableExists('users') &&
        !tableExists('customers')
      );
    }
    return false;
  };
  const adoptionEntries = orderedEntries.filter(
    entry => entry.tag.endsWith('_baseline') || shouldSeedPostBaselineMigration(entry)
  );
  const insert = sqlite.prepare(
    'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)'
  );

  // Compute each migration hash exactly like drizzle-orm's
  // `readMigrationFiles` does: sha256 of the raw `.sql` contents, no
  // normalisation. Seed only the baseline marker(s) plus explicitly
  // absent-target no-ops; applicable newer journal entries must remain
  // pending so drizzleMigrate applies them.
  for (const entry of adoptionEntries) {
    const sqlPath = resolve(migrationsFolder, `${entry.tag}.sql`);
    const sqlContents = readFileSync(sqlPath, 'utf8');
    const hash = createHash('sha256').update(sqlContents).digest('hex');
    insert.run(hash, entry.when);
  }
}
