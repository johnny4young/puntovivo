import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { count } from 'drizzle-orm';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDatabase, initDatabase } from '../db/index.js';
import { companies, sequentials, sites, tenants, units, users, vatRates } from '../db/schema.js';

describe('database foundation seed', () => {
  afterEach(() => {
    closeDatabase();
  });

  it('seeds the phase 0 foundation data into a fresh database', async () => {
    const db = await initDatabase({
      dbPath: ':memory:',
      runMigrations: true,
      seedData: true,
    });

    const tenantCount = await db.select({ value: count() }).from(tenants).get();
    const userCount = await db.select({ value: count() }).from(users).get();
    const companyCount = await db.select({ value: count() }).from(companies).get();
    const siteCount = await db.select({ value: count() }).from(sites).get();
    const vatRateCount = await db.select({ value: count() }).from(vatRates).get();
    const unitCount = await db.select({ value: count() }).from(units).get();
    const sequentialCount = await db.select({ value: count() }).from(sequentials).get();

    expect(tenantCount?.value).toBe(1);
    expect(userCount?.value).toBe(1);
    expect(companyCount?.value).toBe(1);
    expect(siteCount?.value).toBe(1);
    expect(vatRateCount?.value).toBeGreaterThanOrEqual(3);
    expect(unitCount?.value).toBeGreaterThanOrEqual(5);
    expect(sequentialCount?.value).toBeGreaterThanOrEqual(3);
  });

  it('adds newer purchase item columns before creating dependent indexes on a legacy database', async () => {
    const dbPath = join(tmpdir(), `open-yojob-legacy-${Date.now()}.sqlite`);
    const legacyDb = new Database(dbPath);

    legacyDb.exec(`
      CREATE TABLE purchases (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        purchase_number TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        site_id TEXT NOT NULL,
        subtotal REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        notes TEXT,
        created_by TEXT NOT NULL,
        sync_status TEXT DEFAULT 'pending',
        sync_version INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE purchase_items (
        id TEXT PRIMARY KEY,
        purchase_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_id TEXT NOT NULL,
        unit_equivalence REAL NOT NULL DEFAULT 1,
        cost_per_unit REAL NOT NULL DEFAULT 0,
        base_unit_cost REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0
      );
    `);
    legacyDb.close();

    try {
      await initDatabase({
        dbPath,
        runMigrations: true,
        seedData: false,
      });

      const inspectionDb = new Database(dbPath, { readonly: true });
      const columns = inspectionDb
        .prepare('PRAGMA table_info(purchase_items)')
        .all() as Array<{ name: string }>;
      const indexes = inspectionDb
        .prepare('PRAGMA index_list(purchase_items)')
        .all() as Array<{ name: string }>;
      inspectionDb.close();

      expect(columns.some(column => column.name === 'source_order_item_id')).toBe(true);
      expect(indexes.some(index => index.name === 'idx_purchase_items_source_order_item')).toBe(true);
    } finally {
      await rm(dbPath, { force: true });
      await rm(`${dbPath}-wal`, { force: true });
      await rm(`${dbPath}-shm`, { force: true });
    }
  });
});
