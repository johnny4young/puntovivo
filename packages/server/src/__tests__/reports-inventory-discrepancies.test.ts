/**
 * `reports.inventory.discrepancies` integration tests.
 *
 * Auditoría 2026-07 — the denormalized `products.stock` cache was removed;
 * `inventory_balances` is the single source of truth and the tenant-wide total
 * is derived from it on read. "Drift" between a cache and the balances is
 * therefore structurally impossible, and this endpoint always reports an empty
 * discrepancy set. The procedure is retained (a web client + these tests call
 * it), so we assert it stays reachable, permission-gated, and always empty —
 * even when balances are seeded that WOULD have looked like drift under the
 * old two-cache model.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  companies,
  inventoryBalances,
  products,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

interface InvHarness {
  tenantId: string;
  adminId: string;
  managerId: string;
  cashierId: string;
  siteAId: string;
  siteBId: string;
}

async function seedHarness(suffix: string): Promise<InvHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `rinv-tenant-${suffix}`;
  const companyId = `rinv-co-${suffix}`;
  const adminId = `rinv-admin-${suffix}`;
  const managerId = `rinv-mgr-${suffix}`;
  const cashierId = `rinv-csh-${suffix}`;
  const siteAId = `rinv-site-a-${suffix}`;
  const siteBId = `rinv-site-b-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Inv Tenant ${suffix}`,
    slug: `rinv-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `Co ${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values([
    {
      id: siteAId,
      tenantId,
      companyId,
      name: `Sede A ${suffix}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: siteBId,
      tenantId,
      companyId,
      name: `Sede B ${suffix}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${suffix}@example.com`,
      name: `Admin ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: managerId,
      tenantId,
      email: `manager-${suffix}@example.com`,
      name: `Manager ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cashierId,
      tenantId,
      email: `cashier-${suffix}@example.com`,
      name: `Cashier ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantId, adminId, managerId, cashierId, siteAId, siteBId };
}

interface ProductSeed {
  productId: string;
  name: string;
  sku: string;
  cachedStock: number;
  balances: Array<{ siteId: string; onHand: number }>;
}

async function seedProductWithBalances(
  tenantId: string,
  seed: ProductSeed
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.insert(products).values({
    id: seed.productId,
    tenantId,
    name: seed.name,
    sku: seed.sku,
    price: 100,
    price2: 100,
    price3: 100,
    cost: 50,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 19,
    initialCost: 50,
    minStock: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  for (const balance of seed.balances) {
    await db.insert(inventoryBalances).values({
      id: `${seed.productId}-bal-${balance.siteId}`,
      tenantId,
      siteId: balance.siteId,
      productId: seed.productId,
      onHand: balance.onHand,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function buildCtx(
  tenantId: string,
  userId: string,
  role: 'admin' | 'manager' | 'cashier' | 'viewer'
): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: { userId, email: `${userId}@example.com`, role, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: { id: userId, email: `${userId}@example.com`, role, tenantId },
    tenantId,
    siteId: null,
  };
}

describe('reports.inventory.discrepancies (ENG-065b)', () => {
  let harnessA: InvHarness;
  let harnessB: InvHarness;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    harnessA = await seedHarness('a');
    harnessB = await seedHarness('b');

    // Tenant A — three products covering every assertion shape:
    //   ok        : cached=10, sites=[3+7=10] → no drift, NOT surfaced.
    //   driftPos  : cached=20, sites=[5+5=10] → +10 drift (cache too high).
    //   driftNeg  : cached=4,  sites=[3+5=8]  → -4 drift (cache too low).
    //   tiny      : cached=2,  sites=[1.0005+0.9995=2] → 0 within epsilon → NOT surfaced.
    await seedProductWithBalances(harnessA.tenantId, {
      productId: 'rinv-prod-ok',
      name: 'Producto OK',
      sku: 'OK-1',
      cachedStock: 10,
      balances: [
        { siteId: harnessA.siteAId, onHand: 3 },
        { siteId: harnessA.siteBId, onHand: 7 },
      ],
    });
    await seedProductWithBalances(harnessA.tenantId, {
      productId: 'rinv-prod-drift-pos',
      name: 'Drift positiva',
      sku: 'DP-1',
      cachedStock: 20,
      balances: [
        { siteId: harnessA.siteAId, onHand: 5 },
        { siteId: harnessA.siteBId, onHand: 5 },
      ],
    });
    await seedProductWithBalances(harnessA.tenantId, {
      productId: 'rinv-prod-drift-neg',
      name: 'Drift negativa',
      sku: 'DN-1',
      cachedStock: 4,
      balances: [
        { siteId: harnessA.siteAId, onHand: 3 },
        { siteId: harnessA.siteBId, onHand: 5 },
      ],
    });
    await seedProductWithBalances(harnessA.tenantId, {
      productId: 'rinv-prod-tiny',
      name: 'Producto epsilon',
      sku: 'EP-1',
      cachedStock: 2,
      balances: [
        { siteId: harnessA.siteAId, onHand: 1.0005 },
        { siteId: harnessA.siteBId, onHand: 0.9995 },
      ],
    });

    // Tenant B — fixture for cross-tenant isolation. Drift here is
    // huge enough that if it leaked it would dominate the result.
    await seedProductWithBalances(harnessB.tenantId, {
      productId: 'rinv-prod-b-leak',
      name: 'No deberia aparecer',
      sku: 'LEAK-1',
      cachedStock: 999,
      balances: [{ siteId: harnessB.siteAId, onHand: 0 }],
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns zero counters and empty rows for an empty tenant', async () => {
    const empty = await seedHarness('empty');
    const caller = appRouter.createCaller(buildCtx(empty.tenantId, empty.adminId, 'admin'));
    const result = await caller.reports.inventory.discrepancies({ limit: 100 });

    expect(result.summary.productsScanned).toBe(0);
    expect(result.summary.discrepancyCount).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it('allows manager and admin; rejects cashier with FORBIDDEN', async () => {
    const adminCaller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const managerCaller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.managerId, 'manager')
    );
    const cashierCaller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.cashierId, 'cashier')
    );

    await expect(adminCaller.reports.inventory.discrepancies({ limit: 100 })).resolves.toBeDefined();
    await expect(
      managerCaller.reports.inventory.discrepancies({ limit: 100 })
    ).resolves.toBeDefined();
    await expect(
      cashierCaller.reports.inventory.discrepancies({ limit: 100 })
    ).rejects.toThrow(/TRPCError|administrators|managers/i);
  });

  it('returns an empty discrepancy set even when balances would look like drift', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await caller.reports.inventory.discrepancies({ limit: 100 });

    // Drift is structurally impossible now: nothing is ever surfaced.
    expect(result.summary.productsScanned).toBe(0);
    expect(result.summary.discrepancyCount).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it('isolates tenants — tenant A scan never returns tenant B rows', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await caller.reports.inventory.discrepancies({ limit: 100 });
    expect(result.rows.every(row => row.productId !== 'rinv-prod-b-leak')).toBe(true);
  });

  it('always returns an empty set regardless of the limit', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await caller.reports.inventory.discrepancies({ limit: 1 });
    expect(result.rows).toHaveLength(0);
    expect(result.summary.discrepancyCount).toBe(0);
  });
});
