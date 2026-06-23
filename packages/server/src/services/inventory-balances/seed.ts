import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryBalances, products } from '../../db/schema.js';
import { getPrimarySiteId, getTimestamp } from './helpers.js';

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

    // ENG-177a — chunked multi-row insert. The previous per-product
    // `forEach` issued one INSERT per row, which on a 50k-product tenant
    // held the write lock for >1s during site onboarding. A single
    // `.values([...])` insert is one statement per chunk. 10 bound columns
    // per row, so 90 rows stays well under SQLITE_MAX_VARIABLE_NUMBER (999).
    // `onConflictDoNothing` preserves the seed-only contract: rows already
    // owned by the transfer-aware write paths are never clobbered.
    const CHUNK_SIZE = 90;
    const rows = tenantProducts.map(product => ({
      id: nanoid(),
      tenantId,
      siteId,
      productId: product.id,
      onHand: isPrimarySite ? product.stock : 0,
      reserved: 0,
      syncStatus: 'pending' as const,
      syncVersion: 0,
      createdAt: now,
      updatedAt: now,
    }));

    for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
      tx.insert(inventoryBalances)
        .values(rows.slice(offset, offset + CHUNK_SIZE))
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
      target: [inventoryBalances.tenantId, inventoryBalances.siteId, inventoryBalances.productId],
    })
    .run();

  return primarySiteId;
}
