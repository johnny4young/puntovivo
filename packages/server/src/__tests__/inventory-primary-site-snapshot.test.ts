/**
 * Opening the primary site's balance row must not invent stock.
 *
 * `ensurePrimaryInventoryBalanceSnapshot` materializes the primary site's
 * `inventory_balances` row the first time stock moves at a NON-primary site.
 * It exists because of the pre-balances model, where a tenant's whole stock
 * was implicitly held at the primary site: writing another site's row without
 * first pinning the primary's holding would have dropped it from the total.
 *
 * Migration `0008` ended that model. `product_stock_totals` is now maintained
 * exclusively by triggers over `inventory_balances`, and its backfill was
 * `SUM(on_hand)`, so the invariant `total ≡ Σ(on_hand)` has held since. Under
 * that invariant a primary site with NO balance row holds exactly zero — the
 * whole total is accounted for by the other sites' rows.
 *
 * Seeding it with the tenant-wide total therefore adds every other site's
 * stock to the primary a second time. The rollup parity test cannot see this:
 * the trigger recomputes the total from the balances, so `total ≡ Σ(on_hand)`
 * still holds afterwards. Only physical reality disagrees.
 *
 * @module __tests__/inventory-primary-site-snapshot.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { companies, inventoryBalances, products, sites, tenants } from '../db/schema.js';
import { applyInventoryBalanceDelta } from '../services/inventory-balances/apply-delta.js';
import { ensurePrimaryInventoryBalanceSnapshot } from '../services/inventory-balances/seed.js';
import { getProductStockTotal } from '../services/inventory-balances/derive.js';

let server: PuntovivoServer;
let tenantId: string;
let primarySiteId: string;
let branchSiteId: string;
let productId: string;

/** Every balance row for the product, keyed by site. */
function balancesBySite(): Map<string, number> {
  const rows = getDatabase()
    .select({ siteId: inventoryBalances.siteId, onHand: inventoryBalances.onHand })
    .from(inventoryBalances)
    .where(
      and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.productId, productId))
    )
    .all();
  return new Map(rows.map(row => [row.siteId, row.onHand]));
}

function tenantTotal(): number {
  return getProductStockTotal(getDatabase(), tenantId, productId);
}

describe('primary-site balance snapshot', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    tenantId = nanoid();
    const companyId = nanoid();
    primarySiteId = nanoid();
    branchSiteId = nanoid();
    productId = nanoid();

    await db.insert(tenants).values({ id: tenantId, name: 'Snapshot', slug: `snap-${nanoid(6)}` });
    await db.insert(companies).values({ id: companyId, tenantId, name: 'Snapshot' });
    // The primary slot goes to the earliest site.
    await db
      .insert(sites)
      .values({ id: primarySiteId, tenantId, companyId, name: 'Primary', createdAt: now });
    await db.insert(sites).values({
      id: branchSiteId,
      tenantId,
      companyId,
      name: 'Branch',
      createdAt: new Date(Date.now() + 1000).toISOString(),
    });
    await db
      .insert(products)
      .values({ id: productId, tenantId, name: 'Widget', sku: `SKU-${nanoid(6)}` });
  });

  it('opens the primary at zero when the branch already holds the whole total', () => {
    const db = getDatabase();
    // Eleven physical units, all at the branch. The primary has no row, which
    // under the post-0008 invariant means it holds nothing.
    applyInventoryBalanceDelta(db, {
      tenantId,
      siteId: branchSiteId,
      productId,
      delta: 11,
    });
    expect(tenantTotal()).toBe(11);
    expect(balancesBySite().has(primarySiteId)).toBe(false);

    ensurePrimaryInventoryBalanceSnapshot(db, { tenantId, productId });

    // The row now exists so later per-site writes have something to land on,
    // but it must carry nothing: no units were created by opening a row.
    const balances = balancesBySite();
    expect(balances.get(primarySiteId)).toBe(0);
    expect(balances.get(branchSiteId)).toBe(11);
    expect(tenantTotal(), 'opening a balance row invented stock').toBe(11);
  });

  it('leaves the total alone across the branch receipt that triggers it', () => {
    const db = getDatabase();
    applyInventoryBalanceDelta(db, { tenantId, siteId: branchSiteId, productId, delta: 10 });

    // What every caller does: pin the primary, then apply the delta at the
    // site the stock actually moved at.
    ensurePrimaryInventoryBalanceSnapshot(db, { tenantId, productId });
    applyInventoryBalanceDelta(db, { tenantId, siteId: branchSiteId, productId, delta: 1 });

    expect(tenantTotal()).toBe(11);
    expect(balancesBySite().get(primarySiteId)).toBe(0);
    expect(balancesBySite().get(branchSiteId)).toBe(11);
  });

  it('never clobbers a primary row that already carries stock', () => {
    const db = getDatabase();
    applyInventoryBalanceDelta(db, { tenantId, siteId: primarySiteId, productId, delta: 4 });
    applyInventoryBalanceDelta(db, { tenantId, siteId: branchSiteId, productId, delta: 7 });
    expect(tenantTotal()).toBe(11);

    ensurePrimaryInventoryBalanceSnapshot(db, { tenantId, productId });

    // Seed-only semantics: an existing row is owned by the mutation paths.
    expect(balancesBySite().get(primarySiteId)).toBe(4);
    expect(tenantTotal()).toBe(11);
  });

  it('is idempotent', () => {
    const db = getDatabase();
    applyInventoryBalanceDelta(db, { tenantId, siteId: branchSiteId, productId, delta: 11 });
    ensurePrimaryInventoryBalanceSnapshot(db, { tenantId, productId });
    ensurePrimaryInventoryBalanceSnapshot(db, { tenantId, productId });
    ensurePrimaryInventoryBalanceSnapshot(db, { tenantId, productId });
    expect(tenantTotal()).toBe(11);
    expect(balancesBySite().size).toBe(2);
  });

  it('reports the primary site it opened, and nothing when there is none', async () => {
    const db = getDatabase();
    expect(ensurePrimaryInventoryBalanceSnapshot(db, { tenantId, productId })).toBe(primarySiteId);

    // A tenant with no site at all: the caller has nothing to pin, and must
    // not be handed an id that does not exist.
    const emptyTenant = nanoid();
    await db
      .insert(tenants)
      .values({ id: emptyTenant, name: 'No sites', slug: `none-${nanoid(6)}` });
    expect(
      ensurePrimaryInventoryBalanceSnapshot(db, { tenantId: emptyTenant, productId })
    ).toBeNull();
  });
});
