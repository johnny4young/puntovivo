/**
 * Lot read queries (Auditoría 2026-07 — lots & costing): list a product's
 * lots at a site (FEFO-ordered) and scan for lots expiring within a window
 * for the expiry-alert surface.
 *
 * @module services/inventory-lots/queries
 */

import { and, eq, lte, gt, ne } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryLots, products } from '../../db/schema.js';
import { orderLotsFefo } from './select-fefo.js';

export interface LotRow {
  id: string;
  siteId: string;
  productId: string;
  lotNumber: string;
  expiresAt: string | null;
  onHand: number;
  unitCost: number;
  status: string;
  receivedAt: string;
}

/**
 * All lots for a (site, product), FEFO-ordered. Includes depleted/expired
 * rows by default so the caller can render history; pass
 * `activeOnly: true` for the consumable set.
 */
export function listLotsForProduct(
  db: DatabaseInstance,
  args: { tenantId: string; siteId: string; productId: string; activeOnly?: boolean }
): LotRow[] {
  const conditions = [
    eq(inventoryLots.tenantId, args.tenantId),
    eq(inventoryLots.siteId, args.siteId),
    eq(inventoryLots.productId, args.productId),
  ];
  if (args.activeOnly) {
    conditions.push(eq(inventoryLots.status, 'active'));
    conditions.push(gt(inventoryLots.onHand, 0));
  }
  const rows = db
    .select({
      id: inventoryLots.id,
      siteId: inventoryLots.siteId,
      productId: inventoryLots.productId,
      lotNumber: inventoryLots.lotNumber,
      expiresAt: inventoryLots.expiresAt,
      onHand: inventoryLots.onHand,
      unitCost: inventoryLots.unitCost,
      status: inventoryLots.status,
      receivedAt: inventoryLots.receivedAt,
    })
    .from(inventoryLots)
    .where(and(...conditions))
    .all();
  return orderLotsFefo(rows);
}

export interface ExpiringLotRow extends LotRow {
  productName: string;
}

/**
 * Lots with on-hand stock whose expiry falls on or before `cutoffIso`,
 * excluding already-quarantined rows. Ordered soonest-first for the alert
 * list. Non-perishable lots (null expiry) are never returned.
 */
export function listExpiringLots(
  db: DatabaseInstance,
  args: { tenantId: string; cutoffIso: string; siteId?: string }
): ExpiringLotRow[] {
  const conditions = [
    eq(inventoryLots.tenantId, args.tenantId),
    gt(inventoryLots.onHand, 0),
    ne(inventoryLots.status, 'quarantined'),
    lte(inventoryLots.expiresAt, args.cutoffIso),
  ];
  if (args.siteId) {
    conditions.push(eq(inventoryLots.siteId, args.siteId));
  }
  const rows = db
    .select({
      id: inventoryLots.id,
      siteId: inventoryLots.siteId,
      productId: inventoryLots.productId,
      lotNumber: inventoryLots.lotNumber,
      expiresAt: inventoryLots.expiresAt,
      onHand: inventoryLots.onHand,
      unitCost: inventoryLots.unitCost,
      status: inventoryLots.status,
      receivedAt: inventoryLots.receivedAt,
      productName: products.name,
    })
    .from(inventoryLots)
    .innerJoin(products, eq(inventoryLots.productId, products.id))
    .where(and(...conditions))
    .all();
  // `lte(expiresAt, cutoff)` also matches NULL? No — SQL NULL comparisons are
  // never true, so null-expiry lots are excluded, which is what we want.
  return rows.sort((a, b) => {
    const ax = a.expiresAt ?? '';
    const bx = b.expiresAt ?? '';
    return ax < bx ? -1 : ax > bx ? 1 : 0;
  });
}
