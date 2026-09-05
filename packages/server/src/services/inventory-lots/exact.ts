/** Exact lot debits/restorations shared by purchases, transfers, and transformations. */

import { roundQuantity } from '@puntovivo/shared/unit-math';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryLots } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { tryRoundMoneyToSafeCents } from '../../lib/money.js';
import { isLotExpiredAt } from './expiry.js';
import type { InventoryLotStatus } from './receive.js';

const EPSILON = 1e-9;

export interface ExactLotAllocationInput {
  lotId: string;
  quantity: number;
}

export interface ExactLotConsumption {
  lotId: string;
  lotNumber: string;
  expiresAt: string | null;
  /** Effective state before this debit, after fail-closed expiry evaluation. */
  sourceStatus: InventoryLotStatus;
  /** Persisted state after this debit (normally depleted when fully consumed). */
  status: InventoryLotStatus;
  quantity: number;
  unitCost: number;
  previousOnHand: number;
  newOnHand: number;
}

/**
 * Historical stock commands must never choose aggregate vs exact-lot behavior
 * from mutable catalog metadata alone. A mismatch means the product tracking
 * mode changed (or the history is incomplete), so continuing would corrupt the
 * frozen provenance rather than reverse the original operation.
 */
export function assertLotTrackingMatchesProvenance(input: {
  tracksLots: boolean;
  hasLotProvenance: boolean;
  referenceId: string;
}): void {
  if (input.tracksLots === input.hasLotProvenance) return;
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'LOT_STOCK_INCONSISTENT',
    message: 'Frozen lot provenance does not match the current product tracking mode',
    details: {
      referenceId: input.referenceId,
      tracksLots: input.tracksLots,
      hasLotProvenance: input.hasLotProvenance,
    },
  });
}

/**
 * Debit caller-selected physical lots. This low-level operation intentionally
 * accepts non-vendable lots because audited transfers, supplier returns, and
 * destruction still need exact custody. Callers that create sellable output,
 * such as transformations, must reject the returned `sourceStatus`; every
 * accepted non-vendable state is otherwise preserved.
 */
export function consumeExactInventoryLots(
  db: DatabaseInstance,
  input: {
    tenantId: string;
    siteId: string;
    productId: string;
    allocations: readonly ExactLotAllocationInput[];
    now: string;
    businessDate?: string;
  }
): ExactLotConsumption[] {
  if (input.allocations.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_ALLOCATION_REQUIRED',
      message: 'Select at least one exact lot allocation',
    });
  }

  const ids = input.allocations.map(allocation => allocation.lotId);
  if (new Set(ids).size !== ids.length) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_ALLOCATION_DUPLICATE',
      message: 'A lot can only appear once in the same stock mutation',
    });
  }
  for (const allocation of input.allocations) {
    if (!Number.isFinite(allocation.quantity) || allocation.quantity <= EPSILON) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'LOT_QUANTITY_INVALID',
        message: 'Every lot allocation must have a finite positive quantity',
        details: { lotId: allocation.lotId, quantity: allocation.quantity },
      });
    }
  }

  const rows = db
    .select()
    .from(inventoryLots)
    .where(
      and(
        eq(inventoryLots.tenantId, input.tenantId),
        eq(inventoryLots.siteId, input.siteId),
        eq(inventoryLots.productId, input.productId),
        inArray(inventoryLots.id, ids)
      )
    )
    .all();
  const rowById = new Map(rows.map(row => [row.id, row]));

  return input.allocations.map(allocation => {
    const lot = rowById.get(allocation.lotId);
    if (!lot) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'LOT_NOT_FOUND',
        message: 'The selected lot was not found for this tenant, site, and product',
        details: { lotId: allocation.lotId },
      });
    }
    if (!Number.isFinite(lot.onHand) || lot.onHand < 0) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'LOT_STOCK_INCONSISTENT',
        message: 'Stored exact-lot quantity must be finite and non-negative',
        details: { lotId: lot.id },
      });
    }
    if (lot.onHand + EPSILON < allocation.quantity) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'LOT_INSUFFICIENT_STOCK',
        message: 'The selected lot does not have enough on-hand quantity',
        details: {
          lotId: lot.id,
          lotNumber: lot.lotNumber,
          available: lot.onHand,
          requested: allocation.quantity,
        },
      });
    }
    const unitCost = tryRoundMoneyToSafeCents(lot.unitCost);
    if (unitCost === null || unitCost < 0) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'LOT_COST_INVALID',
        message: 'The stored lot cost is outside the exact supported cent range',
        details: { lotId: lot.id },
      });
    }

    const sourceStatus: InventoryLotStatus =
      lot.status === 'quarantined' || lot.status === 'expired' || lot.status === 'recalled'
        ? lot.status
        : isLotExpiredAt(lot.expiresAt, input.now, input.businessDate)
          ? 'expired'
          : lot.onHand <= EPSILON
            ? 'depleted'
            : 'active';
    const rawNext = lot.onHand - allocation.quantity;
    const newOnHand = rawNext <= EPSILON ? 0 : roundQuantity(rawNext, 12);
    const status: InventoryLotStatus =
      sourceStatus === 'quarantined' || sourceStatus === 'expired' || sourceStatus === 'recalled'
        ? sourceStatus
        : newOnHand === 0
          ? 'depleted'
          : 'active';
    const nextSyncVersion = (lot.syncVersion ?? 0) + 1;

    const changed = db
      .update(inventoryLots)
      .set({
        onHand: newOnHand,
        status,
        syncStatus: 'pending',
        syncVersion: nextSyncVersion,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(inventoryLots.id, lot.id),
          eq(inventoryLots.tenantId, input.tenantId),
          eq(inventoryLots.onHand, lot.onHand),
          eq(inventoryLots.unitCost, lot.unitCost),
          eq(inventoryLots.status, lot.status),
          lot.syncVersion === null
            ? isNull(inventoryLots.syncVersion)
            : eq(inventoryLots.syncVersion, lot.syncVersion),
          lot.expiresAt === null
            ? isNull(inventoryLots.expiresAt)
            : eq(inventoryLots.expiresAt, lot.expiresAt)
        )
      )
      .run();
    if (changed.changes !== 1) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'LOT_STALE_STOCK',
        message: 'The lot quantity changed while the operation was being recorded',
        details: { lotId: lot.id },
      });
    }

    return {
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      expiresAt: lot.expiresAt,
      sourceStatus,
      // Return the effective post-validation state, not the stale persisted
      // value. A lot whose date elapsed before this command is marked expired
      // above and callers must not treat it as vendable merely because its
      // previous status string was still active.
      status,
      quantity: allocation.quantity,
      unitCost,
      previousOnHand: lot.onHand,
      newOnHand,
    };
  });
}

/** Calculate a safe exact-lot restoration before any row is mutated. */
export function calculateRestoredInventoryLotState(input: {
  lotId: string;
  currentOnHand: number;
  currentUnitCost: number;
  currentStatus: InventoryLotStatus;
  expiresAt: string | null;
  quantity: number;
  unitCost?: number;
  incomingStatus?: InventoryLotStatus;
  now: string;
  businessDate?: string;
}): { onHand: number; unitCost: number; status: InventoryLotStatus } {
  if (
    !Number.isFinite(input.currentOnHand) ||
    input.currentOnHand < 0 ||
    !Number.isFinite(input.quantity) ||
    input.quantity <= EPSILON
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_QUANTITY_INVALID',
      message: 'Lot restoration quantity must be finite and positive',
      details: { lotId: input.lotId },
    });
  }
  const restoredUnitCost =
    input.unitCost === undefined ? undefined : tryRoundMoneyToSafeCents(input.unitCost);
  if (restoredUnitCost === null || (restoredUnitCost !== undefined && restoredUnitCost < 0)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_COST_INVALID',
      message: 'Lot restoration cost must be finite and non-negative',
      details: { lotId: input.lotId },
    });
  }
  const existingUnitCost = tryRoundMoneyToSafeCents(input.currentUnitCost);
  if (existingUnitCost === null || existingUnitCost < 0) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_COST_INVALID',
      message: 'The stored lot cost is outside the exact supported cent range',
      details: { lotId: input.lotId },
    });
  }
  const nextOnHand = roundQuantity(input.currentOnHand + input.quantity, 12);
  if (!Number.isFinite(nextOnHand)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_QUANTITY_INVALID',
      message: 'Lot restoration would produce a non-finite on-hand quantity',
      details: { lotId: input.lotId },
    });
  }
  const nextUnitCost =
    restoredUnitCost === undefined
      ? existingUnitCost
      : tryRoundMoneyToSafeCents(
          (input.currentOnHand * existingUnitCost + input.quantity * restoredUnitCost) / nextOnHand
        );
  if (nextUnitCost === null || nextUnitCost < 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_COST_INVALID',
      message: 'Lot restoration would produce a cost outside the exact supported cent range',
      details: { lotId: input.lotId },
    });
  }
  const status: InventoryLotStatus =
    input.currentStatus === 'recalled' || input.incomingStatus === 'recalled'
      ? 'recalled'
      : input.currentStatus === 'quarantined' || input.incomingStatus === 'quarantined'
        ? 'quarantined'
        : input.currentStatus === 'expired' || input.incomingStatus === 'expired'
          ? 'expired'
          : isLotExpiredAt(input.expiresAt, input.now, input.businessDate)
            ? 'expired'
            : 'active';
  return { onHand: nextOnHand, unitCost: nextUnitCost, status };
}

/** Restore an exact lot identity without restoring sellability. */
export function restoreExactInventoryLot(
  db: DatabaseInstance,
  input: {
    tenantId: string;
    siteId: string;
    productId: string;
    lotId: string;
    quantity: number;
    /** Frozen cost of the exact units being restored. */
    unitCost?: number;
    /** Preserve a non-vendable state that followed the same physical units. */
    incomingStatus?: InventoryLotStatus;
    now: string;
    businessDate?: string;
  }
): void {
  const lot = db
    .select()
    .from(inventoryLots)
    .where(
      and(
        eq(inventoryLots.id, input.lotId),
        eq(inventoryLots.tenantId, input.tenantId),
        eq(inventoryLots.siteId, input.siteId),
        eq(inventoryLots.productId, input.productId)
      )
    )
    .get();
  if (!lot) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'LOT_NOT_FOUND',
      message: 'The exact lot to restore no longer exists',
      details: { lotId: input.lotId },
    });
  }
  const restored = calculateRestoredInventoryLotState({
    lotId: input.lotId,
    currentOnHand: lot.onHand,
    currentUnitCost: lot.unitCost,
    currentStatus: lot.status,
    expiresAt: lot.expiresAt,
    quantity: input.quantity,
    ...(input.unitCost === undefined ? {} : { unitCost: input.unitCost }),
    ...(input.incomingStatus === undefined ? {} : { incomingStatus: input.incomingStatus }),
    now: input.now,
    ...(input.businessDate ? { businessDate: input.businessDate } : {}),
  });
  const nextSyncVersion = (lot.syncVersion ?? 0) + 1;
  const changed = db
    .update(inventoryLots)
    .set({
      onHand: restored.onHand,
      unitCost: restored.unitCost,
      status: restored.status,
      syncStatus: 'pending',
      syncVersion: nextSyncVersion,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(inventoryLots.id, input.lotId),
        eq(inventoryLots.tenantId, input.tenantId),
        eq(inventoryLots.onHand, lot.onHand),
        eq(inventoryLots.unitCost, lot.unitCost),
        eq(inventoryLots.status, lot.status),
        lot.syncVersion === null
          ? isNull(inventoryLots.syncVersion)
          : eq(inventoryLots.syncVersion, lot.syncVersion),
        lot.expiresAt === null
          ? isNull(inventoryLots.expiresAt)
          : eq(inventoryLots.expiresAt, lot.expiresAt)
      )
    )
    .run();
  if (changed.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_STALE_STOCK',
      message: 'The lot quantity changed while the restoration was being recorded',
      details: { lotId: input.lotId },
    });
  }
}
