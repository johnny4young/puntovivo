import { and, asc, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import { inventoryBalances, products, sites } from '../db/schema.js';

/**
 * Service helpers for Phase 2 DB-101 / API-101 — per-site inventory balances.
 *
 * Phase 2 step 0 introduces inventory_balances as an additive projection of
 * tenant-wide `products.stock`. Until transfers and site-scoped write paths
 * land, the table is seeded lazily from current stock so the new listing is
 * never dead and never contradicts reality:
 *
 *   - "Primary" site (earliest created active site) receives the full current
 *     `products.stock` value.
 *   - Every other active site starts at 0.
 *   - New products added later get a 0 row on demand the first time the site
 *     is listed.
 *
 * This keeps the Phase 1 single-stock behaviour intact while exposing the
 * new read surface required by UI-101.
 */

export interface InventoryBalanceListItem {
  id: string;
  tenantId: string;
  siteId: string;
  productId: string;
  productName: string;
  productSku: string;
  onHand: number;
  reserved: number;
  available: number;
  minStock: number;
  isLowStock: boolean;
  updatedAt: string;
}

function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Ensures every active product in the tenant has a balance row on `siteId`.
 * - Primary site (earliest-created active site) receives `products.stock` as
 *   its `on_hand`.
 * - Non-primary sites always receive 0 when first seeded (transfers move
 *   stock in later).
 *
 * Idempotent:
 * - Primary site upserts `on_hand` so it keeps mirroring `products.stock`
 *   until transfer-aware writes land.
 * - Non-primary sites only insert missing zero rows against the unique
 *   (tenant_id, site_id, product_id) index.
 *
 * Reads and writes run inside the same better-sqlite3 transaction so the
 * "which site is primary" and "which products exist" decisions are consistent
 * with the inserts. The caller must await this before running read helpers so
 * the two reads do not independently race through the seeding path.
 */
export function ensureInventoryBalancesForSite(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string
): void {
  const now = getTimestamp();

  db.transaction(tx => {
    const primarySite = tx
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .orderBy(asc(sites.createdAt), asc(sites.id))
      .limit(1)
      .get();
    const isPrimarySite = primarySite?.id === siteId;

    const tenantProducts = tx
      .select({ id: products.id, stock: products.stock })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.isActive, true)))
      .all();

    if (tenantProducts.length === 0) {
      return;
    }

    for (const product of tenantProducts) {
      const insertQuery = tx.insert(inventoryBalances).values({
        id: nanoid(),
        tenantId,
        siteId,
        productId: product.id,
        onHand: isPrimarySite ? product.stock : 0,
        reserved: 0,
        syncStatus: 'pending',
        syncVersion: 0,
        createdAt: now,
        updatedAt: now,
      });

      if (isPrimarySite) {
        insertQuery
          .onConflictDoUpdate({
            target: [
              inventoryBalances.tenantId,
              inventoryBalances.siteId,
              inventoryBalances.productId,
            ],
            set: {
              onHand: product.stock,
              updatedAt: now,
            },
          })
          .run();
        continue;
      }

      insertQuery
        .onConflictDoNothing({
          target: [
            inventoryBalances.tenantId,
            inventoryBalances.siteId,
            inventoryBalances.productId,
          ],
        })
        .run();
    }
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

export interface InventoryBalancesSummary {
  totalOnHand: number;
  totalReserved: number;
  totalAvailable: number;
  lowStockCount: number;
  productsTracked: number;
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
