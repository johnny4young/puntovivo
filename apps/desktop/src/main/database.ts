import Database from 'better-sqlite3';
import { app, ipcMain } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

let db: Database.Database | null = null;

const DB_PATH = join(app.getPath('userData'), 'data');
const DB_FILE = join(DB_PATH, 'local.db');

export async function initDatabase(): Promise<void> {
  // Ensure data directory exists
  if (!existsSync(DB_PATH)) {
    mkdirSync(DB_PATH, { recursive: true });
  }

  // Initialize database
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');

  // Create tables
  createTables();

  // Setup IPC handlers for database operations
  setupDatabaseIPC();

  console.log('Database initialized at:', DB_FILE);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function createTables(): void {
  if (!db) return;

  // Tenants table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      settings TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    );
  `);

  // Products table
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sku TEXT NOT NULL,
      description TEXT,
      category_id TEXT,
      price REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      barcode TEXT,
      image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
      UNIQUE(tenant_id, sku)
    );
  `);

  // Categories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      parent_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
      FOREIGN KEY (parent_id) REFERENCES categories(id)
    );
  `);

  // Customers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    );
  `);

  // Sales table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      sale_number TEXT NOT NULL,
      customer_id TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'draft',
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      UNIQUE(tenant_id, sale_number)
    );
  `);

  // Sale items table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  // Inventory movements table
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      previous_stock INTEGER NOT NULL,
      new_stock INTEGER NOT NULL,
      reference TEXT,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT DEFAULT 'pending',
      sync_version INTEGER DEFAULT 0,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  // Sync queue table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT,
      tenant_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT
    );
  `);

  // Sync conflicts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      local_data TEXT,
      remote_data TEXT,
      resolution TEXT,
      resolved_at DATETIME,
      tenant_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sales_tenant ON sales(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sales_number ON sales(sale_number);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_tenant ON inventory_movements(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_tenant ON sync_queue(tenant_id);
  `);
}

function setupDatabaseIPC(): void {
  // Get all records from a table
  ipcMain.handle('db:getAll', (_event, table: string, tenantId: string) => {
    if (!db) throw new Error('Database not initialized');
    const stmt = db.prepare(`SELECT * FROM ${table} WHERE tenant_id = ?`);
    return stmt.all(tenantId);
  });

  // Get a single record by ID
  ipcMain.handle('db:getById', (_event, table: string, id: string) => {
    if (!db) throw new Error('Database not initialized');
    const stmt = db.prepare(`SELECT * FROM ${table} WHERE id = ?`);
    return stmt.get(id);
  });

  // Insert a record
  ipcMain.handle('db:insert', (_event, table: string, data: Record<string, unknown>) => {
    if (!db) throw new Error('Database not initialized');
    const columns = Object.keys(data);
    const placeholders = columns.map(() => '?').join(', ');
    const values = Object.values(data);
    const stmt = db.prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
    );
    return stmt.run(...values);
  });

  // Update a record
  ipcMain.handle(
    'db:update',
    (_event, table: string, id: string, data: Record<string, unknown>) => {
      if (!db) throw new Error('Database not initialized');
      const updates = Object.keys(data)
        .map(key => `${key} = ?`)
        .join(', ');
      const values = [...Object.values(data), id];
      const stmt = db.prepare(
        `UPDATE ${table} SET ${updates}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      );
      return stmt.run(...values);
    }
  );

  // Delete a record
  ipcMain.handle('db:delete', (_event, table: string, id: string) => {
    if (!db) throw new Error('Database not initialized');
    const stmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    return stmt.run(id);
  });

  // Execute raw query
  ipcMain.handle('db:query', (_event, sql: string, params: unknown[] = []) => {
    if (!db) throw new Error('Database not initialized');
    const stmt = db.prepare(sql);
    return stmt.all(...params);
  });

  // Add to sync queue
  ipcMain.handle('db:addToSyncQueue', (_event, item: Record<string, unknown>) => {
    if (!db) throw new Error('Database not initialized');
    const stmt = db.prepare(`
      INSERT INTO sync_queue (id, entity_type, entity_id, operation, payload, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      item.id,
      item.entityType,
      item.entityId,
      item.operation,
      JSON.stringify(item.payload),
      item.tenantId
    );
  });

  // Get pending sync items
  ipcMain.handle('db:getPendingSyncItems', (_event, tenantId: string) => {
    if (!db) throw new Error('Database not initialized');
    const stmt = db.prepare(`
      SELECT * FROM sync_queue
      WHERE tenant_id = ?
      ORDER BY created_at ASC
    `);
    return stmt.all(tenantId);
  });
}

export function getDatabase(): Database.Database | null {
  return db;
}
