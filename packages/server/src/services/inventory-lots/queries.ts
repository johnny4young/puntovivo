/**
 * Lot read queries (Auditoría 2026-07 — lots & costing): list a product's
 * lots at a site (FEFO-ordered) and scan for lots expiring within a window
 * for the expiry-alert surface.
 *
 * @module services/inventory-lots/queries
 */

import { and, eq, gte, gt, lte, or, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryLots,
  pharmacyProductProfiles,
  pharmacyRecallLots,
  pharmacyRecalls,
  products,
} from '../../db/schema.js';
import { orderLotsFefo } from './select-fefo.js';
import { isLotExpiredAt } from './expiry.js';

export interface LotRow {
  id: string;
  siteId: string;
  productId: string;
  lotNumber: string;
  expiresAt: string | null;
  onHand: number;
  unitCost: number;
  status: (typeof inventoryLots.$inferSelect)['status'];
  syncVersion: number | null;
  receivedAt: string;
}

export interface ListedLotRow extends LotRow {
  activeRecallCount: number;
}

/**
 * All lots for a (site, product), FEFO-ordered. Includes depleted/expired
 * rows by default so the caller can render history; pass
 * `activeOnly: true` for the consumable set.
 */
export function listLotsForProduct(
  db: DatabaseInstance,
  args: { tenantId: string; siteId: string; productId: string; activeOnly?: boolean }
): ListedLotRow[] {
  const conditions = [
    eq(inventoryLots.tenantId, args.tenantId),
    eq(inventoryLots.siteId, args.siteId),
    eq(inventoryLots.productId, args.productId),
  ];
  if (args.activeOnly) {
    conditions.push(eq(inventoryLots.status, 'active'));
    conditions.push(gt(inventoryLots.onHand, 0));
  }
  const query = db
    .select({
      id: inventoryLots.id,
      siteId: inventoryLots.siteId,
      productId: inventoryLots.productId,
      lotNumber: inventoryLots.lotNumber,
      expiresAt: inventoryLots.expiresAt,
      onHand: inventoryLots.onHand,
      unitCost: inventoryLots.unitCost,
      status: inventoryLots.status,
      syncVersion: inventoryLots.syncVersion,
      receivedAt: inventoryLots.receivedAt,
      activeRecallCount: sql<number>`count(${pharmacyRecalls.id})`,
    })
    .from(inventoryLots)
    .leftJoin(
      pharmacyRecallLots,
      and(
        eq(pharmacyRecallLots.tenantId, args.tenantId),
        eq(pharmacyRecallLots.lotId, inventoryLots.id)
      )
    )
    .leftJoin(
      pharmacyRecalls,
      and(
        eq(pharmacyRecalls.tenantId, args.tenantId),
        eq(pharmacyRecalls.id, pharmacyRecallLots.recallId),
        eq(pharmacyRecalls.status, 'active')
      )
    )
    .where(and(...conditions))
    .groupBy(inventoryLots.id);
  const rows = query.all();
  return orderLotsFefo(rows);
}

export interface ExpiringLotRow extends LotRow {
  productName: string;
  isPharmacyMedicine: boolean;
}

/**
 * Lots with on-hand stock whose expiry falls between `nowIso` and
 * `cutoffIso`, excluding already-quarantined rows. Ordered soonest-first for
 * the alert list. Non-perishable and already-expired lots are never returned.
 */
export function listExpiringLots(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    nowIso: string;
    cutoffIso: string;
    businessDate?: string;
    cutoffBusinessDate?: string;
    siteId?: string;
  }
): ExpiringLotRow[] {
  const businessDate = args.businessDate ?? args.nowIso.slice(0, 10);
  const cutoffBusinessDate = args.cutoffBusinessDate ?? args.cutoffIso.slice(0, 10);
  const conditions = [
    eq(inventoryLots.tenantId, args.tenantId),
    gt(inventoryLots.onHand, 0),
    eq(inventoryLots.status, 'active'),
    or(
      and(
        sql`length(${inventoryLots.expiresAt}) = 10`,
        gte(inventoryLots.expiresAt, businessDate),
        lte(inventoryLots.expiresAt, cutoffBusinessDate)
      ),
      and(
        sql`length(${inventoryLots.expiresAt}) <> 10`,
        gt(inventoryLots.expiresAt, args.nowIso),
        lte(inventoryLots.expiresAt, args.cutoffIso)
      )
    )!,
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
      syncVersion: inventoryLots.syncVersion,
      receivedAt: inventoryLots.receivedAt,
      productName: products.name,
      pharmacyProductId: pharmacyProductProfiles.productId,
    })
    .from(inventoryLots)
    .innerJoin(
      products,
      and(eq(inventoryLots.productId, products.id), eq(products.tenantId, args.tenantId))
    )
    .leftJoin(
      pharmacyProductProfiles,
      and(
        eq(pharmacyProductProfiles.productId, inventoryLots.productId),
        eq(pharmacyProductProfiles.tenantId, args.tenantId)
      )
    )
    .where(and(...conditions))
    .all();
  // Range comparisons never match SQL NULL, so non-perishable lots are
  // excluded without a separate null predicate.
  return rows
    .filter(row => !isLotExpiredAt(row.expiresAt, args.nowIso, businessDate))
    .map(({ pharmacyProductId, ...row }) => ({
      ...row,
      isPharmacyMedicine: pharmacyProductId !== null,
    }))
    .sort((a, b) => {
      const ax = a.expiresAt ?? '';
      const bx = b.expiresAt ?? '';
      return ax < bx ? -1 : ax > bx ? 1 : 0;
    });
}
