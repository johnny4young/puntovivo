/** Record an initial inventory or physical-count entry. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  initialInventory,
  inventoryBalances,
  inventoryMovements,
  products,
  sites,
  unitXProduct,
  units,
} from '../../db/schema.js';
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
  // Fast tenant-scoped preflight for useful errors. Product policy, unit,
  // site and balances are deliberately resolved again under the SQLite writer
  // reservation below so a physical count cannot apply a tenant-wide delta to
  // a different site's stock or race another inventory writer.
  await getProductForInventory(ctx.db, ctx.tenantId, input.productId);
  await getProductUnitAssignment(ctx.db, input.productId, input.unitId);
  const cost = roundMoney(input.cost);
  const now = new Date().toISOString();
  const entryId = nanoid();
  const movementId = nanoid();
  let normalizedQuantity = 0;
  let previousStock = 0;
  let newStock = 0;
  let stockDelta = 0;

  ctx.db.transaction(
    tx => {
      const product = tx
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.tenantId, ctx.tenantId),
            eq(products.isActive, true)
          )
        )
        .get();
      if (!product) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found or inactive' });
      }

      const resolvedAssignment = tx
        .select({
          equivalence: unitXProduct.equivalence,
          isActive: units.isActive,
        })
        .from(unitXProduct)
        .innerJoin(units, eq(unitXProduct.unitId, units.id))
        .where(
          and(eq(unitXProduct.productId, input.productId), eq(unitXProduct.unitId, input.unitId))
        )
        .get();
      if (!resolvedAssignment || resolvedAssignment.isActive === false) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Selected product unit was not found or is inactive',
        });
      }
      normalizedQuantity = getNormalizedInventoryQuantity(
        input.quantity,
        resolvedAssignment.equivalence
      );

      const primarySiteIdForEntry = getPrimarySiteId(tx, ctx.tenantId);
      const entrySiteId = ctx.siteId ?? primarySiteIdForEntry;
      if (!entrySiteId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'An active site is required to record inventory',
        });
      }
      const entrySite = tx
        .select({ id: sites.id, isActive: sites.isActive })
        .from(sites)
        .where(and(eq(sites.id, entrySiteId), eq(sites.tenantId, ctx.tenantId)))
        .get();
      if (!entrySite || entrySite.isActive === false) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Selected inventory site was not found or is inactive',
        });
      }

      previousStock = getProductStockTotal(tx, ctx.tenantId, input.productId);
      const currentSiteBalance = tx
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, ctx.tenantId),
            eq(inventoryBalances.siteId, entrySiteId),
            eq(inventoryBalances.productId, input.productId)
          )
        )
        .get();
      const currentSiteStock =
        currentSiteBalance?.onHand ?? (entrySiteId === primarySiteIdForEntry ? previousStock : 0);
      stockDelta =
        input.mode === 'initial' ? normalizedQuantity : normalizedQuantity - currentSiteStock;
      newStock = previousStock + stockDelta;

      assertAggregateStockMutationAllowed({
        tracksLots: product.tracksLots,
        tracksSerials: product.tracksSerials,
        catalogType: product.catalogType,
        delta: stockDelta,
      });

      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: entrySiteId,
        productId: input.productId,
        delta: stockDelta,
        initialOnHandIfMissing: currentSiteStock,
        now,
      });

      tx.insert(initialInventory)
        .values({
          id: entryId,
          tenantId: ctx.tenantId,
          productId: input.productId,
          unitId: input.unitId,
          siteId: entrySiteId,
          mode: input.mode,
          quantity: input.quantity,
          unitEquivalence: resolvedAssignment.equivalence,
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
          siteId: entrySiteId,
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
        .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
        .run();
    },
    { behavior: 'immediate' }
  );

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
    .where(and(eq(initialInventory.id, entryId), eq(initialInventory.tenantId, ctx.tenantId)))
    .get();

  return created!;
}
