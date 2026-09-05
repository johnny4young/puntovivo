/**
 * Receive a purchase against an existing order (full or partial receipt).
 *
 * extracted from the former monolithic `trpc/routers/purchases.ts`
 * during the megafile decomposition. The order lookup + status guards + the
 * receive transaction (stock-in per line + order status transition) relocate
 * verbatim; the tRPC procedure adapts its context and calls this use-case.
 *
 * @module application/purchases/receiveFromOrder
 */
import { TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  inventoryMovements,
  orders,
  products,
  providers,
  purchaseItems,
  purchases,
  sites,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import {
  applyInventoryBalanceDelta,
  ensurePrimaryInventoryBalanceSnapshot,
  getProductStockTotals,
} from '../../services/inventory-balances.js';
import { receiveProductSerialUnits } from '../../services/product-serials.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { allocateNextSequential } from '../../services/sequential-allocation.js';
import type { CreatePurchaseFromOrderInput } from '../../trpc/schemas/purchases.js';
import { getInventoryBalanceStateForSite, getPurchaseSequentialContext } from './helpers.js';
import { getPurchaseRecord } from './purchase-read.js';
import { resolveOrderReceiptItems } from './resolveItems.js';
import type { CriticalPurchaseContext } from './types.js';

export async function createPurchaseFromOrder(
  ctx: CriticalPurchaseContext,
  input: CreatePurchaseFromOrderInput
) {
  const orderRecord = await ctx.db
    .select({
      id: orders.id,
      providerId: orders.providerId,
      providerName: providers.name,
      siteId: orders.siteId,
      siteName: sites.name,
      orderNumber: orders.orderNumber,
      notes: orders.notes,
      status: orders.status,
      syncVersion: orders.syncVersion,
    })
    .from(orders)
    .innerJoin(providers, eq(orders.providerId, providers.id))
    .innerJoin(sites, eq(orders.siteId, sites.id))
    .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, ctx.tenantId)))
    .get();

  if (!orderRecord) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
  }

  if (orderRecord.status === 'draft') {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'ORDER_DRAFT_INVALID_STATUS',
      message: 'A purchase-order draft must be submitted before stock can be received',
      details: { status: orderRecord.status },
    });
  }

  if (orderRecord.status === 'voided') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Voided orders cannot be received',
    });
  }

  if (orderRecord.status === 'received') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Order has already been fully received',
    });
  }

  const now = new Date().toISOString();
  const purchaseId = nanoid();
  const sequentialContext = await getPurchaseSequentialContext(
    ctx.db,
    ctx.tenantId,
    orderRecord.siteId
  );
  const resolvedItems = await resolveOrderReceiptItems(
    ctx.db,
    ctx.tenantId,
    input.orderId,
    input.items
  );
  const subtotal = resolvedItems.subtotal;
  const total = subtotal;
  const baseUnitsReceived = resolvedItems.rows.reduce(
    (sum, row) => sum + row.normalizedQuantity,
    0
  );
  const productIds = [...new Set(resolvedItems.rows.map(row => row.productId))];
  const nextOrderSyncVersion = (orderRecord.syncVersion ?? 0) + 1;
  const nextOrderStatus =
    resolvedItems.totalFullyReceivedItems === resolvedItems.totalItemCount
      ? 'received'
      : 'partial_received';

  return ctx.db.transaction(
    tx => {
      // Claim the exact order snapshot before any inventory or purchase write.
      // Remaining quantities were resolved above for fast validation; this
      // versioned transition is the authoritative TOCTOU guard so two receivers
      // cannot both credit stock from the same pending quantity.
      const claimedOrder = tx
        .update(orders)
        .set({
          status: nextOrderStatus,
          updatedAt: now,
          syncStatus: 'pending',
          syncVersion: nextOrderSyncVersion,
        })
        .where(
          and(
            eq(orders.id, input.orderId),
            eq(orders.tenantId, ctx.tenantId),
            eq(orders.status, orderRecord.status),
            orderRecord.syncVersion === null
              ? isNull(orders.syncVersion)
              : eq(orders.syncVersion, orderRecord.syncVersion)
          )
        )
        .run();
      if (claimedOrder.changes !== 1) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Order changed while this receipt was being recorded',
        });
      }

      // Resolve movement snapshots only after claiming the SQLite writer.
      // Other sales or receipts may have moved stock since input resolution.
      const productStockState = getProductStockTotals(tx, ctx.tenantId, productIds);
      const siteBalanceState = getInventoryBalanceStateForSite(
        tx as unknown as typeof ctx.db,
        ctx.tenantId,
        orderRecord.siteId,
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
          providerId: orderRecord.providerId,
          orderId: input.orderId,
          siteId: orderRecord.siteId,
          status: 'completed',
          subtotal,
          total,
          notes: `${orderRecord.notes ? `${orderRecord.notes} | ` : ''}${input.notes ? `${input.notes} | ` : ''}Received from order ${orderRecord.orderNumber}`,
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
            sourceOrderItemId: row.sourceOrderItemId,
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
            siteId: orderRecord.siteId,
            productId: row.productId,
            serialNumbers: row.serialNumbers,
            unitCost: row.baseUnitCost,
            warrantyExpiresAt: null,
            notes: `Purchase ${purchaseNumber} · order ${orderRecord.orderNumber}`,
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
          siteId: orderRecord.siteId,
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
            siteId: orderRecord.siteId,
            type: 'purchase',
            quantity: row.normalizedQuantity,
            previousStock,
            newStock,
            reference: purchaseId,
            notes: `Purchase ${purchaseNumber} · received from order ${orderRecord.orderNumber}`,
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
          providerId: orderRecord.providerId,
          siteId: orderRecord.siteId,
          siteName: orderRecord.siteName,
          source: 'order',
          orderId: input.orderId,
          orderNumber: orderRecord.orderNumber,
        },
        operationId: ctx.envelope.operationId,
      });

      const syncContext = { ...ctx, db: tx as unknown as typeof ctx.db };
      enqueueSyncInTransaction(syncContext, {
        entityType: 'purchases',
        entityId: purchaseId,
        operation: 'create',
        data: {
          id: purchaseId,
          purchaseNumber,
          providerId: orderRecord.providerId,
          orderId: input.orderId,
          total,
          siteId: orderRecord.siteId,
        },
      });
      enqueueSyncInTransaction(syncContext, {
        entityType: 'orders',
        entityId: input.orderId,
        operation: 'update',
        data: {
          id: input.orderId,
          status: nextOrderStatus,
          receivedPurchaseId: purchaseId,
        },
      });

      const result = getPurchaseRecord(tx as unknown as typeof ctx.db, ctx.tenantId, purchaseId);
      ctx.completeInTransaction(tx as unknown as typeof ctx.db, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}
