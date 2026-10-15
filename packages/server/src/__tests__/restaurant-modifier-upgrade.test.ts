import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { ensureMigrationBaseline } from '../db/migration-baseline.js';
/** Upgrade an actual pre-catalog schema with a fully linked historical restaurant line. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../db/index.js';
import {
  restaurantCheckLines,
  restaurantChecks,
  restaurantModifierCatalog,
  restaurantServices,
  restaurantTables,
  sales,
  sites,
  users,
} from '../db/schema.js';

describe('restaurant catalog historical upgrade', () => {
  it('stamps only the exact purchase-only no-op, never a mixed schema', () => {
    const folder = resolve(process.cwd(), 'src/db/migrations');
    const hash = createHash('sha256')
      .update(readFileSync(join(folder, '0082_restaurant_modifier_catalog.sql')))
      .digest('hex');
    for (const mixed of [false, true]) {
      const sqlite = new Database(':memory:');
      try {
        sqlite.exec('CREATE TABLE purchases(id TEXT); CREATE TABLE purchase_items(id TEXT)');
        if (mixed) sqlite.exec('CREATE TABLE tenants(id TEXT)');
        ensureMigrationBaseline(sqlite, folder);
        expect(
          Boolean(sqlite.prepare('SELECT id FROM __drizzle_migrations WHERE hash=?').get(hash))
        ).toBe(!mixed);
      } finally {
        sqlite.close();
      }
    }
  });

  for (const encrypted of [false, true])
    it(`preserves historical prices and null provenance through two boots (encrypted=${encrypted})`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'puntovivo-modifier-upgrade-')),
        dbPath = join(dir, 'history.db'),
        prefix = join(dir, 'migrations');
      const encryption = encrypted ? { encryptionKey: 'ef'.repeat(32) } : {};
      try {
        cpSync(resolve(process.cwd(), 'src/db/migrations'), prefix, { recursive: true });
        const journalPath = join(prefix, 'meta/_journal.json');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
          entries: Array<{ idx: number }>;
        };
        journal.entries = journal.entries.filter(row => row.idx < 81);
        expect(journal.entries).toHaveLength(81);
        writeFileSync(journalPath, JSON.stringify(journal));
        const old = await initDatabase({
          dbPath,
          seedData: true,
          migrationsFolder: prefix,
          ...encryption,
        });
        const oldSqlite = (old as typeof old & { $client: Database.Database }).$client;
        const owner = old.select().from(users).get()!,
          site = old.select().from(sites).get()!,
          tenantId = owner.tenantId;
        // Historical fixtures use the historical column list, not today's
        // Drizzle insert shape (which also supplies newly nullable columns).
        oldSqlite
          .prepare('INSERT INTO products(id, tenant_id, name, sku, price) VALUES (?, ?, ?, ?, ?)')
          .run('plate', tenantId, 'Plate', 'OLD-PLATE', 10);
        old
          .insert(restaurantTables)
          .values({ id: 'table', tenantId, siteId: site.id, name: 'Historical table' })
          .run();
        oldSqlite
          .prepare(
            'INSERT INTO sales(id, tenant_id, created_by, sale_number, total, subtotal) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run('sale', tenantId, owner.id, 'HISTORICAL-MODIFIER', 13, 13);
        oldSqlite
          .prepare(
            'INSERT INTO sale_items(id, sale_id, product_id, quantity, unit_price, restaurant_modifier_amount) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run('item', 'sale', 'plate', 1, 13, 3);
        old
          .insert(restaurantServices)
          .values({
            id: 'service',
            tenantId,
            siteId: site.id,
            tableId: 'table',
            openedBy: owner.id,
          })
          .run();
        old
          .insert(restaurantChecks)
          .values({
            id: 'check',
            tenantId,
            serviceId: 'service',
            saleId: 'sale',
            openedBy: owner.id,
          })
          .run();
        old
          .insert(restaurantCheckLines)
          .values({ id: 'line', tenantId, checkId: 'check', saleItemId: 'item' })
          .run();
        oldSqlite
          .prepare(
            'INSERT INTO restaurant_line_modifiers(id,tenant_id,check_line_id,name,quantity,unit_price_delta,position,created_at) VALUES (?,?,?,?,?,?,?,?)'
          )
          .run('modifier', tenantId, 'line', 'Historical cheese', 2, 1.5, 0, '2026-09-01');
        const before = oldSqlite.prepare('SELECT * FROM restaurant_line_modifiers').all();
        expect(oldSqlite.pragma('foreign_key_check')).toEqual([]);
        closeDatabase();
        for (let boot = 0; boot < 2; boot++) {
          const current = await initDatabase({ dbPath, seedData: false, ...encryption });
          const currentSqlite = (current as typeof current & { $client: Database.Database })
            .$client;
          const rows = currentSqlite
            .prepare('SELECT * FROM restaurant_line_modifiers')
            .all() as Array<Record<string, unknown>>;
          expect(rows).toEqual(
            before.map(row => ({ ...(row as object), catalog_id: null, catalog_version: null }))
          );
          expect(current.select().from(restaurantModifierCatalog).all()).toEqual([]);
          expect(currentSqlite.pragma('foreign_key_check')).toEqual([]);
          const migratedSale = current.select().from(sales).get()!;
          expect(migratedSale.total).toBe(13);
          expect(migratedSale.cashReceivedSnapshot).toBeNull();
          expect(migratedSale.cashChangeSnapshot).toBeNull();
          closeDatabase();
        }
      } finally {
        closeDatabase();
        rmSync(dir, { recursive: true, force: true });
      }
    });
});
