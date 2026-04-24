/**
 * Database Connection Module
 *
 * Initializes the SQLite database with better-sqlite3 and Drizzle ORM.
 * Handles migrations and provides the database instance.
 *
 * @module db/index
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createModuleLogger } from '../logging/logger.js';
import * as schema from './schema.js';
import { seedDefaultData } from './seed.js';

const dbLog = createModuleLogger('db');

// ENG-002 — versioned Drizzle migrations live next to this module. Resolved
// at module load so the path is valid whether we run tests, dev, or the
// bundled Electron main process (each preserves directory layout).
const MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'migrations'
);

export type DatabaseInstance = BetterSQLite3Database<typeof schema>;

let db: DatabaseInstance | null = null;
let sqlite: Database.Database | null = null;

export interface DatabaseOptions {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Whether to run migrations on startup (default: true) */
  runMigrations?: boolean;
  /** Whether to seed default data if database is empty (default: true) */
  seedData?: boolean;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
  /**
   * Override the folder that holds the generated Drizzle SQL files +
   * `meta/_journal.json`. Defaults to the `migrations/` directory adjacent
   * to this compiled module (valid for dev, tests, and the standalone
   * server). Packaged Electron builds must pass an explicit path because
   * Vite bundles the server into a single `.cjs` and the `.sql` assets
   * ship separately via Forge `extraResource`.
   */
  migrationsFolder?: string;
}

/**
 * Initialize the database connection
 */
export async function initDatabase(options: DatabaseOptions): Promise<DatabaseInstance>;
export async function initDatabase(dbPath: string): Promise<DatabaseInstance>;
export async function initDatabase(
  optionsOrPath: DatabaseOptions | string
): Promise<DatabaseInstance> {
  const options = typeof optionsOrPath === 'string' ? { dbPath: optionsOrPath } : optionsOrPath;
  const {
    dbPath,
    runMigrations = true,
    seedData = true,
    verbose = false,
    migrationsFolder,
  } = options;
  const effectiveMigrationsFolder = migrationsFolder ?? MIGRATIONS_FOLDER;

  // Ensure directory exists (skip for in-memory databases)
  if (dbPath !== ':memory:') {
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
  }

  // Create SQLite connection. `better-sqlite3`'s verbose hook emits one
  // entry per SQL statement — route it through the db module logger at
  // trace level so it shows up only when the operator explicitly opts in
  // via PUNTOVIVO_LOG_LEVEL=trace AND the server is booted with
  // verbose=true. In production (verbose=false) no hook is wired and
  // sqlite stays quiet.
  sqlite = new Database(dbPath, {
    verbose: verbose ? (statement: unknown) => dbLog.trace({ statement }, 'sqlite') : undefined,
  });

  // Enable WAL mode for better concurrent access (skip for in-memory)
  if (dbPath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('foreign_keys = ON');

  // Create Drizzle instance
  db = drizzle(sqlite, { schema });

  // ENG-002 — versioned migrations first, raw-DDL fallback second.
  if (runMigrations) {
    // Shim for pre-ENG-002 installs: when the DB already has tables (e.g.
    // `tenants`) but no `__drizzle_migrations` row, seed the baseline entry
    // so `drizzleMigrate` treats it as already applied and skips the DDL
    // that would collide with the existing objects.
    ensureMigrationBaseline(sqlite, effectiveMigrationsFolder);

    // Apply every migration whose `folderMillis` is greater than the
    // latest row in `__drizzle_migrations`. On a fresh DB this runs the
    // baseline (plus any follow-ups); on an adopted DB the shim above
    // pinned the baseline so this is a no-op.
    //
    // The folder-existence guard is a belt-and-suspenders safety net:
    // packaged Electron builds now ship the migrations via forge
    // `extraResource` and the desktop main passes `migrationsFolder`
    // explicitly, so the real path is always the one we honor in
    // production. The guard still protects hand-crafted deployments and
    // tests that intentionally boot with no migrations folder — in that
    // case `runSchemaSync()` below takes over and the app still boots.
    if (existsSync(resolve(effectiveMigrationsFolder, 'meta', '_journal.json'))) {
      drizzleMigrate(db, { migrationsFolder: effectiveMigrationsFolder });
    } else {
      dbLog.warn(
        { migrationsFolder: effectiveMigrationsFolder },
        'migrations folder missing; falling back to runSchemaSync(). ship the migrations folder alongside the server bundle to enable versioned migrations.'
      );
    }

    // Legacy bootstrap retained as belt-and-suspenders for one release
    // cycle — it is idempotent thanks to `IF NOT EXISTS`, so running it
    // after `drizzleMigrate` is a no-op on both fresh and adopted DBs.
    // Follow-up ticket will retire this once the shim has made one round.
    await runSchemaSync(db);
  }

  // Seed default data if needed
  if (seedData) {
    await seedDefaultData(db);
  }

  dbLog.info({ dbPath }, 'database initialized');

  return db;
}

/**
 * Get the current database instance
 */
export function getDatabase(): DatabaseInstance {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}

interface DrizzleJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface DrizzleJournal {
  version: string;
  dialect: string;
  entries: DrizzleJournalEntry[];
}

/**
 * ENG-002 — adoption shim for DBs that were bootstrapped via the legacy
 * `runSchemaSync()` before versioned migrations existed.
 *
 * If the DB already carries application data (probed via any user
 * table) but has no `__drizzle_migrations` row, this function seeds
 * **every** journal entry with the exact (hash, created_at) tuple
 * that drizzle-orm's migrator would have written itself. That way the
 * first real `drizzleMigrate()` call finds nothing pending, skips all
 * DDL that would collide with the existing objects, and the follow-up
 * `runSchemaSync()` makes up any missing columns via `ensureColumn`.
 *
 * No-op on fresh DBs (let migrate() run everything from scratch) and
 * on already-adopted DBs (tracking row exists).
 *
 * Rationale for seeding the full journal (ENG-018):
 * legacy installs have their schema materialised via `runSchemaSync()`,
 * which mirrors every migration's intent. Running `ALTER TABLE` in a
 * later migration against an adopted DB is not safe when the raw-DDL
 * side ships the same columns on CREATE — you can end up ALTERing a
 * table that was just created with the target shape. Pinning the
 * whole journal at adoption time avoids the replay and keeps
 * runSchemaSync as the single authoritative path for legacy installs.
 */
function ensureMigrationBaseline(
  sqlite: Database.Database,
  migrationsFolder: string
): void {
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

  const existingRow = sqlite
    .prepare('SELECT id FROM __drizzle_migrations LIMIT 1')
    .get();
  if (existingRow) {
    // Either this DB already adopted the shim, or drizzleMigrate already
    // ran on a fresh boot. Either way, hands off.
    return;
  }

  const orderedEntries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const insert = sqlite.prepare(
    'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)'
  );

  // Compute each migration hash exactly like drizzle-orm's
  // `readMigrationFiles` does: sha256 of the raw `.sql` contents, no
  // normalisation. Seed them in journal order so the primary-key `id`
  // column matches the expected migration index.
  for (const entry of orderedEntries) {
    const sqlPath = resolve(migrationsFolder, `${entry.tag}.sql`);
    const sqlContents = readFileSync(sqlPath, 'utf8');
    const hash = createHash('sha256').update(sqlContents).digest('hex');
    insert.run(hash, entry.when);
  }
}

/**
 * Run schema synchronization (creates tables from schema)
 * This is a simplified migration that creates tables if they don't exist
 */
async function runSchemaSync(database: DatabaseInstance): Promise<void> {
  const sqlite = database as unknown as { $client: Database.Database };
  const client = sqlite.$client;

  // Create all tables from schema
  client.exec(`
    -- Tenants
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      settings TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug);

    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      session_version INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL DEFAULT 'cashier',
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);

    -- Logos
    CREATE TABLE IF NOT EXISTS logos (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      image_url TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_logos_tenant ON logos (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_logos_tenant_name ON logos (tenant_id, name);

    -- Companies
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      tax_id TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      logo_id TEXT REFERENCES logos(id),
      logo_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_companies_tenant ON companies (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_tenant_name ON companies (tenant_id, name);

    -- Sites
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      company_id TEXT NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sites_company ON sites (company_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_tenant_name ON sites (tenant_id, name);

    -- Countries
    CREATE TABLE IF NOT EXISTS countries (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_countries_tenant ON countries (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_countries_tenant_code ON countries (tenant_id, code);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_countries_tenant_name ON countries (tenant_id, name);

    -- Departments
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      country_id TEXT REFERENCES countries(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_departments_tenant ON departments (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_tenant_code ON departments (tenant_id, code);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_tenant_name ON departments (tenant_id, name);

    -- Cities
    CREATE TABLE IF NOT EXISTS cities (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      department_id TEXT NOT NULL REFERENCES departments(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cities_tenant ON cities (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_cities_department ON cities (department_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cities_tenant_code ON cities (tenant_id, code);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cities_scope_name ON cities (tenant_id, department_id, name);

    -- Providers
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      tax_id TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      city_id TEXT REFERENCES cities(id),
      contact_name TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_providers_tenant ON providers (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_tenant_name ON providers (tenant_id, name);

    -- Units
    CREATE TABLE IF NOT EXISTS units (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      abbreviation TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_units_tenant ON units (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_units_tenant_abbreviation ON units (tenant_id, abbreviation);

    -- VAT Rates
    CREATE TABLE IF NOT EXISTS vat_rates (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      rate REAL NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vat_rates_tenant ON vat_rates (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vat_rates_tenant_name ON vat_rates (tenant_id, name);

    -- Sequentials
    CREATE TABLE IF NOT EXISTS sequentials (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      document_type TEXT NOT NULL,
      prefix TEXT NOT NULL DEFAULT '',
      current_value INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sequentials_tenant ON sequentials (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sequentials_site ON sequentials (site_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sequentials_scope ON sequentials (tenant_id, site_id, document_type);

    -- Categories
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      description TEXT,
      parent_id TEXT REFERENCES categories(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_categories_tenant ON categories (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories (parent_id);

    -- Identification Types
    CREATE TABLE IF NOT EXISTS identification_types (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_identification_types_tenant ON identification_types (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_identification_types_tenant_code ON identification_types (tenant_id, code);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_identification_types_tenant_name ON identification_types (tenant_id, name);

    -- Person Types
    CREATE TABLE IF NOT EXISTS person_types (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_person_types_tenant ON person_types (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_person_types_tenant_code ON person_types (tenant_id, code);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_person_types_tenant_name ON person_types (tenant_id, name);

    -- Regime Types
    CREATE TABLE IF NOT EXISTS regime_types (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_regime_types_tenant ON regime_types (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_regime_types_tenant_code ON regime_types (tenant_id, code);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_regime_types_tenant_name ON regime_types (tenant_id, name);

    -- Client Types
    CREATE TABLE IF NOT EXISTS client_types (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_client_types_tenant ON client_types (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_types_tenant_code ON client_types (tenant_id, code);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_types_tenant_name ON client_types (tenant_id, name);

    -- Locations
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_locations_tenant ON locations (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_tenant_code ON locations (tenant_id, code);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_tenant_name ON locations (tenant_id, name);

    -- Location x Site
    CREATE TABLE IF NOT EXISTS location_x_site (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_location_x_site_tenant ON location_x_site (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_location_x_site_location ON location_x_site (location_id);
    CREATE INDEX IF NOT EXISTS idx_location_x_site_site ON location_x_site (site_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_location_x_site_scope ON location_x_site (tenant_id, location_id, site_id);

    -- Products
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      sku TEXT NOT NULL,
      description TEXT,
      category_id TEXT REFERENCES categories(id),
      price REAL NOT NULL DEFAULT 0,
      price2 REAL NOT NULL DEFAULT 0,
      price3 REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      margin_percent1 REAL NOT NULL DEFAULT 0,
      margin_percent2 REAL NOT NULL DEFAULT 0,
      margin_percent3 REAL NOT NULL DEFAULT 0,
      margin_amount1 REAL NOT NULL DEFAULT 0,
      margin_amount2 REAL NOT NULL DEFAULT 0,
      margin_amount3 REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      vat_rate_id TEXT REFERENCES vat_rates(id),
      provider_id TEXT REFERENCES providers(id),
      location_id TEXT,
      initial_cost REAL NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      sell_by_fraction INTEGER NOT NULL DEFAULT 0,
      fraction_step REAL,
      fraction_minimum REAL,
      is_active INTEGER DEFAULT 1,
      barcode TEXT,
      image_url TEXT,
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_tenant ON products (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku);
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tenant_sku ON products (tenant_id, sku);

    -- Unit X Product
    CREATE TABLE IF NOT EXISTS unit_x_product (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      unit_id TEXT NOT NULL REFERENCES units(id),
      equivalence REAL NOT NULL DEFAULT 1,
      price REAL NOT NULL DEFAULT 0,
      is_base INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_unit_x_product_product ON unit_x_product (product_id);
    CREATE INDEX IF NOT EXISTS idx_unit_x_product_unit ON unit_x_product (unit_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_x_product_scope ON unit_x_product (product_id, unit_id);

    -- Product X Provider
    CREATE TABLE IF NOT EXISTS product_x_provider (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_product_x_provider_product ON product_x_provider (product_id);
    CREATE INDEX IF NOT EXISTS idx_product_x_provider_provider ON product_x_provider (provider_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_x_provider_scope ON product_x_provider (product_id, provider_id);

    -- Category x Provider
    CREATE TABLE IF NOT EXISTS category_x_provider (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_category_x_provider_tenant ON category_x_provider (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_category_x_provider_category ON category_x_provider (category_id);
    CREATE INDEX IF NOT EXISTS idx_category_x_provider_provider ON category_x_provider (provider_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_category_x_provider_scope ON category_x_provider (tenant_id, category_id, provider_id);

    -- Customers
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      postal_code TEXT,
      country TEXT,
      tax_id TEXT,
      identification_type_id TEXT,
      person_type_id TEXT,
      regime_type_id TEXT,
      client_type_id TEXT,
      commercial_activity_id TEXT,
      notes TEXT,
      is_active INTEGER DEFAULT 1,
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email);

    -- Commercial Activities
    CREATE TABLE IF NOT EXISTS commercial_activities (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_commercial_activities_tenant ON commercial_activities (tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_activities_tenant_code ON commercial_activities (tenant_id, code);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_activities_tenant_name ON commercial_activities (tenant_id, name);

    -- Purchases
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      purchase_number TEXT NOT NULL,
      provider_id TEXT NOT NULL REFERENCES providers(id),
      order_id TEXT REFERENCES orders(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      status TEXT NOT NULL DEFAULT 'completed',
      subtotal REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_purchases_tenant ON purchases (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_provider ON purchases (provider_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_site ON purchases (site_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_created_by ON purchases (created_by);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_tenant_number ON purchases (tenant_id, purchase_number);

    -- Purchase Items
    CREATE TABLE IF NOT EXISTS purchase_items (
      id TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      source_order_item_id TEXT REFERENCES order_items(id),
      quantity REAL NOT NULL DEFAULT 1,
      unit_id TEXT NOT NULL REFERENCES units(id),
      unit_equivalence REAL NOT NULL DEFAULT 1,
      cost_per_unit REAL NOT NULL DEFAULT 0,
      base_unit_cost REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items (purchase_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items (product_id);

    -- Purchase Returns
    CREATE TABLE IF NOT EXISTS purchase_returns (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      return_amount REAL NOT NULL DEFAULT 0,
      reason TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_returns_tenant ON purchase_returns (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase ON purchase_returns (purchase_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_returns_created_by ON purchase_returns (created_by);

    -- Purchase Return Items
    CREATE TABLE IF NOT EXISTS purchase_return_items (
      id TEXT PRIMARY KEY,
      purchase_return_id TEXT NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
      purchase_item_id TEXT NOT NULL REFERENCES purchase_items(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL DEFAULT 1,
      unit_id TEXT NOT NULL REFERENCES units(id),
      unit_equivalence REAL NOT NULL DEFAULT 1,
      cost_per_unit REAL NOT NULL DEFAULT 0,
      base_unit_cost REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return ON purchase_return_items (purchase_return_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_return_items_purchase_item ON purchase_return_items (purchase_item_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_return_items_product ON purchase_return_items (product_id);

    -- Orders
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      order_number TEXT NOT NULL,
      provider_id TEXT NOT NULL REFERENCES providers(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      status TEXT NOT NULL DEFAULT 'submitted',
      subtotal REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_orders_provider ON orders (provider_id);
    CREATE INDEX IF NOT EXISTS idx_orders_site ON orders (site_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders (created_by);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tenant_number ON orders (tenant_id, order_number);

    -- Order Items
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL DEFAULT 1,
      unit_id TEXT NOT NULL REFERENCES units(id),
      unit_equivalence REAL NOT NULL DEFAULT 1,
      cost_per_unit REAL NOT NULL DEFAULT 0,
      base_unit_cost REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id);

    -- Cash Sessions
    CREATE TABLE IF NOT EXISTS cash_sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      cashier_id TEXT NOT NULL REFERENCES users(id),
      register_name TEXT NOT NULL,
      opening_float REAL NOT NULL DEFAULT 0,
      opening_count_denominations TEXT NOT NULL,
      expected_balance REAL NOT NULL DEFAULT 0,
      actual_count REAL,
      actual_count_denominations TEXT,
      over_short REAL,
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant ON cash_sessions (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_cash_sessions_site ON cash_sessions (site_id);
    CREATE INDEX IF NOT EXISTS idx_cash_sessions_cashier ON cash_sessions (cashier_id);
    CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions (status);
    CREATE INDEX IF NOT EXISTS idx_cash_sessions_site_status ON cash_sessions (site_id, status);
    CREATE INDEX IF NOT EXISTS idx_cash_sessions_register_status ON cash_sessions (site_id, register_name, status);

    -- Denomination Templates
    CREATE TABLE IF NOT EXISTS denomination_templates (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      register_name TEXT NOT NULL,
      label TEXT NOT NULL,
      opening_float REAL NOT NULL DEFAULT 0,
      denominations TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_denomination_templates_tenant ON denomination_templates (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_denomination_templates_site ON denomination_templates (site_id);
    CREATE INDEX IF NOT EXISTS idx_denomination_templates_site_active ON denomination_templates (site_id, is_active, sort_order);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_denomination_templates_site_register ON denomination_templates (site_id, register_name);

    -- Cash Movements
    CREATE TABLE IF NOT EXISTS cash_movements (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      session_id TEXT NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      reference_id TEXT,
      note TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cash_movements_tenant ON cash_movements (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements (session_id);
    CREATE INDEX IF NOT EXISTS idx_cash_movements_type ON cash_movements (type);
    CREATE INDEX IF NOT EXISTS idx_cash_movements_created_by ON cash_movements (created_by);
    CREATE INDEX IF NOT EXISTS idx_cash_movements_session_created ON cash_movements (session_id, created_at);

    -- Sales
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      sale_number TEXT NOT NULL,
      customer_id TEXT REFERENCES customers(id),
      subtotal REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'draft',
      cash_session_id TEXT REFERENCES cash_sessions(id),
      notes TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      suspended_at TEXT,
      suspended_by TEXT REFERENCES users(id),
      suspended_label TEXT,
      reprint_count INTEGER NOT NULL DEFAULT 0,
      last_reprinted_at TEXT,
      last_reprinted_by TEXT REFERENCES users(id),
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_tenant ON sales (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id);
    CREATE INDEX IF NOT EXISTS idx_sales_created_by ON sales (created_by);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_tenant_number ON sales (tenant_id, sale_number);

    -- Sale Items
    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      unit_id TEXT REFERENCES units(id),
      unit_equivalence REAL NOT NULL DEFAULT 1,
      discount REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      cost_at_sale REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items (product_id);

    -- Sale Returns
    CREATE TABLE IF NOT EXISTS sale_returns (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      refund_amount REAL NOT NULL DEFAULT 0,
      reason TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sale_returns_tenant ON sale_returns (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sale_returns_sale ON sale_returns (sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_returns_created_by ON sale_returns (created_by);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_returns_sale_unique ON sale_returns (sale_id);

    -- Sale Payments (Phase 2 Tier-2 step 5 — split tenders / multi-payment)
    CREATE TABLE IF NOT EXISTS sale_payments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      amount REAL NOT NULL,
      reference TEXT,
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sale_payments_tenant ON sale_payments (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments (sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_payments_method ON sale_payments (method);

    -- Inventory Movements
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      previous_stock REAL NOT NULL,
      new_stock REAL NOT NULL,
      reference TEXT,
      notes TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_tenant ON inventory_movements (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_movements (product_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_created_by ON inventory_movements (created_by);

    -- Initial Inventory
    CREATE TABLE IF NOT EXISTS initial_inventory (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      unit_id TEXT NOT NULL REFERENCES units(id),
      site_id TEXT REFERENCES sites(id),
      mode TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_equivalence REAL NOT NULL DEFAULT 1,
      normalized_quantity REAL NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      previous_stock REAL NOT NULL,
      new_stock REAL NOT NULL,
      notes TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_initial_inventory_tenant ON initial_inventory (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_initial_inventory_product ON initial_inventory (product_id);
    CREATE INDEX IF NOT EXISTS idx_initial_inventory_unit ON initial_inventory (unit_id);
    CREATE INDEX IF NOT EXISTS idx_initial_inventory_site ON initial_inventory (site_id);
    CREATE INDEX IF NOT EXISTS idx_initial_inventory_created_by ON initial_inventory (created_by);

    -- Inventory Balances (Phase 2 DB-101)
    CREATE TABLE IF NOT EXISTS inventory_balances (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      on_hand REAL NOT NULL DEFAULT 0,
      reserved REAL NOT NULL DEFAULT 0,
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_balances_tenant ON inventory_balances (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_balances_site ON inventory_balances (site_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_balances_product ON inventory_balances (product_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_balances_scope ON inventory_balances (tenant_id, site_id, product_id);

    -- Transfer Orders (Phase 2 DB-102 — step 1 + step 3 deferred receive)
    CREATE TABLE IF NOT EXISTS transfer_orders (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      from_site_id TEXT NOT NULL REFERENCES sites(id),
      to_site_id TEXT NOT NULL REFERENCES sites(id),
      status TEXT NOT NULL DEFAULT 'completed',
      notes TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      received_at TEXT,
      received_by TEXT REFERENCES users(id),
      discrepancy_notes TEXT,
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_transfer_orders_tenant ON transfer_orders (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_transfer_orders_from_site ON transfer_orders (from_site_id);
    CREATE INDEX IF NOT EXISTS idx_transfer_orders_to_site ON transfer_orders (to_site_id);
    CREATE INDEX IF NOT EXISTS idx_transfer_orders_status ON transfer_orders (status);
    -- Note: idx_transfer_orders_received_by is created by the
    -- createIndexIfColumnsExist call below, AFTER ensureColumn has added the
    -- received_by column to pre-existing deployments.

    CREATE TABLE IF NOT EXISTS transfer_order_items (
      id TEXT PRIMARY KEY,
      transfer_order_id TEXT NOT NULL REFERENCES transfer_orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL,
      received_quantity REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_transfer_order_items_order ON transfer_order_items (transfer_order_id);
    CREATE INDEX IF NOT EXISTS idx_transfer_order_items_product ON transfer_order_items (product_id);

    -- Quotations (Phase 5 / Tier-2 #6 — pre-sale documents)
    CREATE TABLE IF NOT EXISTS quotations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      quotation_number TEXT NOT NULL,
      customer_id TEXT REFERENCES customers(id),
      status TEXT NOT NULL DEFAULT 'draft',
      subtotal REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      valid_until TEXT,
      notes TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      status_changed_at TEXT,
      status_changed_by TEXT REFERENCES users(id),
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_quotations_tenant ON quotations (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_quotations_site ON quotations (site_id);
    CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations (customer_id);
    CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations (status);
    CREATE INDEX IF NOT EXISTS idx_quotations_created_by ON quotations (created_by);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_quotations_tenant_number ON quotations (tenant_id, quotation_number);

    CREATE TABLE IF NOT EXISTS quotation_items (
      id TEXT PRIMARY KEY,
      quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON quotation_items (quotation_id);
    CREATE INDEX IF NOT EXISTS idx_quotation_items_product ON quotation_items (product_id);

    -- Audit Logs (Phase 8 / Tier-2 #8 — sensitive-action traceability)
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      actor_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      before TEXT,
      after TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs (resource_type, resource_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at);

    -- Receipt Templates (Iter 2 — declarative editor + pure renderer)
    CREATE TABLE IF NOT EXISTS receipt_templates (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      paper_width TEXT NOT NULL DEFAULT '80mm',
      layout TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL REFERENCES users(id),
      updated_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_receipt_templates_tenant ON receipt_templates (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_receipt_templates_tenant_kind ON receipt_templates (tenant_id, kind);
    CREATE INDEX IF NOT EXISTS idx_receipt_templates_tenant_active ON receipt_templates (tenant_id, is_active);
    -- Partial unique: at most one default per (tenant, kind). Drizzle's
    -- SQLite dialect can't express partial uniques, so this lives only in
    -- the raw DDL mirror + the service-layer transaction defense.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_templates_tenant_kind_default
      ON receipt_templates (tenant_id, kind)
      WHERE is_default = 1;

    -- Sync Queue
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      data TEXT,
      local_version INTEGER NOT NULL DEFAULT 1,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sync_queue_tenant ON sync_queue (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue (entity_type, entity_id);

    -- Sync Conflicts
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      local_data TEXT,
      remote_data TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      resolution TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sync_conflicts_tenant ON sync_conflicts (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON sync_conflicts (status);

    -- App Settings
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ENG-017 locale catalogs (global, read-only, PK-seeded on boot).
    CREATE TABLE IF NOT EXISTS currency_catalog (
      code TEXT PRIMARY KEY,
      name_en TEXT NOT NULL,
      name_es TEXT NOT NULL,
      symbol TEXT NOT NULL,
      decimals INTEGER NOT NULL,
      display_decimals INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS country_catalog (
      code TEXT PRIMARY KEY,
      name_en TEXT NOT NULL,
      name_es TEXT NOT NULL,
      default_locale TEXT NOT NULL,
      general_locale TEXT NOT NULL,
      default_currency_code TEXT NOT NULL REFERENCES currency_catalog(code),
      additional_currency_codes TEXT DEFAULT '[]',
      default_timezone TEXT NOT NULL,
      first_day_of_week INTEGER NOT NULL,
      date_format_short TEXT NOT NULL,
      date_format_long TEXT NOT NULL,
      tax_id_types_hint TEXT DEFAULT '[]',
      ui_locale_ready INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS tenant_locale_settings (
      tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      country_code TEXT NOT NULL REFERENCES country_catalog(code),
      locale_override TEXT,
      currency_override TEXT REFERENCES currency_catalog(code),
      timezone_override TEXT,
      first_day_of_week_override INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  ensureColumn(client, 'products', 'price2', 'price2 REAL NOT NULL DEFAULT 0');
  ensureColumn(client, 'products', 'price3', 'price3 REAL NOT NULL DEFAULT 0');
  ensureColumn(client, 'products', 'margin_percent1', 'margin_percent1 REAL NOT NULL DEFAULT 0');
  ensureColumn(client, 'products', 'margin_percent2', 'margin_percent2 REAL NOT NULL DEFAULT 0');
  ensureColumn(client, 'products', 'margin_percent3', 'margin_percent3 REAL NOT NULL DEFAULT 0');
  ensureColumn(client, 'products', 'margin_amount1', 'margin_amount1 REAL NOT NULL DEFAULT 0');
  ensureColumn(client, 'products', 'margin_amount2', 'margin_amount2 REAL NOT NULL DEFAULT 0');
  ensureColumn(client, 'products', 'margin_amount3', 'margin_amount3 REAL NOT NULL DEFAULT 0');
  ensureColumn(client, 'products', 'vat_rate_id', 'vat_rate_id TEXT');
  ensureColumn(client, 'products', 'provider_id', 'provider_id TEXT');
  ensureColumn(client, 'products', 'location_id', 'location_id TEXT');
  ensureColumn(client, 'products', 'initial_cost', 'initial_cost REAL NOT NULL DEFAULT 0');
  ensureColumn(
    client,
    'products',
    'sell_by_fraction',
    'sell_by_fraction INTEGER NOT NULL DEFAULT 0'
  );
  ensureColumn(client, 'products', 'fraction_step', 'fraction_step REAL');
  ensureColumn(client, 'products', 'fraction_minimum', 'fraction_minimum REAL');
  ensureColumn(client, 'departments', 'country_id', 'country_id TEXT REFERENCES countries(id)');
  ensureColumn(client, 'customers', 'identification_type_id', 'identification_type_id TEXT');
  ensureColumn(client, 'customers', 'person_type_id', 'person_type_id TEXT');
  ensureColumn(client, 'customers', 'regime_type_id', 'regime_type_id TEXT');
  ensureColumn(client, 'customers', 'client_type_id', 'client_type_id TEXT');
  ensureColumn(client, 'customers', 'commercial_activity_id', 'commercial_activity_id TEXT');
  ensureColumn(client, 'purchases', 'status', "status TEXT NOT NULL DEFAULT 'completed'");
  ensureColumn(client, 'purchases', 'order_id', 'order_id TEXT');
  ensureColumn(client, 'purchase_items', 'source_order_item_id', 'source_order_item_id TEXT');
  ensureColumn(client, 'cash_sessions', 'tenant_id', 'tenant_id TEXT');
  ensureColumn(client, 'cash_sessions', 'site_id', 'site_id TEXT');
  ensureColumn(client, 'cash_sessions', 'cashier_id', 'cashier_id TEXT');
  ensureColumn(client, 'cash_sessions', 'register_name', "register_name TEXT NOT NULL DEFAULT 'Main register'");
  ensureColumn(client, 'cash_sessions', 'opening_float', 'opening_float REAL NOT NULL DEFAULT 0');
  ensureColumn(
    client,
    'cash_sessions',
    'opening_count_denominations',
    "opening_count_denominations TEXT NOT NULL DEFAULT '[]'"
  );
  ensureColumn(client, 'cash_sessions', 'expected_balance', 'expected_balance REAL NOT NULL DEFAULT 0');
  ensureColumn(client, 'cash_sessions', 'actual_count', 'actual_count REAL');
  ensureColumn(client, 'cash_sessions', 'actual_count_denominations', 'actual_count_denominations TEXT');
  ensureColumn(client, 'cash_sessions', 'over_short', 'over_short REAL');
  ensureColumn(client, 'cash_sessions', 'status', "status TEXT NOT NULL DEFAULT 'open'");
  ensureColumn(client, 'cash_sessions', 'opened_at', "opened_at TEXT NOT NULL DEFAULT (datetime('now'))");
  ensureColumn(client, 'cash_sessions', 'closed_at', 'closed_at TEXT');
  ensureColumn(client, 'cash_sessions', 'created_at', "created_at TEXT NOT NULL DEFAULT (datetime('now'))");
  ensureColumn(client, 'cash_sessions', 'updated_at', "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  ensureColumn(client, 'cash_movements', 'tenant_id', 'tenant_id TEXT');
  ensureColumn(client, 'cash_movements', 'session_id', 'session_id TEXT');
  ensureColumn(client, 'cash_movements', 'type', "type TEXT NOT NULL DEFAULT 'paid_in'");
  ensureColumn(client, 'cash_movements', 'amount', 'amount REAL NOT NULL DEFAULT 0');
  ensureColumn(client, 'cash_movements', 'reference_id', 'reference_id TEXT');
  ensureColumn(client, 'cash_movements', 'note', 'note TEXT');
  ensureColumn(client, 'cash_movements', 'created_by', 'created_by TEXT');
  ensureColumn(client, 'cash_movements', 'created_at', "created_at TEXT NOT NULL DEFAULT (datetime('now'))");
  ensureColumn(client, 'sales', 'cash_session_id', 'cash_session_id TEXT');
  // ENG-018 — park-and-resume columns backfilled for installs created
  // before the 0002 migration landed.
  ensureColumn(client, 'sales', 'suspended_at', 'suspended_at TEXT');
  ensureColumn(client, 'sales', 'suspended_by', 'suspended_by TEXT');
  ensureColumn(client, 'sales', 'suspended_label', 'suspended_label TEXT');
  // ENG-019 — reprint bookkeeping. `reprint_count` ships with a 0
  // default so pre-existing rows render the "not reprinted" banner path.
  ensureColumn(client, 'sales', 'reprint_count', 'reprint_count INTEGER NOT NULL DEFAULT 0');
  ensureColumn(client, 'sales', 'last_reprinted_at', 'last_reprinted_at TEXT');
  ensureColumn(client, 'sales', 'last_reprinted_by', 'last_reprinted_by TEXT');
  ensureColumn(client, 'sale_items', 'unit_id', 'unit_id TEXT');
  ensureColumn(client, 'sale_items', 'unit_equivalence', 'unit_equivalence REAL NOT NULL DEFAULT 1');
  ensureColumn(client, 'sale_items', 'cost_at_sale', 'cost_at_sale REAL NOT NULL DEFAULT 0');
  ensureColumn(client, 'companies', 'logo_id', 'logo_id TEXT REFERENCES logos(id)');
  ensureColumn(client, 'users', 'session_version', 'session_version INTEGER NOT NULL DEFAULT 1');
  // Phase 2 API-102 step 3: deferred receive columns on transfer_orders.
  ensureColumn(client, 'transfer_orders', 'received_at', 'received_at TEXT');
  ensureColumn(client, 'transfer_orders', 'received_by', 'received_by TEXT REFERENCES users(id)');
  // Phase 2 UI-103: per-line received quantities and aggregate discrepancy
  // note captured at receive time.
  ensureColumn(client, 'transfer_order_items', 'received_quantity', 'received_quantity REAL');
  ensureColumn(client, 'transfer_orders', 'discrepancy_notes', 'discrepancy_notes TEXT');
  createIndexIfColumnsExist(
    client,
    'transfer_orders',
    ['received_by'],
    'CREATE INDEX IF NOT EXISTS idx_transfer_orders_received_by ON transfer_orders (received_by)'
  );
  createIndexIfColumnsExist(client, 'products', ['provider_id'], 'CREATE INDEX IF NOT EXISTS idx_products_provider ON products (provider_id)');
  createIndexIfColumnsExist(client, 'products', ['vat_rate_id'], 'CREATE INDEX IF NOT EXISTS idx_products_vat_rate ON products (vat_rate_id)');
  createIndexIfColumnsExist(client, 'purchases', ['order_id'], 'CREATE INDEX IF NOT EXISTS idx_purchases_order ON purchases (order_id)');
  createIndexIfColumnsExist(client, 'companies', ['logo_id'], 'CREATE INDEX IF NOT EXISTS idx_companies_logo ON companies (logo_id)');
  createIndexIfColumnsExist(client, 'purchase_items', ['source_order_item_id'], 'CREATE INDEX IF NOT EXISTS idx_purchase_items_source_order_item ON purchase_items (source_order_item_id)');
  createIndexIfColumnsExist(client, 'cash_sessions', ['site_id'], 'CREATE INDEX IF NOT EXISTS idx_cash_sessions_site ON cash_sessions (site_id)');
  createIndexIfColumnsExist(client, 'cash_sessions', ['cashier_id'], 'CREATE INDEX IF NOT EXISTS idx_cash_sessions_cashier ON cash_sessions (cashier_id)');
  createIndexIfColumnsExist(client, 'cash_sessions', ['status'], 'CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions (status)');
  createIndexIfColumnsExist(client, 'cash_sessions', ['site_id', 'status'], 'CREATE INDEX IF NOT EXISTS idx_cash_sessions_site_status ON cash_sessions (site_id, status)');
  createIndexIfColumnsExist(client, 'cash_sessions', ['site_id', 'register_name', 'status'], 'CREATE INDEX IF NOT EXISTS idx_cash_sessions_register_status ON cash_sessions (site_id, register_name, status)');
  createIndexIfColumnsExist(client, 'cash_movements', ['tenant_id'], 'CREATE INDEX IF NOT EXISTS idx_cash_movements_tenant ON cash_movements (tenant_id)');
  createIndexIfColumnsExist(client, 'cash_movements', ['session_id'], 'CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements (session_id)');
  createIndexIfColumnsExist(client, 'cash_movements', ['type'], 'CREATE INDEX IF NOT EXISTS idx_cash_movements_type ON cash_movements (type)');
  createIndexIfColumnsExist(client, 'cash_movements', ['created_by'], 'CREATE INDEX IF NOT EXISTS idx_cash_movements_created_by ON cash_movements (created_by)');
  createIndexIfColumnsExist(client, 'cash_movements', ['session_id', 'created_at'], 'CREATE INDEX IF NOT EXISTS idx_cash_movements_session_created ON cash_movements (session_id, created_at)');
  createIndexIfColumnsExist(client, 'sales', ['cash_session_id'], 'CREATE INDEX IF NOT EXISTS idx_sales_cash_session ON sales (cash_session_id)');
  createIndexIfColumnsExist(
    client,
    'sales',
    ['suspended_by'],
    'CREATE INDEX IF NOT EXISTS idx_sales_suspended_by ON sales (suspended_by)'
  );
  client.exec('DROP INDEX IF EXISTS idx_purchases_order_unique');
  // ENG-017 — seed the read-only locale catalogs on every boot. Both
  // tables are keyed by ISO code so the INSERT-OR-IGNORE pattern keeps
  // the seed idempotent and deterministic even as operators upgrade
  // between versions that add new rows or tweak a symbol.
  seedLocaleCatalogs(client);
}

/**
 * Seed the global `currency_catalog` + `country_catalog` tables with
 * the ENG-017 matrices (18 currencies, 21 LATAM+USA countries). Uses
 * `INSERT OR IGNORE` so the function is safe to re-run on every boot
 * — existing rows are preserved, new rows are added. Updates to
 * existing rows (e.g. adjusting `display_decimals`) require a targeted
 * migration; this seeder never writes over prior values.
 */
function seedLocaleCatalogs(client: Database.Database): void {
  const insertCurrency = client.prepare(
    'INSERT OR IGNORE INTO currency_catalog (code, name_en, name_es, symbol, decimals, display_decimals) VALUES (?, ?, ?, ?, ?, ?)'
  );
  // ISO 4217 codes ordered to mirror the LOCALE-CURRENCY.md matrix.
  const currencies: Array<[string, string, string, string, number, number]> = [
    ['COP', 'Colombian Peso', 'Peso colombiano', '$', 2, 0],
    ['USD', 'US Dollar', 'Dólar estadounidense', '$', 2, 2],
    ['MXN', 'Mexican Peso', 'Peso mexicano', '$', 2, 2],
    ['ARS', 'Argentine Peso', 'Peso argentino', '$', 2, 2],
    ['CLP', 'Chilean Peso', 'Peso chileno', '$', 0, 0],
    ['PEN', 'Peruvian Sol', 'Sol peruano', 'S/', 2, 2],
    ['VES', 'Venezuelan Sovereign Bolívar', 'Bolívar soberano', 'Bs. S', 2, 2],
    ['UYU', 'Uruguayan Peso', 'Peso uruguayo', '$U', 2, 2],
    ['PYG', 'Paraguayan Guaraní', 'Guaraní', '₲', 0, 0],
    ['BOB', 'Bolivian Boliviano', 'Boliviano', 'Bs', 2, 2],
    ['CRC', 'Costa Rican Colón', 'Colón costarricense', '₡', 2, 2],
    ['PAB', 'Panamanian Balboa', 'Balboa', 'B/.', 2, 2],
    ['GTQ', 'Guatemalan Quetzal', 'Quetzal', 'Q', 2, 2],
    ['HNL', 'Honduran Lempira', 'Lempira', 'L', 2, 2],
    ['NIO', 'Nicaraguan Córdoba', 'Córdoba', 'C$', 2, 2],
    ['DOP', 'Dominican Peso', 'Peso dominicano', 'RD$', 2, 2],
    ['CUP', 'Cuban Peso', 'Peso cubano', '$', 2, 2],
    ['BRL', 'Brazilian Real', 'Real', 'R$', 2, 2],
  ];
  for (const row of currencies) {
    insertCurrency.run(...row);
  }

  const insertCountry = client.prepare(
    `INSERT OR IGNORE INTO country_catalog (
       code, name_en, name_es, default_locale, general_locale,
       default_currency_code, additional_currency_codes,
       default_timezone, first_day_of_week, date_format_short,
       date_format_long, tax_id_types_hint, ui_locale_ready
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  type CountryRow = [
    code: string,
    nameEn: string,
    nameEs: string,
    defaultLocale: string,
    generalLocale: string,
    defaultCurrencyCode: string,
    additionalCurrencyCodes: string,
    defaultTimezone: string,
    firstDayOfWeek: number,
    dateFormatShort: string,
    dateFormatLong: string,
    taxIdTypesHint: string,
    uiLocaleReady: number,
  ];
  const countries: CountryRow[] = [
    ['CO', 'Colombia', 'Colombia', 'es-CO', 'es', 'COP', '[]', 'America/Bogota', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CC', 'NIT', 'CE', 'TI', 'PA']), 1],
    ['US', 'United States', 'Estados Unidos', 'en-US', 'en', 'USD', '[]', 'America/New_York', 0, 'MM/dd/yyyy', 'MMMM d, yyyy', JSON.stringify(['SSN', 'EIN']), 1],
    ['MX', 'Mexico', 'México', 'es-MX', 'es', 'MXN', '[]', 'America/Mexico_City', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['RFC', 'CURP']), 1],
    ['AR', 'Argentina', 'Argentina', 'es-AR', 'es', 'ARS', '[]', 'America/Argentina/Buenos_Aires', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DNI', 'CUIT', 'CUIL']), 1],
    ['CL', 'Chile', 'Chile', 'es-CL', 'es', 'CLP', '[]', 'America/Santiago', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['RUT']), 1],
    ['PE', 'Peru', 'Perú', 'es-PE', 'es', 'PEN', '[]', 'America/Lima', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DNI', 'RUC']), 1],
    ['EC', 'Ecuador', 'Ecuador', 'es-EC', 'es', 'USD', '[]', 'America/Guayaquil', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CI', 'RUC']), 1],
    ['VE', 'Venezuela', 'Venezuela', 'es-VE', 'es', 'VES', JSON.stringify(['USD']), 'America/Caracas', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['V', 'E', 'J', 'G']), 1],
    ['UY', 'Uruguay', 'Uruguay', 'es-UY', 'es', 'UYU', '[]', 'America/Montevideo', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CI', 'RUT']), 1],
    ['PY', 'Paraguay', 'Paraguay', 'es-PY', 'es', 'PYG', '[]', 'America/Asuncion', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CI', 'RUC']), 1],
    ['BO', 'Bolivia', 'Bolivia', 'es-BO', 'es', 'BOB', '[]', 'America/La_Paz', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CI', 'NIT']), 1],
    ['CR', 'Costa Rica', 'Costa Rica', 'es-CR', 'es', 'CRC', '[]', 'America/Costa_Rica', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['cedula', 'cedula_juridica']), 1],
    ['PA', 'Panama', 'Panamá', 'es-PA', 'es', 'PAB', JSON.stringify(['USD']), 'America/Panama', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['cedula', 'RUC']), 1],
    ['GT', 'Guatemala', 'Guatemala', 'es-GT', 'es', 'GTQ', '[]', 'America/Guatemala', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DPI', 'NIT']), 1],
    ['SV', 'El Salvador', 'El Salvador', 'es-SV', 'es', 'USD', '[]', 'America/El_Salvador', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DUI', 'NIT']), 1],
    ['HN', 'Honduras', 'Honduras', 'es-HN', 'es', 'HNL', '[]', 'America/Tegucigalpa', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DNI', 'RTN']), 1],
    ['NI', 'Nicaragua', 'Nicaragua', 'es-NI', 'es', 'NIO', '[]', 'America/Managua', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['cedula', 'RUC']), 1],
    ['DO', 'Dominican Republic', 'República Dominicana', 'es-DO', 'es', 'DOP', '[]', 'America/Santo_Domingo', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['cedula', 'RNC']), 1],
    ['CU', 'Cuba', 'Cuba', 'es-CU', 'es', 'CUP', '[]', 'America/Havana', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['carne_identidad']), 1],
    ['PR', 'Puerto Rico', 'Puerto Rico', 'es-PR', 'es', 'USD', '[]', 'America/Puerto_Rico', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['SSN']), 1],
    // Brazil is seeded with uiLocaleReady=0 until the pt-BR bundle
    // ships — the admin UI will warn and still let the operator pick
    // it (formatters work because Intl has pt-BR; only the i18next
    // UI copy needs the bundle).
    ['BR', 'Brazil', 'Brasil', 'pt-BR', 'pt', 'BRL', '[]', 'America/Sao_Paulo', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CPF', 'CNPJ']), 0],
  ];
  for (const row of countries) {
    insertCountry.run(...row);
  }
}

function ensureColumn(
  client: Database.Database,
  tableName: string,
  columnName: string,
  columnDefinition: string
): void {
  const columns = client
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (columns.some(column => column.name === columnName)) {
    return;
  }

  client.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
}

function createIndexIfColumnsExist(
  client: Database.Database,
  tableName: string,
  columnNames: string[],
  statement: string
): void {
  const columns = client
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (!columnNames.every(columnName => columns.some(column => column.name === columnName))) {
    return;
  }

  client.exec(statement);
}

// Re-export schema
export * from './schema.js';
