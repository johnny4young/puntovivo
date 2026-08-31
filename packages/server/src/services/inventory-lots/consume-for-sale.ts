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

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryLots, saleItemLots, saleItems } from '../../db/schema.js';
import { listLotsForProduct } from './queries.js';
import { selectLotsFefo, type FefoSelection } from './select-fefo.js';

const EPSILON = 1e-9;

/**
 * A date-only expiry remains valid through that calendar date. Full ISO
 * timestamps expire at their exact instant. Status is evaluated separately by
 * the query that supplies only active lots.
 */
export function isLotExpiredAt(expiresAt: string | null, nowIso: string): boolean {
  if (!expiresAt) return false;
  const nowTime = Date.parse(nowIso);
  // A corrupt reference clock must never make dated inventory sellable.
  if (!Number.isFinite(nowTime)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    const expiryDateTime = Date.parse(`${expiresAt}T00:00:00.000Z`);
    const normalizedExpiry = Number.isFinite(expiryDateTime)
      ? new Date(expiryDateTime).toISOString().slice(0, 10)
      : null;
    if (normalizedExpiry !== expiresAt) return true;
    return expiresAt < new Date(nowTime).toISOString().slice(0, 10);
  }
  const expiryTime = Date.parse(expiresAt);
  // Historical rows can predate schema validation. Treat any malformed,
  // non-null expiry as non-sellable rather than silently trusting it.
  return !Number.isFinite(expiryTime) || expiryTime <= nowTime;
}

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
  if (!(input.quantity > EPSILON)) {
    return { selection: { allocations: [], totalCost: 0, shortfall: 0 }, shortfall: 0 };
  }

  const activeLots = listLotsForProduct(db, {
    tenantId: input.tenantId,
    siteId: input.siteId,
    productId: input.productId,
    activeOnly: true,
  }).filter(lot => !isLotExpiredAt(lot.expiresAt, input.now));

  const selection = selectLotsFefo(activeLots, input.quantity);

  for (const allocation of selection.allocations) {
    const lot = activeLots.find(l => l.id === allocation.lotId)!;
    // Quantities are not money-rounded — see receive.ts: on_hand must track the
    // un-rounded inventory_balances.on_hand. The EPSILON check below still
    // collapses float residue to a depleted lot.
    const newOnHand = lot.onHand - allocation.quantity;
    db.update(inventoryLots)
      .set({
        onHand: newOnHand,
        status: newOnHand <= EPSILON ? 'depleted' : 'active',
        syncStatus: 'pending',
        updatedAt: input.now,
      })
      .where(
        and(eq(inventoryLots.id, allocation.lotId), eq(inventoryLots.tenantId, input.tenantId))
      )
      .run();

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
        status: inventoryLots.status,
        expiresAt: inventoryLots.expiresAt,
      })
      .from(inventoryLots)
      .where(and(eq(inventoryLots.id, row.lotId), eq(inventoryLots.tenantId, input.tenantId)))
      .get();
    if (!lot) {
      continue;
    }
    const restoredStatus =
      lot.status === 'quarantined' || lot.status === 'expired'
        ? lot.status
        : isLotExpiredAt(lot.expiresAt, input.now)
          ? 'expired'
          : 'active';
    db.update(inventoryLots)
      .set({
        onHand: lot.onHand + row.quantity,
        // A reversal restores quantity, never sellability. Quarantine and
        // expiry remain authoritative; only a still-valid depleted lot can
        // become active again.
        status: restoredStatus,
        syncStatus: 'pending',
        updatedAt: input.now,
      })
      .where(and(eq(inventoryLots.id, row.lotId), eq(inventoryLots.tenantId, input.tenantId)))
      .run();
    lotIds.add(row.lotId);
    db.delete(saleItemLots).where(eq(saleItemLots.id, row.id)).run();
  }

  return { restored: rows.length, lotIds: [...lotIds] };
}
