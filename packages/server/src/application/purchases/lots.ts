/** Lot-aware purchase receipt and supplier-return helpers. */

import { roundQuantity } from '@puntovivo/shared/unit-math';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { purchaseItemLots, purchaseReturnItemLots } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
import {
  consumeExactInventoryLots,
  receiveInventoryLot,
} from '../../services/inventory-lots/index.js';
import type { ResolvedPurchaseItem, ResolvedPurchaseReturnItem } from './types.js';

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
  }
): string[] {
  const lotIds: string[] = [];
  for (const receipt of input.lotReceipts) {
    const lot = receiveInventoryLot(tx, {
      tenantId: input.tenantId,
      siteId: input.siteId,
      productId: input.productId,
      lotNumber: receipt.lotNumber,
      expiresAt: receipt.expiresAt,
      quantity: receipt.baseQuantity,
      unitCost: input.baseUnitCost,
      notes: receipt.notes ?? input.purchaseNumber,
      now: input.now,
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
  });
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
    row => row.sourceStatus === 'expired' || row.sourceStatus === 'quarantined'
  );
  if (blocked) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_STOCK_INCONSISTENT',
      message: 'A non-vendable purchase lot cannot be erased by voiding its receipt',
      details: { lotId: blocked.lotId, status: blocked.sourceStatus },
    });
  }
  return consumed.map(row => row.lotId);
}
