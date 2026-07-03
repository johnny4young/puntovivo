import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryBalances, products } from '../../db/schema.js';
import { getPrimarySiteId, getTimestamp } from './helpers.js';

/**
 * Service helpers for Phase 2 DB-101 / API-101 — per-site inventory balances.
 *
 * `inventory_balances` is the single source of truth for stock (Auditoría
 * 2026-07). This helper lazily materializes a 0-on_hand row for any active
 * product that has no balance on `siteId` yet, so the per-site listing is
 * never dead. Actual opening quantities are written by the mutation paths
 * (product create seeding, entries, adjustments, transfers), never here.
 */

/**
 * Ensures every active product in the tenant has a balance row on `siteId`.
 *
 * Seed-only semantics: rows are only created when missing, always with an
 * initial `on_hand` of 0. Real quantities come from the mutation paths.
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
    const tenantProducts = tx
      .select({ id: products.id })
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
      onHand: 0,
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
 * pre-delta aggregate snapshot. This pins the primary site's opening on_hand
 * before stock is received directly into a non-primary site, so the derived
 * tenant-wide total stays consistent.
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
