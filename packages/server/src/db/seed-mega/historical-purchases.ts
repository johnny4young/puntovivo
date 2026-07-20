/**
 * MEGA seed: historical purchases + supplier returns.
 *
 * Bulk-inserts purchases distributed across the historical window.
 * 3% of purchases get a `purchase_returns` row with at least one
 * line. Inventory movements (`type='purchase'`) accompany each
 * purchase so the stock ledger has a real receipt history.
 *
 * @module db/seed-mega/historical-purchases
 */

import { nanoid } from 'nanoid';
import {
  inventoryMovements,
  purchaseItems,
  purchaseReturnItems,
  purchaseReturns,
  purchases,
} from '../schema.js';
import { laterIso, randomDaysAgoIso } from './time-helpers.js';
import type { MegaContext, MegaTarget } from './types.js';

interface CreatedHistoricalPurchases {
  purchasesCount: number;
  returnsCount: number;
  inventoryMovementsCount: number;
}

export async function seedHistoricalPurchases(
  ctx: MegaContext,
  target: MegaTarget
): Promise<CreatedHistoricalPurchases> {
  const { db, clock, tenantId, sites, products, providerIds, adminUserId } = ctx;
  const totalPurchases = Math.round(
    (target.historicalDays / 7) * sites.length * target.purchasesPerSitePerWeek
  );

  const purchaseRows: Array<typeof purchases.$inferInsert> = [];
  const purchaseItemRows: Array<typeof purchaseItems.$inferInsert> = [];
  const movementRows: Array<typeof inventoryMovements.$inferInsert> = [];
  const returnRows: Array<typeof purchaseReturns.$inferInsert> = [];
  const returnItemRows: Array<typeof purchaseReturnItems.$inferInsert> = [];

  let returnsCount = 0;

  for (let i = 0; i < totalPurchases; i += 1) {
    const purchaseId = nanoid();
    const site = sites[i % sites.length]!;
    const providerId = providerIds[i % providerIds.length] ?? providerIds[0];
    if (!providerId) continue;

    const itemsCount = 2 + (i % 3);
    let subtotal = 0;
    const builtItems: Array<{
      id: string;
      productId: string;
      quantity: number;
      cost: number;
      total: number;
      baseUnitId: string;
    }> = [];
    for (let li = 0; li < itemsCount; li += 1) {
      const product = products[(i * 7 + li * 3) % products.length]!;
      const quantity = 5 + (i % 15);
      const cost = product.cost;
      const total = cost * quantity;
      subtotal += total;
      builtItems.push({
        id: nanoid(),
        productId: product.id,
        quantity,
        cost,
        total,
        baseUnitId: product.baseUnitId,
      });
    }
    const total = subtotal;
    const purchasedAtIso = randomDaysAgoIso(clock, 1, target.historicalDays - 1, i);

    purchaseRows.push({
      id: purchaseId,
      tenantId,
      purchaseNumber: `COMP-${String(i + 1).padStart(5, '0')}`,
      providerId,
      siteId: site.id,
      status: 'completed',
      subtotal,
      total,
      notes: 'Compra histórica seed mega',
      createdBy: adminUserId,
      createdAt: purchasedAtIso,
      updatedAt: purchasedAtIso,
    });

    builtItems.forEach(item => {
      purchaseItemRows.push({
        id: item.id,
        purchaseId,
        productId: item.productId,
        quantity: item.quantity,
        unitId: item.baseUnitId,
        unitEquivalence: 1,
        costPerUnit: item.cost,
        baseUnitCost: item.cost,
        total: item.total,
      });
      movementRows.push({
        id: nanoid(),
        tenantId,
        productId: item.productId,
        type: 'purchase',
        quantity: item.quantity,
        previousStock: 0,
        newStock: item.quantity,
        reference: `COMP-${String(i + 1).padStart(5, '0')}`,
        notes: 'Recepción de compra seed mega',
        createdBy: adminUserId,
        createdAt: purchasedAtIso,
      });
    });

    // 3% of purchases get a return
    if (i % 33 === 0) {
      const returnId = nanoid();
      const returnedAtIso = laterIso(purchasedAtIso, 5 * 24 * 60 * 60 * 1000);
      const returnedItem = builtItems[0]!;
      const returnedQty = Math.max(1, Math.floor(returnedItem.quantity / 4));
      const returnAmount = returnedItem.cost * returnedQty;
      returnRows.push({
        id: returnId,
        tenantId,
        purchaseId,
        returnAmount,
        reason: 'Producto defectuoso devuelto al proveedor',
        createdBy: adminUserId,
        createdAt: returnedAtIso,
        updatedAt: returnedAtIso,
      });
      returnItemRows.push({
        id: nanoid(),
        purchaseReturnId: returnId,
        purchaseItemId: returnedItem.id,
        productId: returnedItem.productId,
        quantity: returnedQty,
        unitId: returnedItem.baseUnitId,
        unitEquivalence: 1,
        costPerUnit: returnedItem.cost,
        baseUnitCost: returnedItem.cost,
        total: returnAmount,
      });
      movementRows.push({
        id: nanoid(),
        tenantId,
        productId: returnedItem.productId,
        type: 'adjustment',
        quantity: -returnedQty,
        previousStock: returnedItem.quantity,
        newStock: returnedItem.quantity - returnedQty,
        reference: `DEV-COMP-${String(i + 1).padStart(5, '0')}`,
        notes: 'Devolución a proveedor seed mega',
        createdBy: adminUserId,
        createdAt: returnedAtIso,
      });
      returnsCount += 1;
    }
  }

  await chunkedInsert(db, purchases, purchaseRows);
  await chunkedInsert(db, purchaseItems, purchaseItemRows);
  await chunkedInsert(db, inventoryMovements, movementRows);
  await chunkedInsert(db, purchaseReturns, returnRows);
  await chunkedInsert(db, purchaseReturnItems, returnItemRows);

  return {
    purchasesCount: purchaseRows.length,
    returnsCount,
    inventoryMovementsCount: movementRows.length,
  };
}

async function chunkedInsert<T extends Record<string, unknown>>(
  db: MegaContext['db'],
  table: Parameters<typeof db.insert>[0],
  rows: T[]
): Promise<void> {
  if (rows.length === 0) return;
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason: seed bulk-insert into a parametric Drizzle table (Parameters<typeof db.insert>[0]); the generic-table builder rejects the typed ref. Seed-only, exempt per .
    await (db.insert(table) as any).values(chunk).run();
  }
}
