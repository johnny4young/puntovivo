import { and, asc, eq, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryBalances, products } from '../../db/schema.js';
import type {
  InventoryBalanceListItem,
  InventoryBalancesSummary,
  InventoryDiscrepancyRow,
} from './types.js';

/**
 * ENG-065b — Read-only discrepancy detector, retired by the single-source
 * unification (Auditoría 2026-07).
 *
 * Discrepancies used to mean drift between the denormalized `products.stock`
 * cache and `Σ(inventory_balances.on_hand)`. That column has been removed:
 * `inventory_balances` is now the single source of truth and the tenant-wide
 * total is derived from it on read, so drift is structurally impossible.
 * This helper therefore always resolves to an empty list. It is retained
 * (rather than deleted) because a web client and tests still call the report
 * procedure that wraps it.
 */
export async function listInventoryDiscrepancyCandidates(
  _db: DatabaseInstance,
  _tenantId: string
): Promise<InventoryDiscrepancyRow[]> {
  return [];
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
