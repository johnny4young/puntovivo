/**
 * FEFO (first-expired-first-out) lot selection + COGS costing
 * (Auditoría 2026-07 — lots & costing).
 *
 * Pure allocation logic, separated from the DB so it can be exhaustively
 * tested: given the active lots of a product at a site and a quantity to
 * consume (in base units), decide which lots to draw from and at what cost.
 * Consuming the earliest-expiring lot first is the food/pharma-correct
 * discipline, and because each lot carries its own `unitCost`, the
 * allocation doubles as the COGS layer — the returned `totalCost` is the
 * exact cost of goods sold for that consumption, auditable per lot.
 *
 * @module services/inventory-lots/select-fefo
 */

import { roundMoney } from '../../lib/money.js';

export interface SelectableLot {
  id: string;
  /** ISO date, or null for a non-perishable lot. */
  expiresAt: string | null;
  /** Remaining quantity in base units. */
  onHand: number;
  /** Cost per base unit. */
  unitCost: number;
  /** ISO timestamp; FEFO tiebreaker after expiry. */
  receivedAt: string;
}

export interface LotAllocation {
  lotId: string;
  quantity: number;
  unitCost: number;
  /** roundMoney(quantity * unitCost). */
  lineCost: number;
}

export interface FefoSelection {
  allocations: LotAllocation[];
  /** Σ lineCost across allocations, 2-decimal. */
  totalCost: number;
  /** Quantity that could NOT be satisfied from the supplied lots (≥ 0). */
  shortfall: number;
}

/**
 * Order lots FEFO: soonest expiry first, non-perishable (null expiry) last,
 * then earliest received, then a stable id tiebreak so the order is fully
 * deterministic across calls.
 */
export function orderLotsFefo<T extends SelectableLot>(lots: readonly T[]): T[] {
  return [...lots].sort((a, b) => {
    if (a.expiresAt !== b.expiresAt) {
      if (a.expiresAt === null) return 1;
      if (b.expiresAt === null) return -1;
      return a.expiresAt < b.expiresAt ? -1 : 1;
    }
    if (a.receivedAt !== b.receivedAt) {
      return a.receivedAt < b.receivedAt ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Allocate `quantity` (base units) across `lots` in FEFO order. Draws the
 * full on-hand of each lot before moving to the next; the final lot may be
 * partially drawn. Reports any `shortfall` instead of throwing so the
 * caller decides whether to block the sale, allow a backorder, or fall back
 * to the non-lot path.
 *
 * `quantity` is treated as an exact base-unit amount; lot `onHand` may be
 * fractional (weighed goods) and is compared with a small epsilon so a lot
 * drawn to within a sub-unit of zero is considered fully consumed.
 */
export function selectLotsFefo(
  lots: readonly SelectableLot[],
  quantity: number
): FefoSelection {
  const EPSILON = 1e-9;
  const allocations: LotAllocation[] = [];
  let remaining = Math.max(0, quantity);
  let totalCost = 0;

  if (remaining <= EPSILON) {
    return { allocations, totalCost: 0, shortfall: 0 };
  }

  for (const lot of orderLotsFefo(lots)) {
    if (remaining <= EPSILON) break;
    const available = Math.max(0, lot.onHand);
    if (available <= EPSILON) continue;

    const take = Math.min(available, remaining);
    const lineCost = roundMoney(take * lot.unitCost);
    allocations.push({
      lotId: lot.id,
      quantity: take,
      unitCost: lot.unitCost,
      lineCost,
    });
    totalCost = roundMoney(totalCost + lineCost);
    remaining = remaining - take;
  }

  return {
    allocations,
    totalCost,
    shortfall: remaining <= EPSILON ? 0 : remaining,
  };
}

/**
 * Weighted-average unit cost of a consumption plan — the blended cost the
 * COGS entry uses when a single sale line drew from lots at different
 * costs. Returns 0 for an empty/zero-quantity plan.
 */
export function weightedAverageUnitCost(selection: FefoSelection): number {
  const totalQty = selection.allocations.reduce((sum, a) => sum + a.quantity, 0);
  if (totalQty <= 0) return 0;
  return roundMoney(selection.totalCost / totalQty);
}
