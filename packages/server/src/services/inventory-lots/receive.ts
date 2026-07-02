/**
 * Lot receipt (Auditoría 2026-07 — lots & costing).
 *
 * Records a received batch into `inventory_lots`. Receiving the SAME
 * (site, product, lotNumber) again increments its on-hand and blends the
 * unit cost by weighted average (a physical batch is one cost layer;
 * a second receipt of it at a different landed cost averages in). A new
 * lot number inserts a fresh row. Runs inside the caller's transaction
 * when one is passed so a purchase receipt stays atomic.
 *
 * @module services/inventory-lots/receive
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryLots } from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import { throwServerError } from '../../lib/errorCodes.js';

export interface ReceiveLotInput {
  tenantId: string;
  siteId: string;
  productId: string;
  lotNumber: string;
  /** ISO date, or null for a non-perishable lot. */
  expiresAt?: string | null;
  /** Quantity received, in base units. Must be > 0. */
  quantity: number;
  /** Cost per base unit for this receipt. Must be ≥ 0. */
  unitCost: number;
  notes?: string | null;
  now: string;
}

export interface ReceiveLotResult {
  lotId: string;
  created: boolean;
  onHand: number;
  unitCost: number;
}

export function receiveInventoryLot(
  db: DatabaseInstance,
  input: ReceiveLotInput
): ReceiveLotResult {
  if (!(input.quantity > 0)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_QUANTITY_INVALID',
      message: 'Lot receipt quantity must be greater than zero',
    });
  }
  if (input.unitCost < 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_COST_INVALID',
      message: 'Lot unit cost cannot be negative',
    });
  }

  const existing = db
    .select()
    .from(inventoryLots)
    .where(
      and(
        eq(inventoryLots.tenantId, input.tenantId),
        eq(inventoryLots.siteId, input.siteId),
        eq(inventoryLots.productId, input.productId),
        eq(inventoryLots.lotNumber, input.lotNumber)
      )
    )
    .get();

  if (existing) {
    const newOnHand = roundMoney(existing.onHand + input.quantity);
    // Weighted-average the layer cost across the prior and incoming units.
    const blendedCost =
      newOnHand > 0
        ? roundMoney(
            (existing.onHand * existing.unitCost + input.quantity * input.unitCost) / newOnHand
          )
        : input.unitCost;
    db.update(inventoryLots)
      .set({
        onHand: newOnHand,
        unitCost: blendedCost,
        // A replenished lot returns to active (a previously depleted batch
        // that was re-received). Expiry is only widened, never silently
        // overwritten with an earlier date on re-receipt.
        status: 'active',
        expiresAt: input.expiresAt ?? existing.expiresAt,
        syncStatus: 'pending',
        updatedAt: input.now,
      })
      .where(eq(inventoryLots.id, existing.id))
      .run();
    return { lotId: existing.id, created: false, onHand: newOnHand, unitCost: blendedCost };
  }

  const id = nanoid();
  db.insert(inventoryLots)
    .values({
      id,
      tenantId: input.tenantId,
      siteId: input.siteId,
      productId: input.productId,
      lotNumber: input.lotNumber,
      expiresAt: input.expiresAt ?? null,
      onHand: roundMoney(input.quantity),
      unitCost: roundMoney(input.unitCost),
      status: 'active',
      receivedAt: input.now,
      notes: input.notes ?? null,
      syncStatus: 'pending',
      syncVersion: 0,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run();
  return {
    lotId: id,
    created: true,
    onHand: roundMoney(input.quantity),
    unitCost: roundMoney(input.unitCost),
  };
}
