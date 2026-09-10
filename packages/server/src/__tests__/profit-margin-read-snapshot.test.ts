import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { nanoid } from 'nanoid';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from '../index.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import * as schema from '../db/schema.js';
import { computeProfitMarginReport } from '../services/reports/profit-margin.js';
import { seedCommittedSaleSession } from './utils/cashSessionFixture.js';

let directory: string;
let reader: Database.Database;
let writer: Database.Database;
let db: DatabaseInstance;
let tenantId: string;
let userId: string;
let siteId: string;
let cashSessionId: string;
const at = '2026-08-20T12:00:00.000Z';
const report = () =>
  computeProfitMarginReport(db, {
    tenantId,
    fromDate: '2026-08-20T00:00:00.000Z',
    toDate: '2026-08-20T23:59:59.999Z',
    limit: 50,
  });

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'puntovivo-profit-snapshot-'));
  const dbPath = join(directory, 'report.db');
  const server = await createServer({ dbPath, verbose: false });
  try {
    const seeded = getDatabase();
    const admin = seeded
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'admin@localhost'))
      .get();
    if (!admin) throw new Error('Expected seeded administrator');
    tenantId = admin.tenantId;
    userId = admin.id;
    const site = seeded
      .select()
      .from(schema.sites)
      .where(eq(schema.sites.tenantId, tenantId))
      .get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;
    cashSessionId = await seedCommittedSaleSession({ tenantId, cashierId: userId, siteId });
  } finally {
    await server.close();
  }
  // Dedicated handles to the same migrated file: both exercise real SQLite.
  // A WAL writer must be able to commit while the report keeps its snapshot.
  reader = new Database(dbPath);
  writer = new Database(dbPath);
  for (const connection of [reader, writer]) {
    connection.pragma('foreign_keys = ON');
    connection.pragma('busy_timeout = 0');
    expect(connection.pragma('journal_mode', { simple: true })).toBe('wal');
  }
  db = drizzle(reader, { schema });
});

afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  try {
    if (reader?.open) reader.close();
  } finally {
    if (writer?.open) writer.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function seedLotSale(knownCost: boolean) {
  const saleId = nanoid();
  const productId = nanoid();
  const saleItemId = nanoid();
  const lotId = nanoid();
  db.insert(schema.products)
    .values({
      id: productId,
      tenantId,
      name: `Snapshot ${productId}`,
      sku: productId,
      price: 12,
      cost: 5,
      tracksLots: true,
    })
    .run();
  db.insert(schema.inventoryLots)
    .values({
      id: lotId,
      tenantId,
      siteId,
      productId,
      lotNumber: lotId,
      unitCost: 4.8,
    })
    .run();
  db.insert(schema.sales)
    .values({
      id: saleId,
      tenantId,
      siteId,
      saleNumber: saleId,
      cashSessionId,
      subtotal: 120,
      total: 120,
      status: 'completed',
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      createdBy: userId,
      createdAt: at,
    })
    .run();
  db.insert(schema.saleItems)
    .values({
      id: saleItemId,
      saleId,
      productId,
      quantity: 10,
      unitPrice: 12,
      total: 120,
      costAtSale: 5,
      inventoryCostCents: knownCost ? 4800 : null,
      cogsCostCents: knownCost ? 4800 : null,
    })
    .run();
  db.insert(schema.saleItemLots)
    .values({
      id: nanoid(),
      tenantId,
      saleItemId,
      lotId,
      quantity: 10,
      unitCost: 4.8,
    })
    .run();
  return { saleId, productId };
}

describe('profit report WAL read snapshot', () => {
  it.each([false, true])(
    'does not mix pre-void lines with post-void lot eligibility (known cost: %s)',
    knownCost => {
      const { saleId, productId } = seedLotSale(knownCost);
      const before = report();
      expect(before.products.find(row => row.productId === productId)).toMatchObject({
        revenue: 120,
        cogs: 48,
        grossProfit: 72,
      });
      const prepare = reader.prepare.bind(reader);
      let committed = false;
      vi.spyOn(reader, 'prepare').mockImplementation(query => {
        const statement = prepare(query);
        if (query.includes('from "sale_items"') && query.includes('order by') && !committed) {
          const all = statement.all.bind(statement);
          vi.spyOn(statement, 'all').mockImplementation((...args) => {
            // Read actual native rows first, then deterministically place a
            // competing commit between the report's first and second SELECTs.
            const rows = all(...args);
            if (!committed) {
              writer.transaction(() => {
                expect(
                  writer
                    .prepare("UPDATE sales SET status='voided' WHERE tenant_id=? AND id=?")
                    .run(tenantId, saleId).changes
                ).toBe(1);
              })();
              committed = true;
            }
            return rows;
          });
        }
        return statement;
      });
      try {
        // Without the read transaction, legacy COGS becomes 50 instead of 48;
        // known costs retain 48 but move incorrectly from lots to snapshots.
        expect(report()).toEqual(before);
        expect(committed).toBe(true);
        expect(reader.inTransaction).toBe(false);
      } finally {
        vi.restoreAllMocks();
      }
      // The next independent report observes the committed void, not a cache.
      expect(report().products.some(row => row.productId === productId)).toBe(false);
      expect(writer.prepare('SELECT status FROM sales WHERE id=?').get(saleId)).toEqual({
        status: 'voided',
      });
    }
  );

  it('releases the read snapshot when a later SELECT throws', () => {
    const { productId } = seedLotSale(false);
    const prepare = reader.prepare.bind(reader);
    const failure = new Error('Injected report read failure');
    vi.spyOn(reader, 'prepare').mockImplementation(query => {
      if (query.includes('from "sale_item_lots"')) throw failure;
      return prepare(query);
    });
    try {
      expect(() => report()).toThrow(failure);
      expect(reader.inTransaction).toBe(false);
    } finally {
      vi.restoreAllMocks();
    }
    writer.transaction(() => {
      writer.prepare('UPDATE products SET name=? WHERE id=?').run('After read rollback', productId);
    })();
    expect(report().products.find(row => row.productId === productId)?.name).toBe(
      'After read rollback'
    );
    expect(reader.inTransaction).toBe(false);
  });
});
