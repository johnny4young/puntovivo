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

import { roundQuantity } from '@puntovivo/shared/unit-math';
import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryLots } from '../../db/schema.js';
import { tryRoundMoneyToSafeCents } from '../../lib/money.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { isLotExpiredAt } from './expiry.js';

export type InventoryLotStatus = 'active' | 'depleted' | 'expired' | 'quarantined';

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
  /** Preserve a non-vendable state when stock moves between sites. */
  incomingStatus?: InventoryLotStatus;
  /** Transfers use this to prove the same physical batch has one expiry everywhere. */
  requireExactExpiry?: boolean;
  now: string;
}

export interface ReceiveLotResult {
  lotId: string;
  created: boolean;
  expiresAt: string | null;
  previousOnHand: number | null;
  previousUnitCost: number | null;
  previousStatus: InventoryLotStatus | null;
  onHand: number;
  unitCost: number;
  status: InventoryLotStatus;
}

function roundLotMoney(value: number): number {
  const rounded = tryRoundMoneyToSafeCents(value);
  if (rounded === null || rounded < 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_COST_INVALID',
      message: 'Lot unit cost must fit the exact supported cent range',
    });
  }
  return rounded;
}

function normalizeIncomingStatus(input: ReceiveLotInput, expiresAt: string | null) {
  const requested = input.incomingStatus ?? 'active';
  if (requested === 'quarantined') return requested;
  if (requested === 'expired' || isLotExpiredAt(expiresAt, input.now)) return 'expired';
  // A positive receipt cannot remain depleted. It becomes active only when no
  // stronger non-vendable state applies.
  return 'active';
}

function mergeReceiptStatus(
  existing: InventoryLotStatus,
  incoming: InventoryLotStatus,
  expiresAt: string | null,
  now: string
): InventoryLotStatus {
  if (existing === 'quarantined' || incoming === 'quarantined') return 'quarantined';
  if (existing === 'expired' || incoming === 'expired' || isLotExpiredAt(expiresAt, now)) {
    return 'expired';
  }
  return 'active';
}

export function receiveInventoryLot(
  db: DatabaseInstance,
  input: ReceiveLotInput
): ReceiveLotResult {
  if (!Number.isFinite(input.quantity) || !(input.quantity > 0)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_QUANTITY_INVALID',
      message: 'Lot receipt quantity must be greater than zero',
    });
  }
  const incomingUnitCost = roundLotMoney(input.unitCost);

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
    if (!Number.isFinite(existing.onHand) || existing.onHand < 0) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'LOT_STOCK_INCONSISTENT',
        message: 'Stored lot on-hand quantity must be finite and non-negative',
        details: { lotId: existing.id },
      });
    }
    const existingUnitCost = roundLotMoney(existing.unitCost);
    const incomingExpiresAt = input.expiresAt ?? null;
    if (
      existing.expiresAt !== incomingExpiresAt &&
      (input.requireExactExpiry || (existing.expiresAt !== null && incomingExpiresAt !== null))
    ) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'LOT_EXPIRY_CONFLICT',
        message: 'The same physical lot cannot carry two different expiry dates',
        details: {
          lotId: existing.id,
          lotNumber: existing.lotNumber,
          storedExpiresAt: existing.expiresAt,
          receivedExpiresAt: incomingExpiresAt,
        },
      });
    }
    const resolvedExpiresAt = existing.expiresAt ?? input.expiresAt ?? null;
    const incomingStatus = normalizeIncomingStatus(input, resolvedExpiresAt);
    const nextStatus = mergeReceiptStatus(
      existing.status,
      incomingStatus,
      resolvedExpiresAt,
      input.now
    );
    // Quantities are NOT money-rounded: on_hand is an inventory quantity (can
    // be fractional past 2 decimals for weighed goods) and must stay consistent
    // with the un-rounded `inventory_balances.on_hand` so lot counts do not
    // drift from the authoritative stock. Only the cost below is money-rounded.
    const newOnHand = roundQuantity(existing.onHand + input.quantity, 12);
    if (!Number.isFinite(newOnHand)) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'LOT_QUANTITY_INVALID',
        message: 'Lot receipt would produce a non-finite on-hand quantity',
      });
    }
    // Weighted-average the layer cost across the prior and incoming units.
    const blendedCost =
      newOnHand > 0
        ? roundLotMoney(
            (existing.onHand * existingUnitCost + input.quantity * incomingUnitCost) / newOnHand
          )
        : incomingUnitCost;
    const changed = db
      .update(inventoryLots)
      .set({
        onHand: newOnHand,
        unitCost: blendedCost,
        // Quantity restoration never overrides quarantine or expiry. Only a
        // still-valid depleted lot can become active again.
        status: nextStatus,
        expiresAt: resolvedExpiresAt,
        syncStatus: 'pending',
        updatedAt: input.now,
      })
      .where(
        and(
          eq(inventoryLots.id, existing.id),
          eq(inventoryLots.tenantId, input.tenantId),
          eq(inventoryLots.onHand, existing.onHand),
          eq(inventoryLots.unitCost, existing.unitCost),
          eq(inventoryLots.status, existing.status),
          existing.expiresAt === null
            ? isNull(inventoryLots.expiresAt)
            : eq(inventoryLots.expiresAt, existing.expiresAt)
        )
      )
      .run();
    if (changed.changes !== 1) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'LOT_STALE_STOCK',
        message: 'The lot changed while the receipt was being recorded',
        details: { lotId: existing.id },
      });
    }
    return {
      lotId: existing.id,
      created: false,
      expiresAt: resolvedExpiresAt,
      previousOnHand: existing.onHand,
      previousUnitCost: existing.unitCost,
      previousStatus: existing.status,
      onHand: newOnHand,
      unitCost: blendedCost,
      status: nextStatus,
    };
  }

  const id = nanoid();
  const expiresAt = input.expiresAt ?? null;
  const status = normalizeIncomingStatus(input, expiresAt);
  db.insert(inventoryLots)
    .values({
      id,
      tenantId: input.tenantId,
      siteId: input.siteId,
      productId: input.productId,
      lotNumber: input.lotNumber,
      expiresAt,
      onHand: input.quantity,
      unitCost: incomingUnitCost,
      status,
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
    expiresAt,
    previousOnHand: null,
    previousUnitCost: null,
    previousStatus: null,
    onHand: input.quantity,
    unitCost: incomingUnitCost,
    status,
  };
}
