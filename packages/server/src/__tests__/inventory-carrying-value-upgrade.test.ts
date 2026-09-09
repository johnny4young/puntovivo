import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../db/index.js';
import { ensureMigrationBaseline } from '../db/migration-baseline.js';
import {
  inventoryLots,
  products,
  purchaseItems,
  purchaseItemLots,
  purchaseReturnItems,
  purchaseReturnItemLots,
  saleItems,
  saleItemSerials,
  saleReturnItemSerials,
  sites,
  users,
} from '../db/schema.js';
import { applyInventoryBalanceDelta } from '../services/inventory-balances.js';
import { consumeExactInventoryLots } from '../services/inventory-lots/exact.js';
import type { AppliedInventoryValueDelta } from '../services/product-valuation.js';

const folder = resolve(process.cwd(), 'src/db/migrations');

describe('exact inventory value historical adoption', () => {
  it('only stamps absent valuation parents on the exact purchase-only legacy fixture', () => {
    for (const mixed of [false, true]) {
      const sqlite = new Database(':memory:');
      try {
        sqlite.exec('CREATE TABLE purchases(id TEXT); CREATE TABLE purchase_items(id TEXT)');
        if (mixed) sqlite.exec('CREATE TABLE tenants(id TEXT)');
        ensureMigrationBaseline(sqlite, folder);
        for (const name of [
          '0083_inventory_carrying_values',
          '0084_sale_carrying_values',
          '0085_transfer_carrying_values',
          '0086_count_carrying_values',
          '0087_count_value_basis',
          '0088_purchase_carrying_values',
          '0089_serial_carrying_values',
          '0090_inventory_value_constraints',
        ]) {
          const hash = createHash('sha256')
            .update(readFileSync(join(folder, `${name}.sql`)))
            .digest('hex');
          expect(
            Boolean(sqlite.prepare('SELECT id FROM __drizzle_migrations WHERE hash=?').get(hash))
          ).toBe(!mixed);
        }
      } finally {
        sqlite.close();
      }
    }
  });

  it.each([false, true])(
    'adopts only observable legacy value and retains it through restart (encrypted=%s)',
    async encrypted => {
      const dir = mkdtempSync(join(tmpdir(), 'puntovivo-value-upgrade-'));
      const dbPath = join(dir, 'history.db');
      const prefix = join(dir, 'migrations');
      const encryption = encrypted ? { encryptionKey: 'ab'.repeat(32) } : {};
      try {
        cpSync(folder, prefix, { recursive: true });
        const journalPath = join(prefix, 'meta/_journal.json');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
          entries: Array<{ idx: number }>;
        };
        journal.entries = journal.entries.filter(row => row.idx < 82);
        expect(journal.entries).toHaveLength(82);
        writeFileSync(journalPath, JSON.stringify(journal));
        const old = await initDatabase({
          dbPath,
          seedData: true,
          migrationsFolder: prefix,
          ...encryption,
        });
        const owner = old.select().from(users).get()!;
        const tenantId = owner.tenantId;
        const siteId = old.select().from(sites).get()!.id;
        const client = old.$client;
        for (const [id, lots] of [
          ['aggregate', 0],
          ['lot-product', 1],
        ] as const) {
          client
            .prepare(
              'INSERT INTO products(id, tenant_id, name, sku, initial_cost, cost, tracks_lots) VALUES (?, ?, ?, ?, ?, ?, ?)'
            )
            .run(id, tenantId, id, id, 0.33, 0.5, lots);
          client
            .prepare(
              'INSERT INTO inventory_balances(id,tenant_id,site_id,product_id,on_hand) VALUES (?,?,?,?,?)'
            )
            .run(`balance-${id}`, tenantId, siteId, id, 3.001);
        }
        client
          .prepare(
            'INSERT INTO inventory_lots(id,tenant_id,site_id,product_id,lot_number,on_hand,unit_cost,received_at) VALUES (?,?,?,?,?,?,?,?)'
          )
          .run('lot', tenantId, siteId, 'lot-product', 'LEGACY-LOT', 3.001, 0.33, '2026-01-01');
        client
          .prepare(
            'INSERT INTO sales(id,tenant_id,created_by,sale_number,status) VALUES (?,?,?,?,?)'
          )
          .run('historical-sale', tenantId, owner.id, 'HISTORICAL-COST', 'draft');
        client
          .prepare(
            'INSERT INTO sale_items(id,sale_id,product_id,quantity,cost_at_sale) VALUES (?,?,?,?,?)'
          )
          .run('historical-line', 'historical-sale', 'aggregate', 1, 0.5);
        const legacyUnit = (
          client.prepare('SELECT id FROM units WHERE tenant_id=? LIMIT 1').get(tenantId) as {
            id: string;
          }
        ).id;
        client
          .prepare('INSERT INTO providers(id,tenant_id,name) VALUES (?,?,?)')
          .run('legacy-provider', tenantId, 'Legacy supplier');
        client
          .prepare(
            'INSERT INTO purchases(id,tenant_id,purchase_number,provider_id,site_id,created_by,total) VALUES (?,?,?,?,?,?,?)'
          )
          .run(
            'legacy-purchase',
            tenantId,
            'LEGACY-RECEIPT',
            'legacy-provider',
            siteId,
            owner.id,
            0.99
          );
        client
          .prepare(
            'INSERT INTO purchase_items(id,purchase_id,product_id,quantity,unit_id,base_unit_cost,total) VALUES (?,?,?,?,?,?,?)'
          )
          .run(
            'legacy-purchase-item',
            'legacy-purchase',
            'lot-product',
            3.001,
            legacyUnit,
            0.33,
            0.99
          );
        client
          .prepare(
            'INSERT INTO purchase_item_lots(id,tenant_id,purchase_item_id,inventory_lot_id,lot_number_snapshot,base_quantity,unit_cost) VALUES (?,?,?,?,?,?,?)'
          )
          .run(
            'legacy-receipt-lot',
            tenantId,
            'legacy-purchase-item',
            'lot',
            'LEGACY-LOT',
            3.001,
            0.33
          );
        client
          .prepare(
            'INSERT INTO purchase_returns(id,tenant_id,purchase_id,created_by,return_amount) VALUES (?,?,?,?,?)'
          )
          .run('legacy-return', tenantId, 'legacy-purchase', owner.id, 0.33);
        client
          .prepare(
            'INSERT INTO purchase_return_items(id,purchase_return_id,purchase_item_id,product_id,quantity,unit_id,base_unit_cost,total) VALUES (?,?,?,?,?,?,?,?)'
          )
          .run(
            'legacy-return-item',
            'legacy-return',
            'legacy-purchase-item',
            'lot-product',
            1,
            legacyUnit,
            0.33,
            0.33
          );
        client
          .prepare(
            'INSERT INTO purchase_return_item_lots(id,tenant_id,purchase_return_item_id,purchase_item_lot_id,inventory_lot_id,base_quantity,unit_cost) VALUES (?,?,?,?,?,?,?)'
          )
          .run(
            'legacy-return-lot',
            tenantId,
            'legacy-return-item',
            'legacy-receipt-lot',
            'lot',
            1,
            0.33
          );
        client
          .prepare(
            'INSERT INTO products(id,tenant_id,name,sku,initial_cost,cost,tracks_serials) VALUES (?,?,?,?,?,?,?)'
          )
          .run(
            'serial-history-product',
            tenantId,
            'Serial history',
            'SERIAL-HISTORY',
            0.33,
            0.33,
            1
          );
        client
          .prepare(
            'INSERT INTO inventory_balances(id,tenant_id,site_id,product_id,on_hand) VALUES (?,?,?,?,?)'
          )
          .run('serial-history-balance', tenantId, siteId, 'serial-history-product', 1);
        client
          .prepare(
            'INSERT INTO cash_sessions(id,tenant_id,site_id,cashier_id,register_name,opening_count_denominations,status) VALUES (?,?,?,?,?,?,?)'
          )
          .run(
            'serial-history-session',
            tenantId,
            siteId,
            owner.id,
            'Historical drawer',
            '[]',
            'closed'
          );
        client
          .prepare(
            'INSERT INTO sales(id,tenant_id,created_by,sale_number,status,cash_session_id,total) VALUES (?,?,?,?,?,?,?)'
          )
          .run(
            'serial-history-sale',
            tenantId,
            owner.id,
            'SERIAL-HISTORY-SALE',
            'returned',
            'serial-history-session',
            1
          );
        client
          .prepare(
            'INSERT INTO sale_items(id,sale_id,product_id,quantity,unit_id,unit_price,cost_at_sale,total) VALUES (?,?,?,?,?,?,?,?)'
          )
          .run(
            'serial-history-line',
            'serial-history-sale',
            'serial-history-product',
            1,
            legacyUnit,
            1,
            0.33,
            1
          );
        client
          .prepare(
            'INSERT INTO product_serials(id,tenant_id,current_site_id,product_id,serial_number,status,unit_cost) VALUES (?,?,?,?,?,?,?)'
          )
          .run(
            'serial-history-unit',
            tenantId,
            siteId,
            'serial-history-product',
            'SERIAL-HISTORY-UNIT',
            'returned',
            0.33
          );
        client
          .prepare(
            'INSERT INTO sale_item_serials(id,tenant_id,sale_item_id,product_serial_id,serial_number) VALUES (?,?,?,?,?)'
          )
          .run(
            'serial-history-custody',
            tenantId,
            'serial-history-line',
            'serial-history-unit',
            'SERIAL-HISTORY-UNIT'
          );
        client
          .prepare(
            'INSERT INTO sale_returns(id,tenant_id,sale_id,subtotal,refund_amount,created_by) VALUES (?,?,?,?,?,?)'
          )
          .run('serial-history-return', tenantId, 'serial-history-sale', 1, 1, owner.id);
        client
          .prepare(
            'INSERT INTO sale_return_items(id,tenant_id,sale_return_id,sale_item_id,product_id,product_name_snapshot,product_sku_snapshot,quantity,base_quantity,unit_price,unit_equivalence,subtotal,total,cost_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
          )
          .run(
            'serial-history-return-line',
            tenantId,
            'serial-history-return',
            'serial-history-line',
            'serial-history-product',
            'Serial history',
            'SERIAL-HISTORY',
            1,
            1,
            1,
            1,
            1,
            1,
            0.33
          );
        client
          .prepare(
            'INSERT INTO sale_return_item_serials(id,tenant_id,sale_return_item_id,sale_item_serial_id,product_serial_id,serial_number) VALUES (?,?,?,?,?,?)'
          )
          .run(
            'serial-history-return-custody',
            tenantId,
            'serial-history-return-line',
            'serial-history-custody',
            'serial-history-unit',
            'SERIAL-HISTORY-UNIT'
          );
        expect(client.pragma('foreign_key_check')).toEqual([]);
        closeDatabase();

        const debitValues: AppliedInventoryValueDelta[] = [];
        const lotValues: number[] = [];
        for (const [boot, quantity] of [1.001, 2].entries()) {
          const db = await initDatabase({ dbPath, seedData: false, ...encryption });
          const product = db
            .select()
            .from(products)
            .where(and(eq(products.tenantId, tenantId), eq(products.id, 'aggregate')))
            .get()!;
          const lot = db.select().from(inventoryLots).where(eq(inventoryLots.id, 'lot')).get()!;
          if (boot === 0) {
            expect(product).toMatchObject({
              inventoryValueCents: null,
              cogsValueCents: null,
              valuationQuantity: null,
              valuationVersion: 0,
            });
            expect(lot).toMatchObject({ carryingValueCents: null, valuationQuantity: null });
          } else {
            expect(product).toMatchObject({
              inventoryValueCents: 66,
              cogsValueCents: 100,
              valuationQuantity: 2,
            });
            expect(lot).toMatchObject({ carryingValueCents: 66, valuationQuantity: 2 });
          }
          expect(
            db.select().from(saleItems).where(eq(saleItems.id, 'historical-line')).get()
          ).toMatchObject({ costAtSale: 0.5, inventoryCostCents: null, cogsCostCents: null });
          expect(
            db
              .select()
              .from(purchaseItems)
              .where(eq(purchaseItems.id, 'legacy-purchase-item'))
              .get()
          ).toMatchObject({ total: 0.99, inventoryValueCents: null, cogsValueCents: null });
          expect(
            db
              .select()
              .from(purchaseItemLots)
              .where(eq(purchaseItemLots.id, 'legacy-receipt-lot'))
              .get()!.totalCostCents
          ).toBeNull();
          expect(
            db
              .select()
              .from(purchaseReturnItems)
              .where(eq(purchaseReturnItems.id, 'legacy-return-item'))
              .get()
          ).toMatchObject({ total: 0.33, inventoryValueCents: null, cogsValueCents: null });
          expect(
            db
              .select()
              .from(purchaseReturnItemLots)
              .where(eq(purchaseReturnItemLots.id, 'legacy-return-lot'))
              .get()!.totalCostCents
          ).toBeNull();
          expect(
            db
              .select()
              .from(saleItemSerials)
              .where(eq(saleItemSerials.id, 'serial-history-custody'))
              .get()!.costCents
          ).toBeNull();
          expect(
            db
              .select()
              .from(saleReturnItemSerials)
              .where(eq(saleReturnItemSerials.id, 'serial-history-return-custody'))
              .get()!.costCents
          ).toBeNull();
          db.transaction(tx => {
            applyInventoryBalanceDelta(tx, {
              tenantId,
              siteId,
              productId: 'aggregate',
              delta: -quantity,
              onValueDelta: value => {
                if (value) debitValues.push(value);
              },
            });
            const [debit] = consumeExactInventoryLots(tx, {
              tenantId,
              siteId,
              productId: 'lot-product',
              allocations: [{ lotId: 'lot', quantity }],
              now: '2026-09-06T12:00:00.000Z',
            });
            lotValues.push(debit!.totalCost);
            applyInventoryBalanceDelta(tx, {
              tenantId,
              siteId,
              productId: 'lot-product',
              delta: -quantity,
            });
          });
          expect(db.$client.pragma('foreign_key_check')).toEqual([]);
          closeDatabase();
        }
        // Old data contains 0.99, not 1.00: adoption must never invent the missing cent.
        expect(debitValues.map(value => value.inventoryValue)).toEqual([-0.33, -0.66]);
        expect(debitValues.map(value => value.cogsValue)).toEqual([-0.5, -1]);
        expect(lotValues).toEqual([0.33, 0.66]);
        const final = await initDatabase({ dbPath, seedData: false, ...encryption });
        expect(
          final.select().from(products).where(eq(products.id, 'aggregate')).get()
        ).toMatchObject({ inventoryValueCents: 0, cogsValueCents: 0, valuationQuantity: 0 });
        expect(
          final.select().from(inventoryLots).where(eq(inventoryLots.id, 'lot')).get()
        ).toMatchObject({ onHand: 0, carryingValueCents: 0, valuationQuantity: 0 });
        if (encrypted)
          expect(readFileSync(dbPath).subarray(0, 16).toString()).not.toBe('SQLite format 3\0');
      } finally {
        closeDatabase();
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});
