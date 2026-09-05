/** Real pre-durable databases retain kitchen evidence across upgrade and encrypted restart. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { kdsOrders } from '../db/schema.js';
import { adoptLegacyKitchenOrder } from '../application/kds/legacy.js';
import { projectKitchenOrders } from '../application/kds/read.js';

const migrationsFolder = resolve(process.cwd(), 'src/db/migrations');
const key = 'ab'.repeat(32);
const snapshot = JSON.stringify([
  {
    saleItemId: 'line',
    productId: 'product',
    productName: 'Original plate',
    quantity: 0.125,
    notes: 'No salt',
  },
]);

/** This prefix is the actual schema shipped immediately before durable kitchen state. */
function copyPreDurableMigrations(destination: string) {
  cpSync(migrationsFolder, destination, { recursive: true });
  const path = join(destination, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter(entry => entry.idx < 64);
  expect(journal.entries).toHaveLength(64);
  writeFileSync(path, JSON.stringify(journal));
}

describe('Durable kitchen database upgrade', () => {
  for (const encrypted of [false, true]) {
    it(`preserves legacy snapshots and adopts exactly once after restart (encrypted=${encrypted})`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'puntovivo-kitchen-upgrade-'));
      const dbPath = join(directory, 'historical.db');
      const historicalMigrations = join(directory, 'migrations');
      const encryption = encrypted ? { encryptionKey: key } : {};
      try {
        copyPreDurableMigrations(historicalMigrations);
        await initDatabase({
          dbPath,
          seedData: false,
          migrationsFolder: historicalMigrations,
          ...encryption,
        });
        const old = (getDatabase() as unknown as { $client: Database.Database }).$client;
        old.exec(`
          INSERT INTO tenants (id, name, slug) VALUES ('tenant', 'Kitchen', 'kitchen');
          INSERT INTO companies (id, tenant_id, name) VALUES ('company', 'tenant', 'Kitchen');
          INSERT INTO sites (id, tenant_id, company_id, name) VALUES ('site', 'tenant', 'company', 'Central');
          INSERT INTO users (id, tenant_id, email, name, password_hash) VALUES ('cook', 'tenant', 'cook@test.invalid', 'Cook', 'unused');
          INSERT INTO products (id, tenant_id, name, sku) VALUES ('product', 'tenant', 'Renamed plate', 'PLATE');
          INSERT INTO sales (id, tenant_id, sale_number, status, created_by) VALUES ('sale', 'tenant', 'OLD-1', 'draft', 'cook');
          INSERT INTO sales (id, tenant_id, sale_number, status, created_by) VALUES ('bad-sale', 'tenant', 'OLD-2', 'draft', 'cook');
          INSERT INTO sale_items (id, sale_id, product_id, quantity) VALUES ('line', 'sale', 'product', 0.125);
        `);
        const insert = old.prepare(`INSERT INTO kds_orders
          (id, tenant_id, site_id, sale_id, sale_number, items_json, status)
          VALUES (?, 'tenant', 'site', ?, ?, ?, 'pending')`);
        insert.run('order', 'sale', 'OLD-1', snapshot);
        insert.run('bad-order', 'bad-sale', 'OLD-2', '{truncated');
        closeDatabase();
        if (encrypted)
          expect(readFileSync(dbPath).subarray(0, 16).toString()).not.toBe('SQLite format 3\0');

        await initDatabase({ dbPath, seedData: false, ...encryption });
        const db = getDatabase();
        const sqlite = (db as unknown as { $client: Database.Database }).$client;
        const order = db.select().from(kdsOrders).where(eq(kdsOrders.id, 'order')).get()!;
        expect(order).toMatchObject({
          itemsJson: snapshot,
          dispatchKey: 'legacy',
          snapshotVersion: 1,
          version: 1,
        });
        expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(sqlite.prepare('SELECT * FROM kds_order_events').all()).toEqual([]);
        expect(sqlite.prepare('SELECT * FROM kds_outbox').all()).toEqual([]);
        const before = db.transaction(tx =>
          projectKitchenOrders(tx, 'tenant', 'site', tx.select().from(kdsOrders).all())
        );
        expect(before.find(item => item.id === 'order')).toMatchObject({
          integrity: 'valid',
          items: [{ productName: 'Original plate', quantity: 0.125, notes: 'No salt' }],
        });
        expect(before.find(item => item.id === 'bad-order')).toMatchObject({
          integrity: 'invalid',
          items: [],
        });
        db.transaction(tx => adoptLegacyKitchenOrder(tx, order), { behavior: 'immediate' });
        expect(sqlite.prepare('SELECT kind FROM kds_order_events').all()).toEqual([
          { kind: 'adopted' },
        ]);
        expect(sqlite.prepare('SELECT * FROM kds_outbox').all()).toEqual([]);
        closeDatabase();

        await initDatabase({ dbPath, seedData: false, ...encryption });
        const restarted = getDatabase();
        const restartedSqlite = (restarted as unknown as { $client: Database.Database }).$client;
        const adopted = restarted.select().from(kdsOrders).where(eq(kdsOrders.id, 'order')).get()!;
        restarted.transaction(tx => adoptLegacyKitchenOrder(tx, adopted), {
          behavior: 'immediate',
        });
        expect(adopted).toMatchObject({
          itemsJson: snapshot,
          dispatchKey: 'legacy',
          snapshotVersion: 2,
        });
        expect(restartedSqlite.prepare('SELECT kind FROM kds_order_events').all()).toEqual([
          { kind: 'adopted' },
        ]);
        expect(
          restartedSqlite.prepare('SELECT source_sale_item_id FROM kds_line_dispatches').all()
        ).toEqual([{ source_sale_item_id: 'line' }]);
        expect(
          restartedSqlite.prepare('SELECT items_json FROM kds_orders WHERE id = ?').get('bad-order')
        ).toEqual({ items_json: '{truncated' });
        expect(restartedSqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(restartedSqlite.prepare('PRAGMA integrity_check').get()).toEqual({
          integrity_check: 'ok',
        });
      } finally {
        closeDatabase();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
