/**
 * Database Connection Module
 *
 * Initializes the SQLite database with better-sqlite3 and Drizzle ORM.
 * Handles migrations and provides the database instance.
 *
 * @module db/index
 */

import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import * as schema from './schema.js';
import { seedDefaultData } from './seed.js';

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
  const { dbPath, runMigrations = true, seedData = true, verbose = false } = options;

  // Ensure directory exists (skip for in-memory databases)
  if (dbPath !== ':memory:') {
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
  }

  // Create SQLite connection
  sqlite = new Database(dbPath, {
    verbose: verbose ? console.log : undefined,
  });

  // Enable WAL mode for better concurrent access (skip for in-memory)
  if (dbPath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('foreign_keys = ON');

  // Create Drizzle instance
  db = drizzle(sqlite, { schema });

  // Run schema creation (creates tables if they don't exist)
  if (runMigrations) {
    await runSchemaSync(db);
  }

  // Seed default data if needed
  if (seedData) {
    await seedDefaultData(db);
  }

  if (verbose) {
    console.log(`[Database] Initialized at: ${dbPath}`);
  }

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
    CREATE INDEX IF NOT EXISTS idx_companies_logo ON companies (logo_id);
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
      stock INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER NOT NULL DEFAULT 0,
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
    CREATE INDEX IF NOT EXISTS idx_products_provider ON products (provider_id);
    CREATE INDEX IF NOT EXISTS idx_products_vat_rate ON products (vat_rate_id);
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
    CREATE INDEX IF NOT EXISTS idx_purchases_order ON purchases (order_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_site ON purchases (site_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_created_by ON purchases (created_by);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_tenant_number ON purchases (tenant_id, purchase_number);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_order_unique ON purchases (order_id);

    -- Purchase Items
    CREATE TABLE IF NOT EXISTS purchase_items (
      id TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_id TEXT NOT NULL REFERENCES units(id),
      unit_equivalence REAL NOT NULL DEFAULT 1,
      cost_per_unit REAL NOT NULL DEFAULT 0,
      base_unit_cost REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items (purchase_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items (product_id);

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
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_id TEXT NOT NULL REFERENCES units(id),
      unit_equivalence REAL NOT NULL DEFAULT 1,
      cost_per_unit REAL NOT NULL DEFAULT 0,
      base_unit_cost REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items (product_id);

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
      notes TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
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
      quantity INTEGER NOT NULL DEFAULT 1,
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

    -- Inventory Movements
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      previous_stock INTEGER NOT NULL,
      new_stock INTEGER NOT NULL,
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
      normalized_quantity INTEGER NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      previous_stock INTEGER NOT NULL,
      new_stock INTEGER NOT NULL,
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
  ensureColumn(client, 'departments', 'country_id', 'country_id TEXT REFERENCES countries(id)');
  ensureColumn(client, 'customers', 'identification_type_id', 'identification_type_id TEXT');
  ensureColumn(client, 'customers', 'person_type_id', 'person_type_id TEXT');
  ensureColumn(client, 'customers', 'regime_type_id', 'regime_type_id TEXT');
  ensureColumn(client, 'customers', 'client_type_id', 'client_type_id TEXT');
  ensureColumn(client, 'customers', 'commercial_activity_id', 'commercial_activity_id TEXT');
  ensureColumn(client, 'purchases', 'status', "status TEXT NOT NULL DEFAULT 'completed'");
  ensureColumn(client, 'purchases', 'order_id', 'order_id TEXT');
  ensureColumn(client, 'sale_items', 'unit_id', 'unit_id TEXT');
  ensureColumn(client, 'sale_items', 'unit_equivalence', 'unit_equivalence REAL NOT NULL DEFAULT 1');
  ensureColumn(client, 'sale_items', 'cost_at_sale', 'cost_at_sale REAL NOT NULL DEFAULT 0');
  ensureColumn(client, 'companies', 'logo_id', 'logo_id TEXT REFERENCES logos(id)');
  client.exec('CREATE INDEX IF NOT EXISTS idx_purchases_order ON purchases (order_id)');
  client.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_order_unique ON purchases (order_id)');
  client.exec('CREATE INDEX IF NOT EXISTS idx_companies_logo ON companies (logo_id)');
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

// Re-export schema
export * from './schema.js';
