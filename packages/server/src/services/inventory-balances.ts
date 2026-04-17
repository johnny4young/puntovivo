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
 * Resolves the tenant's primary site — the earliest-created active site.
 *
 * Used as the migration anchor for balance seeding and as the fallback site
 * for admin-level mutations that don't carry an explicit site context.
 * Returns `null` when the tenant has no active sites (legacy path).
 */
export function getPrimarySiteId(
  tx: DatabaseInstance,
  tenantId: string
): string | null {
  const primarySite = tx
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .orderBy(asc(sites.createdAt), asc(sites.id))
    .limit(1)
    .get();

  return primarySite?.id ?? null;
}

/**
 * Ensures every active product in the tenant has a balance row on `siteId`.
 *
 * Seed-only semantics (Phase 2 step 1): rows are only created when missing.
 * - Primary site (earliest-created active site) receives `products.stock` as
 *   its initial `on_hand`.
 * - Non-primary sites always receive 0 as their initial `on_hand`.
 *
 * **Not an upsert.** Once a balance row exists, it is owned by the
 * transfer-aware write paths (`transfers.create`, future `sales`/`purchases`
 * integrations). Re-seeding on every read would clobber those writes.
 *
 * Reads and writes run inside the same better-sqlite3 transaction so the
 * "which site is primary" and "which products exist" decisions are consistent
 * with the inserts.
 */
export function ensureInventoryBalancesForSite(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string
): void {
  const now = getTimestamp();

  db.transaction(tx => {
    const primarySiteId = getPrimarySiteId(tx, tenantId);
    const isPrimarySite = primarySiteId === siteId;

    const tenantProducts = tx
      .select({ id: products.id, stock: products.stock })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.isActive, true)))
      .all();

    if (tenantProducts.length === 0) {
      return;
    }

    for (const product of tenantProducts) {
      tx.insert(inventoryBalances)
        .values({
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
        })
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
 * Applies a signed delta (positive = credit, negative = debit) to the
 * (tenantId, siteId, productId) balance row inside an existing transaction.
 *
 * Phase 2 API-103 wires this into `sales.create` / `returnSale` / `void` so
 * the site's `inventory_balances` tracks real POS activity, not just
 * transfers.
 *
 * **Seeding contract.** Callers that touch `products.stock` in the same
 * transaction must pass `initialOnHandIfMissing` as the PRE-delta stock
 * snapshot they captured before mutating it. Without that, seeding would
 * read `products.stock` after the caller's update and apply the delta on
 * top of an already-decremented value (double-count). When
 * `initialOnHandIfMissing` is omitted, the helper uses the primary-site
 * migration rule (current `products.stock` for the primary site, 0 for
 * everyone else) — safe for callers that do NOT mutate `products.stock`.
 *
 * Returns the final `onHand` value written to the row or `null` when the
 * call is a no-op.
 *
 * No-op cases:
 *   - `siteId` is falsy (legacy/pre-site sales) — returns `null`.
 *   - `delta` is 0 or not finite — returns `null`.
 *
 * Does NOT enforce non-negative balances; stock validation is the caller's
 * responsibility earlier in the pipeline.
 */
export function applyInventoryBalanceDelta(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string | null | undefined;
    productId: string;
    delta: number;
    /**
     * Optional pre-delta `on_hand` snapshot for seeding a missing row. Use
     * this when the caller is mutating `products.stock` in the same
     * transaction — otherwise the default seed would read the post-mutation
     * value and the delta would double-count.
     */
    initialOnHandIfMissing?: number;
    now?: string;
  }
): number | null {
  if (!args.siteId) {
    return null;
  }
  if (!Number.isFinite(args.delta) || args.delta === 0) {
    return null;
  }

  const now = args.now ?? getTimestamp();

  // Resolve the seed value. Explicit caller snapshot wins; otherwise fall
  // back to the primary-site migration rule.
  let seedOnHand: number;
  if (args.initialOnHandIfMissing !== undefined) {
    seedOnHand = args.initialOnHandIfMissing;
  } else if (getPrimarySiteId(tx, args.tenantId) === args.siteId) {
    const productStock = tx
      .select({ stock: products.stock })
      .from(products)
      .where(and(eq(products.tenantId, args.tenantId), eq(products.id, args.productId)))
      .get();
    seedOnHand = productStock?.stock ?? 0;
  } else {
    seedOnHand = 0;
  }

  tx.insert(inventoryBalances)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      siteId: args.siteId,
      productId: args.productId,
      onHand: seedOnHand,
      reserved: 0,
      syncStatus: 'pending',
      syncVersion: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        inventoryBalances.tenantId,
        inventoryBalances.siteId,
        inventoryBalances.productId,
      ],
    })
    .run();

  const existing = tx
    .select({ onHand: inventoryBalances.onHand })
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.tenantId, args.tenantId),
        eq(inventoryBalances.siteId, args.siteId),
        eq(inventoryBalances.productId, args.productId)
      )
    )
    .get();

  const nextOnHand = (existing?.onHand ?? seedOnHand) + args.delta;

  tx.update(inventoryBalances)
    .set({
      onHand: nextOnHand,
      syncStatus: 'pending',
      updatedAt: now,
    })
    .where(
      and(
        eq(inventoryBalances.tenantId, args.tenantId),
        eq(inventoryBalances.siteId, args.siteId),
        eq(inventoryBalances.productId, args.productId)
      )
    )
    .run();

  return nextOnHand;
}

/**
 * Ensures the primary site's row exists for `productId` with the supplied
 * pre-delta aggregate snapshot. This prevents a later first read from seeding
 * the primary site from an already-mutated `products.stock` value after stock
 * was received directly into a non-primary site.
 */
export function ensurePrimaryInventoryBalanceSnapshot(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    productId: string;
    onHandSnapshot: number;
    now?: string;
  }
): string | null {
  const primarySiteId = getPrimarySiteId(tx, args.tenantId);
  if (!primarySiteId) {
    return null;
  }

  const now = args.now ?? getTimestamp();

  tx.insert(inventoryBalances)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      siteId: primarySiteId,
      productId: args.productId,
      onHand: args.onHandSnapshot,
      reserved: 0,
      syncStatus: 'pending',
      syncVersion: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        inventoryBalances.tenantId,
        inventoryBalances.siteId,
        inventoryBalances.productId,
      ],
    })
    .run();

  return primarySiteId;
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
