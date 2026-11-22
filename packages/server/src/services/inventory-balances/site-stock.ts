/**
 * Per-site stock reads: where a product's on-hand sits across the tenant's
 * sites, so the register and the manager queue can point to a transfer source.
 *
 * @module services/inventory-balances/site-stock
 */
import { and, eq, inArray } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { inventoryBalances, sites } from '../../db/schema.js';

export interface SiteStock {
  siteId: string;
  siteName: string;
  onHand: number;
}

interface SiteBalance extends SiteStock {
  siteActive: boolean;
}

function selectSiteBalances(
  db: DatabaseInstance,
  tenantId: string,
  productIds: readonly string[]
): Map<string, SiteBalance[]> {
  const result = new Map<string, SiteBalance[]>();
  if (productIds.length === 0) return result;
  const rows = db
    .select({
      productId: inventoryBalances.productId,
      siteId: inventoryBalances.siteId,
      siteName: sites.name,
      siteActive: sites.isActive,
      onHand: inventoryBalances.onHand,
    })
    .from(inventoryBalances)
    .innerJoin(sites, and(eq(sites.id, inventoryBalances.siteId), eq(sites.tenantId, tenantId)))
    .where(
      and(
        eq(inventoryBalances.tenantId, tenantId),
        // Naming the sites lets SQLite probe the full (tenant, site, product) index;
        // without it the planner scans every balance of the tenant.
        inArray(
          inventoryBalances.siteId,
          db.select({ id: sites.id }).from(sites).where(eq(sites.tenantId, tenantId))
        ),
        inArray(inventoryBalances.productId, [...productIds])
      )
    )
    .all()
    // SQLite's binary collation would put lowercase and accented names last.
    .sort((a, b) => a.siteName.localeCompare(b.siteName));
  for (const { productId, siteActive, ...balance } of rows) {
    const list = result.get(productId) ?? [];
    list.push({ ...balance, siteActive: siteActive === true });
    result.set(productId, list);
  }
  return result;
}

const toSiteStock = ({ siteId, siteName, onHand }: SiteStock): SiteStock => ({
  siteId,
  siteName,
  onHand,
});

/** On-hand of each product at every active site of the tenant, sites without a balance omitted. */
export function getStockBySite(
  db: DatabaseInstance,
  tenantId: string,
  productIds: readonly string[]
): Map<string, SiteStock[]> {
  const result = new Map<string, SiteStock[]>();
  for (const [productId, balances] of selectSiteBalances(db, tenantId, productIds)) {
    const active = balances.filter(balance => balance.siteActive).map(toSiteStock);
    if (active.length > 0) result.set(productId, active);
  }
  return result;
}

/** The other active sites holding stock, most stock first; ties keep site-name order. */
function otherSitesWithStock(balances: readonly SiteBalance[], siteId: string): SiteStock[] {
  return balances
    .filter(balance => balance.siteActive && balance.siteId !== siteId && balance.onHand > 0)
    .sort((a, b) => b.onHand - a.onHand)
    .map(toSiteStock);
}

/**
 * Adds `siteStock` (on-hand at `siteId`, 0 without a balance) and `otherSites`
 * (the other active sites holding stock, most first) to each row with one query. Without a site both
 * are null, matching `withSiteStock`.
 */
export function withSiteStockBreakdown<T extends { id: string }>(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string | undefined,
  rows: readonly T[]
): Array<T & { siteStock: number | null; otherSites: SiteStock[] | null }> {
  if (!siteId) return rows.map(row => ({ ...row, siteStock: null, otherSites: null }));
  const balancesById = selectSiteBalances(
    db,
    tenantId,
    rows.map(row => row.id)
  );
  return rows.map(row => {
    const balances = balancesById.get(row.id) ?? [];
    return {
      ...row,
      siteStock: balances.find(balance => balance.siteId === siteId)?.onHand ?? 0,
      otherSites: otherSitesWithStock(balances, siteId),
    };
  });
}
