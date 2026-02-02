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

    -- Products
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      sku TEXT NOT NULL,
      description TEXT,
      category_id TEXT REFERENCES categories(id),
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tenant_sku ON products (tenant_id, sku);

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
      notes TEXT,
      is_active INTEGER DEFAULT 1,
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers (tenant_id);
    CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email);

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
      discount REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items (product_id);

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
}

// Re-export schema
export * from './schema.js';
