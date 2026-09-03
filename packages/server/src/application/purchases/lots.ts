/** Lot-aware purchase receipt and supplier-return helpers. */

import { roundQuantity } from '@puntovivo/shared/unit-math';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  pharmacyProductProfiles,
  purchaseItemLots,
  purchaseReturnItemLots,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
import {
  consumeExactInventoryLots,
  receiveInventoryLot,
} from '../../services/inventory-lots/index.js';
import { writeInventoryLotEvent } from '../../services/pharmacy/lot-events.js';
import {
  applyRecallCustodyOverlays,
  findActiveRecallOverlaysForLot,
} from '../../services/pharmacy/transfer-custody.js';
import type { EnqueueSyncContext } from '../../services/sync/enqueue.js';
import type { ResolvedPurchaseItem, ResolvedPurchaseReturnItem } from './types.js';

type PurchaseLotSyncContext = Omit<EnqueueSyncContext, 'db'>;

function isPharmacyProduct(db: DatabaseInstance, tenantId: string, productId: string): boolean {
  return Boolean(
    db
      .select({ productId: pharmacyProductProfiles.productId })
      .from(pharmacyProductProfiles)
      .where(
        and(
          eq(pharmacyProductProfiles.tenantId, tenantId),
          eq(pharmacyProductProfiles.productId, productId)
        )
      )
      .get()
  );
}

export function receivePurchaseItemLots(
  tx: DatabaseInstance,
  input: {
    tenantId: string;
    siteId: string;
    purchaseItemId: string;
    productId: string;
    lotReceipts: ResolvedPurchaseItem['lotReceipts'];
    baseUnitCost: number;
    purchaseNumber: string;
    now: string;
    businessDate: string;
    providerId: string;
    actorId: string;
    syncContext: PurchaseLotSyncContext;
  }
): string[] {
  const lotIds: string[] = [];
  const pharmacyProduct = isPharmacyProduct(tx, input.tenantId, input.productId);
  for (const receipt of input.lotReceipts) {
    let lot = receiveInventoryLot(tx, {
      tenantId: input.tenantId,
      siteId: input.siteId,
      productId: input.productId,
      lotNumber: receipt.lotNumber,
      expiresAt: receipt.expiresAt,
      quantity: receipt.baseQuantity,
      unitCost: input.baseUnitCost,
      notes: receipt.notes ?? input.purchaseNumber,
      now: input.now,
      businessDate: input.businessDate,
    });
    tx.insert(purchaseItemLots)
      .values({
        id: nanoid(),
        tenantId: input.tenantId,
        purchaseItemId: input.purchaseItemId,
        inventoryLotId: lot.lotId,
        lotNumberSnapshot: receipt.lotNumber,
        expiresAtSnapshot: lot.expiresAt,
        baseQuantity: receipt.baseQuantity,
        unitCost: input.baseUnitCost,
        createdAt: input.now,
      })
      .run();
    if (pharmacyProduct) {
      writeInventoryLotEvent(tx, input.syncContext, {
        tenantId: input.tenantId,
        siteId: input.siteId,
        productId: input.productId,
        lotId: lot.lotId,
        eventType: 'activation',
        previousStatus: lot.previousStatus,
        nextStatus: lot.status,
        quantitySnapshot: lot.onHand,
        reason: receipt.notes ?? `Purchase ${input.purchaseNumber}`,
        referenceType: 'purchase_item',
        referenceId: input.purchaseItemId,
        actorId: input.actorId,
        occurredAt: input.now,
      });
      const recallOverlays = findActiveRecallOverlaysForLot(tx, {
        tenantId: input.tenantId,
        lotId: lot.lotId,
        providerId: input.providerId,
      });
      if (recallOverlays.length > 0) {
        lot = {
          ...lot,
          status: applyRecallCustodyOverlays(tx, input.syncContext, {
            tenantId: input.tenantId,
            destinationLotId: lot.lotId,
            recallOverlays,
            actorId: input.actorId,
            occurredAt: input.now,
          }),
        };
      }
    }
    lotIds.push(lot.lotId);
  }
  return lotIds;
}

export function returnPurchaseItemLots(
  tx: DatabaseInstance,
  input: {
    tenantId: string;
    siteId: string;
    purchaseReturnItemId: string;
    productId: string;
    allocations: ResolvedPurchaseReturnItem['lotAllocations'];
    now: string;
    businessDate: string;
    actorId: string;
    syncContext: PurchaseLotSyncContext;
  }
): string[] {
  const consumed = consumeExactInventoryLots(tx, {
    tenantId: input.tenantId,
    siteId: input.siteId,
    productId: input.productId,
    allocations: input.allocations.map(allocation => ({
      lotId: allocation.inventoryLotId,
      quantity: allocation.baseQuantity,
    })),
    now: input.now,
    businessDate: input.businessDate,
  });
  const pharmacyProduct = isPharmacyProduct(tx, input.tenantId, input.productId);
  const consumedById = new Map(consumed.map(row => [row.lotId, row]));
  for (const allocation of input.allocations) {
    const consumedLot = consumedById.get(allocation.inventoryLotId);
    if (
      !consumedLot ||
      consumedLot.lotNumber !== allocation.lotNumberSnapshot ||
      consumedLot.expiresAt !== allocation.expiresAtSnapshot ||
      roundMoney(consumedLot.unitCost) !== roundMoney(allocation.unitCost)
    ) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'LOT_STOCK_INCONSISTENT',
        message: 'A returned purchase lot no longer matches its frozen receipt identity or cost',
        details: { inventoryLotId: allocation.inventoryLotId },
      });
    }
    tx.insert(purchaseReturnItemLots)
      .values({
        id: nanoid(),
        tenantId: input.tenantId,
        purchaseReturnItemId: input.purchaseReturnItemId,
        purchaseItemLotId: allocation.purchaseItemLotId,
        inventoryLotId: allocation.inventoryLotId,
        baseQuantity: allocation.baseQuantity,
        unitCost: allocation.unitCost,
        createdAt: input.now,
      })
      .run();
    if (pharmacyProduct) {
      writeInventoryLotEvent(tx, input.syncContext, {
        tenantId: input.tenantId,
        siteId: input.siteId,
        productId: input.productId,
        lotId: consumedLot.lotId,
        eventType: 'supplier_return',
        previousStatus: consumedLot.sourceStatus,
        nextStatus: consumedLot.status,
        quantitySnapshot: consumedLot.newOnHand,
        reason: 'Purchase return to supplier',
        referenceType: 'purchase_return_item',
        referenceId: input.purchaseReturnItemId,
        actorId: input.actorId,
        occurredAt: input.now,
      });
    }
  }
  return consumed.map(row => row.lotId);
}

/** Read and debit the entire frozen lot provenance of a voidable purchase line. */
export function voidPurchaseItemLots(
  tx: DatabaseInstance,
  input: {
    tenantId: string;
    siteId: string;
    purchaseItemId: string;
    productId: string;
    expectedBaseQuantity: number;
    now: string;
    businessDate: string;
    actorId: string;
    syncContext: PurchaseLotSyncContext;
  }
): string[] {
  const rows = tx
    .select()
    .from(purchaseItemLots)
    .where(
      and(
        eq(purchaseItemLots.tenantId, input.tenantId),
        eq(purchaseItemLots.purchaseItemId, input.purchaseItemId)
      )
    )
    .all();
  const allocated = rows.reduce((sum, row) => roundQuantity(sum + row.baseQuantity, 12), 0);
  if (rows.length === 0 || Math.abs(allocated - input.expectedBaseQuantity) > QUANTITY_EPSILON) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_STOCK_INCONSISTENT',
      message: 'Purchase lot provenance does not reconcile to the line being voided',
      details: {
        purchaseItemId: input.purchaseItemId,
        allocated,
        expected: input.expectedBaseQuantity,
      },
    });
  }
  const consumed = consumeExactInventoryLots(tx, {
    tenantId: input.tenantId,
    siteId: input.siteId,
    productId: input.productId,
    allocations: rows.map(row => ({ lotId: row.inventoryLotId, quantity: row.baseQuantity })),
    now: input.now,
    businessDate: input.businessDate,
  });
  const provenanceByLotId = new Map(rows.map(row => [row.inventoryLotId, row]));
  const changedProvenance = consumed.find(row => {
    const provenance = provenanceByLotId.get(row.lotId);
    return (
      !provenance ||
      provenance.lotNumberSnapshot !== row.lotNumber ||
      provenance.expiresAtSnapshot !== row.expiresAt ||
      roundMoney(provenance.unitCost) !== roundMoney(row.unitCost)
    );
  });
  if (changedProvenance) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_STOCK_INCONSISTENT',
      message: 'Purchase lot identity or unit cost changed and cannot be voided exactly',
      details: { lotId: changedProvenance.lotId },
    });
  }
  const blocked = consumed.find(
    row =>
      row.sourceStatus === 'expired' ||
      row.sourceStatus === 'quarantined' ||
      row.sourceStatus === 'recalled'
  );
  if (blocked) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_STOCK_INCONSISTENT',
      message: 'A non-vendable purchase lot cannot be erased by voiding its receipt',
      details: { lotId: blocked.lotId, status: blocked.sourceStatus },
    });
  }
  if (isPharmacyProduct(tx, input.tenantId, input.productId)) {
    for (const lot of consumed) {
      writeInventoryLotEvent(tx, input.syncContext, {
        tenantId: input.tenantId,
        siteId: input.siteId,
        productId: input.productId,
        lotId: lot.lotId,
        eventType: 'supplier_return',
        previousStatus: lot.sourceStatus,
        nextStatus: lot.status,
        quantitySnapshot: lot.newOnHand,
        reason: 'Purchase receipt voided',
        referenceType: 'purchase_item',
        referenceId: input.purchaseItemId,
        actorId: input.actorId,
        occurredAt: input.now,
      });
    }
  }
  return consumed.map(row => row.lotId);
}
