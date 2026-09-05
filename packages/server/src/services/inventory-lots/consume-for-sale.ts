/**
 * Lot consumption + restoration on the sale lifecycle (Auditoría 2026-07 —
 * lots & costing). Runs INSIDE the caller's sale transaction.
 *
 * Forward: `consumeLotsForSaleLine` draws a line's base-unit quantity from
 * the product's active lots at the sale site in FEFO order, decrements each
 * lot (marking it depleted at zero), and records one `sale_item_lots` row
 * per lot drawn — the auditable COGS provenance. The caller must reject a
 * shortfall so aggregate stock can never commit without matching lot
 * provenance. Expired lots are excluded even when stale data still labels
 * them `active`.
 *
 * Reverse: `restoreLotsForSale` reads a sale's `sale_item_lots`, credits the
 * exact lots back (reactivating depleted ones), and clears the rows — the
 * precise inverse a return / void / discard needs.
 *
 * @module services/inventory-lots/consume-for-sale
 */

import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryLots, saleItemLots, saleItems } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { tryRoundMoneyToSafeCents } from '../../lib/money.js';
import { listLotsForProduct } from './queries.js';
import { selectLotsFefo, type FefoSelection } from './select-fefo.js';
import { isLotExpiredAt } from './expiry.js';
import { calculateRestoredInventoryLotState } from './exact.js';

export { isLotExpiredAt } from './expiry.js';

const EPSILON = 1e-9;

export interface ConsumeLotsForSaleLineInput {
  tenantId: string;
  siteId: string;
  productId: string;
  saleItemId: string;
  /** Quantity to consume, in base units. */
  quantity: number;
  now: string;
}

export interface ConsumeLotsResult {
  selection: FefoSelection;
  /** Base units the lots could not cover (lot/balance drift); ≥ 0. */
  shortfall: number;
}

/**
 * Consume `quantity` base units from the product's active lots at the site,
 * FEFO, recording provenance. Returns the FEFO selection (allocations +
 * COGS) and any shortfall.
 */
export function consumeLotsForSaleLine(
  db: DatabaseInstance,
  input: ConsumeLotsForSaleLineInput
): ConsumeLotsResult {
  if (!Number.isFinite(input.quantity)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_QUANTITY_INVALID',
      message: 'Lot sale quantity must be finite',
    });
  }
  if (!(input.quantity > EPSILON)) {
    return { selection: { allocations: [], totalCost: 0, shortfall: 0 }, shortfall: 0 };
  }

  const activeLots = listLotsForProduct(db, {
    tenantId: input.tenantId,
    siteId: input.siteId,
    productId: input.productId,
    activeOnly: true,
  })
    .filter(lot => !isLotExpiredAt(lot.expiresAt, input.now))
    .map(lot => {
      if (!Number.isFinite(lot.onHand)) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'LOT_STOCK_INCONSISTENT',
          message: 'Sellable lot on-hand quantity must be finite',
          details: { lotId: lot.id },
        });
      }
      const unitCost = tryRoundMoneyToSafeCents(lot.unitCost);
      if (unitCost === null || unitCost < 0) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'LOT_COST_INVALID',
          message: 'Sellable lot cost is outside the exact supported cent range',
          details: { lotId: lot.id },
        });
      }
      return { ...lot, unitCost };
    });

  const selection = selectLotsFefo(activeLots, input.quantity);
  if (
    tryRoundMoneyToSafeCents(selection.totalCost) === null ||
    selection.allocations.some(allocation => tryRoundMoneyToSafeCents(allocation.lineCost) === null)
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_COST_INVALID',
      message: 'Lot sale cost is outside the exact supported cent range',
    });
  }

  for (const allocation of selection.allocations) {
    const lot = activeLots.find(l => l.id === allocation.lotId)!;
    // Quantities are not money-rounded — see receive.ts: on_hand must track the
    // un-rounded inventory_balances.on_hand. The EPSILON check below still
    // collapses float residue to a depleted lot.
    const newOnHand = lot.onHand - allocation.quantity;
    const changed = db
      .update(inventoryLots)
      .set({
        onHand: newOnHand,
        status: newOnHand <= EPSILON ? 'depleted' : 'active',
        syncStatus: 'pending',
        updatedAt: input.now,
      })
      .where(
        and(
          eq(inventoryLots.id, allocation.lotId),
          eq(inventoryLots.tenantId, input.tenantId),
          eq(inventoryLots.onHand, lot.onHand),
          eq(inventoryLots.unitCost, lot.unitCost),
          eq(inventoryLots.status, lot.status),
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
        message: 'The sellable lot changed while the sale was being recorded',
        details: { lotId: allocation.lotId },
      });
    }

    db.insert(saleItemLots)
      .values({
        id: nanoid(),
        tenantId: input.tenantId,
        saleItemId: input.saleItemId,
        lotId: allocation.lotId,
        quantity: allocation.quantity,
        unitCost: allocation.unitCost,
        createdAt: input.now,
      })
      .run();
  }

  return { selection, shortfall: selection.shortfall };
}

export interface RestoreLotsForSaleInput {
  tenantId: string;
  saleId: string;
  now: string;
}

/**
 * Result of {@link restoreLotsForSale}: how many provenance rows were
 * reversed and which distinct lots were credited back. `lotIds` exists so
 * the reversal use-cases can enqueue the mutated lots to the sync outbox
 * post-commit () — the lot rows are marked sync-pending in here, but
 * enqueueing is the caller's post-transaction responsibility.
 */
export interface RestoreLotsForSaleResult {
  restored: number;
  lotIds: string[];
}

/**
 * Restore every lot a sale consumed: re-increment the recorded lots
 * (reactivating depleted ones) and clear the provenance rows. Used by the
 * full-sale reversals (return / void / discard).
 */
export function restoreLotsForSale(
  db: DatabaseInstance,
  input: RestoreLotsForSaleInput
): RestoreLotsForSaleResult {
  const rows = db
    .select({
      id: saleItemLots.id,
      lotId: saleItemLots.lotId,
      quantity: saleItemLots.quantity,
      unitCost: saleItemLots.unitCost,
    })
    .from(saleItemLots)
    .innerJoin(saleItems, eq(saleItemLots.saleItemId, saleItems.id))
    .where(and(eq(saleItemLots.tenantId, input.tenantId), eq(saleItems.saleId, input.saleId)))
    .all();

  const lotIds = new Set<string>();
  for (const row of rows) {
    const lot = db
      .select({
        onHand: inventoryLots.onHand,
        unitCost: inventoryLots.unitCost,
        status: inventoryLots.status,
        expiresAt: inventoryLots.expiresAt,
      })
      .from(inventoryLots)
      .where(and(eq(inventoryLots.id, row.lotId), eq(inventoryLots.tenantId, input.tenantId)))
      .get();
    if (!lot) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'LOT_STOCK_INCONSISTENT',
        message: 'A sale lot required for reversal no longer exists in this tenant',
        details: { lotId: row.lotId },
      });
    }
    const restored = calculateRestoredInventoryLotState({
      lotId: row.lotId,
      currentOnHand: lot.onHand,
      currentUnitCost: lot.unitCost,
      currentStatus: lot.status,
      expiresAt: lot.expiresAt,
      quantity: row.quantity,
      unitCost: row.unitCost,
      now: input.now,
    });
    const changed = db
      .update(inventoryLots)
      .set({
        onHand: restored.onHand,
        unitCost: restored.unitCost,
        // A reversal restores quantity, never sellability. Quarantine and
        // expiry remain authoritative; only a still-valid depleted lot can
        // become active again.
        status: restored.status,
        syncStatus: 'pending',
        updatedAt: input.now,
      })
      .where(
        and(
          eq(inventoryLots.id, row.lotId),
          eq(inventoryLots.tenantId, input.tenantId),
          eq(inventoryLots.onHand, lot.onHand),
          eq(inventoryLots.unitCost, lot.unitCost),
          eq(inventoryLots.status, lot.status),
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
        message: 'The sale lot changed while its reversal was being recorded',
        details: { lotId: row.lotId },
      });
    }
    lotIds.add(row.lotId);
    db.delete(saleItemLots).where(eq(saleItemLots.id, row.id)).run();
  }

  return { restored: rows.length, lotIds: [...lotIds] };
}
