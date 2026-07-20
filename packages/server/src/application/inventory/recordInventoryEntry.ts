/** Record an initial inventory or physical-count entry. */
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { initialInventory, inventoryMovements, products, sites, units } from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import {
  applyInventoryBalanceDelta,
  getPrimarySiteId,
  getProductStockTotal,
} from '../../services/inventory-balances.js';
import { assertAggregateStockMutationAllowed } from '../../services/products/lot-tracking.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import type { RecordEntryInput } from '../../trpc/schemas/inventory.js';
import {
  getNormalizedInventoryQuantity,
  getProductForInventory,
  getProductUnitAssignment,
} from './helpers.js';
import type { InventoryContext } from './types.js';

export async function recordInventoryEntry(ctx: InventoryContext, input: RecordEntryInput) {
  const product = await getProductForInventory(ctx.db, ctx.tenantId, input.productId);
  const unitAssignment = await getProductUnitAssignment(ctx.db, input.productId, input.unitId);
  const normalizedQuantity = getNormalizedInventoryQuantity(
    input.quantity,
    unitAssignment.equivalence
  );
  const cost = roundMoney(input.cost);
  const now = new Date().toISOString();
  const entryId = nanoid();
  const movementId = nanoid();
  const previousStock = getProductStockTotal(ctx.db, ctx.tenantId, input.productId);
  const newStock =
    input.mode === 'initial' ? previousStock + normalizedQuantity : normalizedQuantity;
  const stockDelta = newStock - previousStock;
  assertAggregateStockMutationAllowed({
    tracksLots: product.tracksLots,
    tracksSerials: product.tracksSerials,
    catalogType: product.catalogType,
    delta: stockDelta,
  });

  ctx.db.transaction(tx => {
    tx.insert(initialInventory)
      .values({
        id: entryId,
        tenantId: ctx.tenantId,
        productId: input.productId,
        unitId: input.unitId,
        siteId: ctx.siteId,
        mode: input.mode,
        quantity: input.quantity,
        unitEquivalence: unitAssignment.equivalence,
        normalizedQuantity,
        cost,
        previousStock,
        newStock,
        notes: input.notes,
        createdBy: ctx.user.id,
        syncStatus: 'pending',
        syncVersion: 1,
        createdAt: now,
      })
      .run();

    tx.insert(inventoryMovements)
      .values({
        id: movementId,
        tenantId: ctx.tenantId,
        productId: input.productId,
        type: 'adjustment',
        quantity: Math.abs(stockDelta),
        previousStock,
        newStock,
        reference: entryId,
        notes:
          input.notes ??
          (input.mode === 'initial' ? 'Initial inventory entry' : 'Physical inventory count'),
        createdBy: ctx.user.id,
        syncStatus: 'pending',
        syncVersion: 1,
        createdAt: now,
      })
      .run();

    tx.update(products)
      .set({
        initialCost: cost,
        syncStatus: 'pending',
        syncVersion: (product.syncVersion ?? 0) + 1,
        updatedAt: now,
      })
      .where(eq(products.id, input.productId))
      .run();

    const primarySiteIdForEntry = getPrimarySiteId(tx, ctx.tenantId);
    const entrySiteId = ctx.siteId ?? primarySiteIdForEntry;
    if (entrySiteId) {
      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: entrySiteId,
        productId: input.productId,
        delta: stockDelta,
        initialOnHandIfMissing: entrySiteId === primarySiteIdForEntry ? previousStock : 0,
        now,
      });
    }
  });

  await enqueueSync(ctx, {
    entityType: 'initial_inventory',
    entityId: entryId,
    operation: 'create',
    data: {
      id: entryId,
      productId: input.productId,
      unitId: input.unitId,
      mode: input.mode,
      normalizedQuantity,
      newStock,
    },
  });

  const created = await ctx.db
    .select({
      id: initialInventory.id,
      tenantId: initialInventory.tenantId,
      productId: initialInventory.productId,
      unitId: initialInventory.unitId,
      siteId: initialInventory.siteId,
      mode: initialInventory.mode,
      quantity: initialInventory.quantity,
      unitEquivalence: initialInventory.unitEquivalence,
      normalizedQuantity: initialInventory.normalizedQuantity,
      cost: initialInventory.cost,
      previousStock: initialInventory.previousStock,
      newStock: initialInventory.newStock,
      notes: initialInventory.notes,
      createdBy: initialInventory.createdBy,
      syncStatus: initialInventory.syncStatus,
      syncVersion: initialInventory.syncVersion,
      createdAt: initialInventory.createdAt,
      productName: products.name,
      productSku: products.sku,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      siteName: sites.name,
    })
    .from(initialInventory)
    .innerJoin(products, eq(initialInventory.productId, products.id))
    .innerJoin(units, eq(initialInventory.unitId, units.id))
    .leftJoin(sites, eq(initialInventory.siteId, sites.id))
    .where(eq(initialInventory.id, entryId))
    .get();

  return created!;
}
