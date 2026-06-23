import { and, asc, eq, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryBalances, products } from '../../db/schema.js';
import type {
  InventoryBalanceListItem,
  InventoryBalancesSummary,
  InventoryDiscrepancyRow,
} from './types.js';

/**
 * ENG-065b — Read-only mirror of `reconcileProductStockFromBalances`.
 *
 * Detects drift between the cached `products.stock` total and
 * `Σ(inventory_balances.on_hand)` for every product in the tenant —
 * the same drift the reconcile mutation heals. Returns a flat row per
 * (tenant, product) with the cached value, the recomputed sum, and
 * the per-site span.
 *
 * Lives here (not in `routers/reports/`) because the architectural
 * lint forbids the reports surface from importing `products` directly
 * (ENG-020 fiscal immutability invariant). The router calls this
 * helper and applies the epsilon filter + ordering + limit on the
 * returned rows.
 */
export async function listInventoryDiscrepancyCandidates(
  db: DatabaseInstance,
  tenantId: string
): Promise<InventoryDiscrepancyRow[]> {
  const sumExpr = sql<number>`COALESCE(SUM(${inventoryBalances.onHand}), 0)`;
  const siteCountExpr = sql<number>`COUNT(${inventoryBalances.id})`;

  const rows = await db
    .select({
      productId: products.id,
      productName: products.name,
      productSku: products.sku,
      cachedStock: products.stock,
      sumOfBalances: sumExpr,
      siteCount: siteCountExpr,
    })
    .from(products)
    .leftJoin(
      inventoryBalances,
      and(eq(inventoryBalances.productId, products.id), eq(inventoryBalances.tenantId, tenantId))
    )
    .where(eq(products.tenantId, tenantId))
    .groupBy(products.id)
    .all();

  return rows.map(row => {
    const cachedStock = Number(row.cachedStock ?? 0);
    const sumOfBalances = Number(row.sumOfBalances ?? 0);
    return {
      productId: row.productId,
      productName: row.productName,
      productSku: row.productSku ?? null,
      cachedStock,
      sumOfBalances,
      delta: cachedStock - sumOfBalances,
      siteCount: Number(row.siteCount ?? 0),
    };
  });
}

/**
 * Lists all balances for a site, joined to product metadata.
 *
 * Does NOT seed — call `ensureInventoryBalancesForSite` first so this stays a
 * pure read and composes with other read helpers under `Promise.all`.
 */
export async function listInventoryBalancesBySite(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string
): Promise<InventoryBalanceListItem[]> {
  const rows = await db
    .select({
      id: inventoryBalances.id,
      tenantId: inventoryBalances.tenantId,
      siteId: inventoryBalances.siteId,
      productId: inventoryBalances.productId,
      productName: products.name,
      productSku: products.sku,
      onHand: inventoryBalances.onHand,
      reserved: inventoryBalances.reserved,
      minStock: products.minStock,
      updatedAt: inventoryBalances.updatedAt,
    })
    .from(inventoryBalances)
    .innerJoin(products, eq(inventoryBalances.productId, products.id))
    .where(
      and(
        eq(inventoryBalances.tenantId, tenantId),
        eq(inventoryBalances.siteId, siteId),
        eq(products.isActive, true)
      )
    )
    .orderBy(asc(products.name))
    .all();

  return rows.map(row => {
    const available = Math.max(row.onHand - row.reserved, 0);
    return {
      ...row,
      available,
      isLowStock: row.onHand <= row.minStock,
    };
  });
}

export async function summarizeInventoryBalances(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string
): Promise<InventoryBalancesSummary> {
  const summary = await db
    .select({
      totalOnHand: sql<number>`coalesce(sum(${inventoryBalances.onHand}), 0)`,
      totalReserved: sql<number>`coalesce(sum(${inventoryBalances.reserved}), 0)`,
      lowStockCount: sql<number>`coalesce(sum(case when ${inventoryBalances.onHand} <= ${products.minStock} then 1 else 0 end), 0)`,
      productsTracked: sql<number>`count(*)`,
    })
    .from(inventoryBalances)
    .innerJoin(products, eq(inventoryBalances.productId, products.id))
    .where(
      and(
        eq(inventoryBalances.tenantId, tenantId),
        eq(inventoryBalances.siteId, siteId),
        eq(products.isActive, true)
      )
    )
    .get();

  const totalOnHand = summary?.totalOnHand ?? 0;
  const totalReserved = summary?.totalReserved ?? 0;

  return {
    totalOnHand,
    totalReserved,
    totalAvailable: Math.max(totalOnHand - totalReserved, 0),
    lowStockCount: summary?.lowStockCount ?? 0,
    productsTracked: summary?.productsTracked ?? 0,
  };
}
