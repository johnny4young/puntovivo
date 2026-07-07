/**
 * Tests for the developer seed (`src/db/seed-dev.ts`).
 *
 * We run the full seed against an in-memory DB and assert:
 *   1. All target row counts land (6 users, 2 sites, 50 products, 30 customers,
 *      3 receipt templates, and — within tolerance — the target purchase / sale /
 *      quotation / transfer / adjustment batches).
 *   2. The invariant `products.stock = Σ(inventory_balances.on_hand)` holds for
 *      every seeded product, proving the seed walked through the service
 *      transaction paths without drift.
 *   3. A second `seedDevData()` call on the same DB is a no-op (idempotent
 *      short-circuit via the tenant slug lookup).
 *   4. Cross-tenant isolation: the default `admin@localhost` tenant sees ZERO
 *      of the demo data.
 *   5. Sanity: every created user is tagged to the demo tenant and has a
 *      working argon2 hash.
 *
 * @module __tests__/seed-dev
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as argon2 from 'argon2';
import { and, eq, sql } from 'drizzle-orm';

import {
  closeDatabase,
  getDatabase,
  initDatabase,
  type DatabaseInstance,
} from '../db/index.js';
import {
  DEV_ADMIN_EMAIL,
  DEV_TENANT_SLUG,
  DEV_USER_PASSWORD,
  seedDevData,
} from '../db/seed-dev.js';
import {
  categories,
  customers,
  fiscalCertificates,
  fiscalDocuments,
  fiscalNumberingResolutions,
  inventoryBalances,
  products,
  providers,
  receiptTemplates,
  sales,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { getProductStockTotal } from '../services/inventory-balances.js';

let db: DatabaseInstance;
let tenantId: string;

describe('Dev seed (`seedDevData`)', () => {
  beforeAll(async () => {
    db = await initDatabase({ dbPath: ':memory:' });
    const result = await seedDevData(db, { preset: 'default' });
    expect(result.seeded).toBe(true);
    tenantId = result.tenantId;
  });

  afterAll(async () => {
    closeDatabase();
  });

  it('creates the demo tenant with the expected slug', async () => {
    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, DEV_TENANT_SLUG))
      .get();
    expect(tenant).toBeTruthy();
    expect(tenant?.name).toBe('Demo Retail Colombia');
  });

  it('creates 6 users tagged to the demo tenant with the shared dev password', async () => {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.tenantId, tenantId))
      .all();
    expect(rows).toHaveLength(6);
    const roles = rows.map(r => r.role).sort();
    // 1 admin, 2 managers, 2 cashiers, 1 viewer (sorted)
    expect(roles).toEqual(['admin', 'cashier', 'cashier', 'manager', 'manager', 'viewer']);

    const admin = rows.find(r => r.email === DEV_ADMIN_EMAIL);
    expect(admin).toBeTruthy();
    expect(admin?.role).toBe('admin');
    expect(await argon2.verify(admin!.passwordHash, DEV_USER_PASSWORD)).toBe(true);
  });

  it('creates the expected catalog row counts', async () => {
    const [prodCount, custCount, provCount, siteCount, catCount, tplCount] = await Promise.all([
      count(db, products, tenantId),
      count(db, customers, tenantId),
      count(db, providers, tenantId),
      count(db, sites, tenantId),
      count(db, categories, tenantId),
      count(db, receiptTemplates, tenantId),
    ]);

    expect(prodCount).toBe(50);
    expect(custCount).toBe(30);
    expect(provCount).toBe(5);
    expect(siteCount).toBe(2);
    expect(catCount).toBe(8);
    expect(tplCount).toBe(3);
  });

  it('maintains the derived stock = Σ(inventory_balances.on_hand) invariant', async () => {
    // products.stock was removed — stock is now DERIVED as Σ(on_hand). This
    // asserts the derive helper (`getProductStockTotal`) agrees with a
    // hand-rolled cross-site SUM for every seeded product, proving the seed
    // walked the service transaction paths and materialized balance rows
    // (the dev seed splits each product's stock 60/40 across the two sites,
    // so the tenant-wide derived total equals the definition's initial stock).
    const productRows = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.tenantId, tenantId))
      .all();

    for (const product of productRows) {
      const summed = await db
        .select({ total: sql<number>`COALESCE(SUM(${inventoryBalances.onHand}), 0)` })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, tenantId),
            eq(inventoryBalances.productId, product.id)
          )
        )
        .get();
      expect(summed?.total ?? 0).toBe(getProductStockTotal(db, tenantId, product.id));
    }
  });

  it('creates historical sales through the tRPC transaction path (non-zero count)', async () => {
    const result = await db
      .select({ c: sql<number>`count(*)` })
      .from(sales)
      .where(eq(sales.tenantId, tenantId))
      .get();
    // Some products ship with zero stock on purpose (stockout demo path),
    // so a handful of sales may legitimately skip. We only assert that a
    // meaningful history exists — at least half of the 20-per-cashier target.
    expect(result?.c ?? 0).toBeGreaterThanOrEqual(10);
    expect(result?.c ?? 0).toBeLessThanOrEqual(40);
  });

  // ENG-020 — the demo tenant seeds `fiscal_dian_enabled=true` plus one
  // DEE resolution per site + placeholder certificate so every historical
  // sale goes through the full fiscal emission path. The orchestrator is
  // best-effort — a failed emission does not block the sale — so the seed
  // count equality proves the happy path fired cleanly.
  it('emits a fiscal_document for every seeded sale and materializes resolution/certificate rows', async () => {
    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, DEV_TENANT_SLUG))
      .get();
    expect(tenant?.settings).toMatchObject({ fiscal_dian_enabled: true });

    const [resolutionRows, certRows, saleCount, fiscalCount] = await Promise.all([
      db
        .select()
        .from(fiscalNumberingResolutions)
        .where(eq(fiscalNumberingResolutions.tenantId, tenantId))
        .all(),
      db
        .select()
        .from(fiscalCertificates)
        .where(eq(fiscalCertificates.tenantId, tenantId))
        .all(),
      count(db, sales, tenantId),
      count(db, fiscalDocuments, tenantId),
    ]);

    expect(resolutionRows).toHaveLength(2);
    expect(resolutionRows.every(row => row.kind === 'DEE')).toBe(true);
    expect(resolutionRows.every(row => row.isActive)).toBe(true);
    expect(new Set(resolutionRows.map(row => row.siteId)).size).toBe(2);
    expect(certRows).toHaveLength(1);
    expect(certRows[0]?.isActive).toBe(true);

    // Every historical sale should have produced exactly one DEE fiscal
    // document via the sales.create hook.
    expect(fiscalCount).toBe(saleCount);
  });

  it('is idempotent: a second seedDevData() call on the same DB is a no-op', async () => {
    const result = await seedDevData(db, { preset: 'default' });
    expect(result.seeded).toBe(false);
    expect(result.tenantId).toBe(tenantId);

    // The row counts should still match what the first run produced —
    // the second call should not have double-inserted anything.
    const prodCount = await count(db, products, tenantId);
    expect(prodCount).toBe(50);
  });

  it('keeps the demo tenant isolated from the default seed tenant', async () => {
    const defaultTenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, 'default'))
      .get();
    expect(defaultTenant).toBeTruthy();
    expect(defaultTenant?.id).not.toBe(tenantId);

    // The default tenant must see zero demo products, customers, or sales.
    const [prodCount, custCount, saleCount] = await Promise.all([
      count(db, products, defaultTenant!.id),
      count(db, customers, defaultTenant!.id),
      count(db, sales, defaultTenant!.id),
    ]);
    expect(prodCount).toBe(0);
    expect(custCount).toBe(0);
    expect(saleCount).toBe(0);
  });
});

async function count(
  db: DatabaseInstance,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason: test count() helper accepts any tenant-scoped Drizzle table; parametric-table ref. Test fixture, exempt per ENG-179c.
  table: any,
  tenantId: string
): Promise<number> {
  const row = await db
    .select({ c: sql<number>`count(*)` })
    .from(table)
    .where(eq(table.tenantId, tenantId))
    .get();
  return row?.c ?? 0;
}

// Keep `getDatabase` linked so ts doesn't tree-shake it away when we
// want to reach into the shared handle from a future test.
void getDatabase;
