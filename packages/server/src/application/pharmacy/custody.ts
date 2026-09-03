import { roundQuantity } from '@puntovivo/shared/unit-math';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  inventoryBalances,
  inventoryLots,
  inventoryMovements,
  pharmacyProductProfiles,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  applyInventoryBalanceDelta,
  getProductStockTotal,
} from '../../services/inventory-balances.js';
import { consumeExactInventoryLots } from '../../services/inventory-lots/index.js';
import {
  assertTenantBusinessClockCurrent,
  resolveTenantBusinessClock,
} from '../../services/pharmacy/business-clock.js';
import { writeInventoryLotEvent } from '../../services/pharmacy/lot-events.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type { DestroyPharmacyLotInput } from '../../trpc/schemas/pharmacy.js';
import { pharmacySyncContext, type CriticalPharmacyContext } from './types.js';

/** Destroy an exact medicine quantity while stock, lot and ledgers commit together. */
export async function destroyPharmacyLot(
  ctx: CriticalPharmacyContext,
  input: DestroyPharmacyLotInput
) {
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  const movementId = nanoid();

  return ctx.db.transaction(
    tx => {
      assertTenantBusinessClockCurrent(tx, ctx.tenantId, clock);
      const lot = tx
        .select({
          id: inventoryLots.id,
          siteId: inventoryLots.siteId,
          productId: inventoryLots.productId,
          onHand: inventoryLots.onHand,
        })
        .from(inventoryLots)
        .innerJoin(
          pharmacyProductProfiles,
          and(
            eq(pharmacyProductProfiles.productId, inventoryLots.productId),
            eq(pharmacyProductProfiles.tenantId, ctx.tenantId)
          )
        )
        .where(and(eq(inventoryLots.id, input.lotId), eq(inventoryLots.tenantId, ctx.tenantId)))
        .get();
      if (!lot) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'LOT_NOT_FOUND',
          message: 'Pharmacy lot not found',
        });
      }

      const balance = tx
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, ctx.tenantId),
            eq(inventoryBalances.siteId, lot.siteId),
            eq(inventoryBalances.productId, lot.productId)
          )
        )
        .get();
      if (
        !balance ||
        !Number.isFinite(balance.onHand) ||
        balance.onHand + QUANTITY_EPSILON < input.quantity
      ) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'LOT_STOCK_INCONSISTENT',
          message: 'The site balance cannot reconcile this lot destruction',
          details: {
            lotId: lot.id,
            siteBalance: balance?.onHand ?? null,
            requested: input.quantity,
          },
        });
      }

      const previousStock = getProductStockTotal(tx, ctx.tenantId, lot.productId);
      if (!Number.isFinite(previousStock) || previousStock + QUANTITY_EPSILON < input.quantity) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'LOT_STOCK_INCONSISTENT',
          message: 'Tenant stock cannot reconcile this lot destruction',
          details: { lotId: lot.id, tenantStock: previousStock, requested: input.quantity },
        });
      }
      const [consumed] = consumeExactInventoryLots(tx, {
        tenantId: ctx.tenantId,
        siteId: lot.siteId,
        productId: lot.productId,
        allocations: [{ lotId: lot.id, quantity: input.quantity }],
        now: clock.nowIso,
        businessDate: clock.businessDate,
      });
      if (!consumed) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'LOT_STOCK_INCONSISTENT',
          message: 'The lot destruction did not produce an exact allocation',
        });
      }
      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: lot.siteId,
        productId: lot.productId,
        delta: -input.quantity,
        initialOnHandIfMissing: balance.onHand,
        now: clock.nowIso,
      });
      const newStock = roundQuantity(previousStock - input.quantity, 12);
      const derivedStock = getProductStockTotal(tx, ctx.tenantId, lot.productId);
      if (Math.abs(derivedStock - newStock) > QUANTITY_EPSILON) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'LOT_STOCK_INCONSISTENT',
          message: 'Lot destruction did not reconcile the tenant stock rollup',
          details: { lotId: lot.id, expected: newStock, actual: derivedStock },
        });
      }

      tx.insert(inventoryMovements)
        .values({
          id: movementId,
          tenantId: ctx.tenantId,
          productId: lot.productId,
          siteId: lot.siteId,
          type: 'adjustment',
          quantity: input.quantity,
          previousStock,
          newStock,
          reference: `pharmacy-destruction:${lot.id}`,
          notes: input.reason,
          createdBy: ctx.user.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: clock.nowIso,
        })
        .run();

      writeInventoryLotEvent(tx, pharmacySyncContext(ctx, tx), {
        tenantId: ctx.tenantId,
        siteId: lot.siteId,
        productId: lot.productId,
        lotId: lot.id,
        eventType: 'destruction',
        previousStatus: consumed.sourceStatus,
        nextStatus: consumed.status,
        quantitySnapshot: consumed.newOnHand,
        reason: input.reason,
        referenceType: 'inventory_movement',
        referenceId: movementId,
        actorId: ctx.user.id,
        occurredAt: clock.nowIso,
      });
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'pharmacy.lot.destroy',
        resourceType: 'inventory_lot',
        resourceId: lot.id,
        before: { onHand: consumed.previousOnHand, status: consumed.sourceStatus },
        after: { onHand: consumed.newOnHand, status: consumed.status },
        metadata: { movementId, quantity: input.quantity, reason: input.reason },
        operationId: ctx.envelope.operationId,
      });

      const sync = pharmacySyncContext(ctx, tx);
      enqueueSyncInTransaction(sync, {
        entityType: 'inventory_lots',
        entityId: lot.id,
        operation: 'update',
        data: { id: lot.id, onHand: consumed.newOnHand, status: consumed.status },
      });
      enqueueSyncInTransaction(sync, {
        entityType: 'inventory_movements',
        entityId: movementId,
        operation: 'create',
        data: {
          id: movementId,
          productId: lot.productId,
          siteId: lot.siteId,
          quantity: input.quantity,
          reference: 'pharmacy-destruction',
        },
      });

      const result = {
        lotId: lot.id,
        movementId,
        destroyedQuantity: input.quantity,
        onHand: consumed.newOnHand,
        status: consumed.status,
      };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}
