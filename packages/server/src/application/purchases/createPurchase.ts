/**
 * Create a completed purchase (immediate stock-in).
 *
 * extracted from the former monolithic `trpc/routers/purchases.ts`
 * during the megafile decomposition. The transaction body (sequential
 * advance, purchase + line inserts, per-item stock / balance / movement
 * writes) is relocated verbatim; the tRPC procedure now adapts its context
 * and calls this use-case.
 *
 * @module application/purchases/createPurchase
 */
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { inventoryMovements, products, purchaseItems, purchases } from '../../db/schema.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import {
  applyInventoryBalanceDelta,
  ensurePrimaryInventoryBalanceSnapshot,
  getProductStockTotals,
} from '../../services/inventory-balances.js';
import { receiveProductSerialUnits } from '../../services/product-serials.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { allocateNextSequential } from '../../services/sequential-allocation.js';
import type { CreatePurchaseInput } from '../../trpc/schemas/purchases.js';
import {
  getInventoryBalanceStateForSite,
  getPurchaseSequentialContext,
  getPurchaseSiteContext,
  validateProvider,
} from './helpers.js';
import { getPurchaseRecord } from './purchase-read.js';
import { resolvePurchaseItems } from './resolveItems.js';
import type { CriticalPurchaseContext } from './types.js';

export async function createPurchase(ctx: CriticalPurchaseContext, input: CreatePurchaseInput) {
  await validateProvider(ctx.db, ctx.tenantId, input.providerId);

  const now = new Date().toISOString();
  const purchaseId = nanoid();
  const sequentialContext = await getPurchaseSequentialContext(ctx.db, ctx.tenantId, ctx.siteId);
  const purchaseSite = await getPurchaseSiteContext(
    ctx.db,
    ctx.tenantId,
    ctx.siteId,
    sequentialContext.siteId
  );
  const resolvedItems = await resolvePurchaseItems(ctx.db, ctx.tenantId, input.items);
  const subtotal = resolvedItems.subtotal;
  const total = subtotal;
  const baseUnitsReceived = resolvedItems.rows.reduce(
    (sum, row) => sum + row.normalizedQuantity,
    0
  );
  const productIds = [...new Set(resolvedItems.rows.map(row => row.productId))];
  return ctx.db.transaction(
    tx => {
      // Stock snapshots belong to the same writer reservation as the deltas.
      // Resolving them before BEGIN IMMEDIATE lets a concurrent stock writer
      // commit between the snapshot and movement insert, corrupting the
      // previousStock/newStock audit chain even though the balance delta wins.
      const productStockState = getProductStockTotals(tx, ctx.tenantId, productIds);
      const siteBalanceState = getInventoryBalanceStateForSite(
        tx as unknown as typeof ctx.db,
        ctx.tenantId,
        purchaseSite.id,
        productIds
      );

      const purchaseNumber = allocateNextSequential(tx as unknown as typeof ctx.db, {
        tenantId: ctx.tenantId,
        sequentialId: sequentialContext.id,
        updatedAt: now,
      }).number;

      tx.insert(purchases)
        .values({
          id: purchaseId,
          tenantId: ctx.tenantId,
          purchaseNumber,
          providerId: input.providerId,
          orderId: null,
          siteId: purchaseSite.id,
          status: 'completed',
          subtotal,
          total,
          notes: input.notes,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      for (const row of resolvedItems.rows) {
        tx.insert(purchaseItems)
          .values({
            id: row.id,
            purchaseId,
            productId: row.productId,
            quantity: row.quantity,
            unitId: row.unitId,
            unitEquivalence: row.unitEquivalence,
            costPerUnit: row.costPerUnit,
            baseUnitCost: row.baseUnitCost,
            total: row.total,
          })
          .run();

        if (row.tracksSerials) {
          receiveProductSerialUnits(tx as unknown as typeof ctx.db, {
            tenantId: ctx.tenantId,
            siteId: purchaseSite.id,
            productId: row.productId,
            serialNumbers: row.serialNumbers,
            unitCost: row.baseUnitCost,
            warrantyExpiresAt: null,
            notes: `Purchase ${purchaseNumber}`,
            sourcePurchaseItemId: row.id,
            now,
            syncContext: { ...ctx, db: tx as unknown as typeof ctx.db },
          });
        }

        const previousStock = productStockState.get(row.productId) ?? 0;
        const newStock = previousStock + row.normalizedQuantity;
        const previousSiteBalance = siteBalanceState.get(row.productId) ?? 0;
        const newSiteBalance = previousSiteBalance + row.normalizedQuantity;
        productStockState.set(row.productId, newStock);
        siteBalanceState.set(row.productId, newSiteBalance);

        ensurePrimaryInventoryBalanceSnapshot(tx, {
          tenantId: ctx.tenantId,
          productId: row.productId,
          onHandSnapshot: previousStock,
          now,
        });

        // Stock is no longer a product column — it is applied to
        // inventory_balances below. Persist only the cost baseline here.
        tx.update(products)
          .set({
            cost: row.baseUnitCost,
            initialCost: row.baseUnitCost,
            syncStatus: 'pending',
            syncVersion: sql`${products.syncVersion} + 1`,
            updatedAt: now,
          })
          .where(and(eq(products.id, row.productId), eq(products.tenantId, ctx.tenantId)))
          .run();

        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: purchaseSite.id,
          productId: row.productId,
          delta: row.normalizedQuantity,
          initialOnHandIfMissing: previousSiteBalance,
          serialAware: row.tracksSerials,
          now,
        });

        tx.insert(inventoryMovements)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            productId: row.productId,
            siteId: purchaseSite.id,
            type: 'purchase',
            quantity: row.normalizedQuantity,
            previousStock,
            newStock,
            reference: purchaseId,
            notes: `Purchase ${purchaseNumber} · ${purchaseSite.name}`,
            createdBy: ctx.user!.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
      }

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'purchase.receive',
        resourceType: 'purchase',
        resourceId: purchaseId,
        before: null,
        after: {
          status: 'completed',
          purchaseNumber,
          total,
          lineCount: resolvedItems.rows.length,
          baseUnitsReceived,
        },
        metadata: {
          providerId: input.providerId,
          siteId: purchaseSite.id,
          siteName: purchaseSite.name,
          source: 'direct',
        },
        operationId: ctx.envelope.operationId,
      });

      enqueueSyncInTransaction(
        { ...ctx, db: tx as unknown as typeof ctx.db },
        {
          entityType: 'purchases',
          entityId: purchaseId,
          operation: 'create',
          data: {
            id: purchaseId,
            purchaseNumber,
            providerId: input.providerId,
            total,
            siteId: purchaseSite.id,
          },
        }
      );

      const result = getPurchaseRecord(tx as unknown as typeof ctx.db, ctx.tenantId, purchaseId);
      ctx.completeInTransaction(tx as unknown as typeof ctx.db, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}
