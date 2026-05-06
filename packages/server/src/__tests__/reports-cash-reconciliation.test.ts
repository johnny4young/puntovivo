/**
 * ENG-065b — `reports.cash.reconciliation` integration tests.
 *
 * Verifies the tenant-wide cash reconciliation surface that drives the
 * Operations Center Cash tab. Coverage:
 *
 *   - empty tenant returns zero summary + empty arrays.
 *   - manager allowed; cashier FORBIDDEN; admin allowed.
 *   - open sessions across multiple sites aggregate into the summary.
 *   - mixed signed overShort closures sum correctly + largest |overShort|.
 *   - bySite aggregation has one row per site touched.
 *   - cross-tenant isolation — tenant B sessions don't leak.
 *   - limit clamps `recentDiscrepancies` length.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  companies,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

interface CashHarness {
  tenantId: string;
  adminId: string;
  managerId: string;
  cashierId: string;
  siteAId: string;
  siteBId: string;
}

async function seedCashHarness(suffix: string): Promise<CashHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `rcash-tenant-${suffix}`;
  const companyId = `rcash-co-${suffix}`;
  const adminId = `rcash-admin-${suffix}`;
  const managerId = `rcash-mgr-${suffix}`;
  const cashierId = `rcash-csh-${suffix}`;
  const siteAId = `rcash-site-a-${suffix}`;
  const siteBId = `rcash-site-b-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Cash Tenant ${suffix}`,
    slug: `rcash-${suffix}`,
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

interface SessionSeed {
  id: string;
  siteId: string;
  cashierId: string;
  status: 'open' | 'closed';
  overShort?: number;
  expectedBalance?: number;
  actualCount?: number;
  closedAt?: string;
}

async function insertSessions(
  tenantId: string,
  rows: SessionSeed[]
): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  for (const row of rows) {
    await db.insert(cashSessions).values({
      id: row.id,
      tenantId,
      siteId: row.siteId,
      cashierId: row.cashierId,
      registerName: 'register-1',
      openingFloat: 0,
      openingCountDenominations: [],
      expectedBalance: row.expectedBalance ?? 0,
      actualCount: row.actualCount ?? null,
      overShort: row.overShort ?? null,
      status: row.status,
      openedAt: now,
      closedAt: row.closedAt ?? (row.status === 'closed' ? now : null),
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

describe('reports.cash.reconciliation (ENG-065b)', () => {
  let harnessA: CashHarness;
  let harnessB: CashHarness;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    harnessA = await seedCashHarness('a');
    harnessB = await seedCashHarness('b');

    // Tenant A — fixture covers every assertion shape:
    //   2 open sessions across 2 sites
    //   3 closed in window: +5.00 overShort (siteA), -3.50 (siteB), +0.10 (siteA, below epsilon)
    //   1 closed OUTSIDE 30-day window (older than cutoff) — should not appear
    await insertSessions(harnessA.tenantId, [
      {
        id: 'rcash-open-a-1',
        siteId: harnessA.siteAId,
        cashierId: harnessA.cashierId,
        status: 'open',
      },
      {
        id: 'rcash-open-a-2',
        siteId: harnessA.siteBId,
        cashierId: harnessA.cashierId,
        status: 'open',
      },
      {
        id: 'rcash-closed-a-1',
        siteId: harnessA.siteAId,
        cashierId: harnessA.cashierId,
        status: 'closed',
        expectedBalance: 200,
        actualCount: 205,
        overShort: 5,
      },
      {
        id: 'rcash-closed-a-2',
        siteId: harnessA.siteBId,
        cashierId: harnessA.cashierId,
        status: 'closed',
        expectedBalance: 100,
        actualCount: 96.5,
        overShort: -3.5,
      },
      {
        id: 'rcash-closed-a-3',
        siteId: harnessA.siteAId,
        cashierId: harnessA.cashierId,
        status: 'closed',
        expectedBalance: 50,
        actualCount: 50.1,
        overShort: 0.1, // above 0.009 epsilon — counted
      },
      {
        // Outside the 30-day window — should be excluded.
        id: 'rcash-closed-a-old',
        siteId: harnessA.siteAId,
        cashierId: harnessA.cashierId,
        status: 'closed',
        expectedBalance: 1000,
        actualCount: 999,
        overShort: -1,
        closedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);

    // Tenant B — control fixture for cross-tenant isolation. The
    // overShort here is large enough that if it leaked into A's
    // aggregation the assertions would fail.
    await insertSessions(harnessB.tenantId, [
      {
        id: 'rcash-closed-b-1',
        siteId: harnessB.siteAId,
        cashierId: harnessB.cashierId,
        status: 'closed',
        expectedBalance: 999,
        actualCount: 999,
        overShort: 999,
      },
    ]);
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns zero counters and empty arrays for a tenant with no sessions', async () => {
    const empty = await seedCashHarness('empty');
    const caller = appRouter.createCaller(buildCtx(empty.tenantId, empty.adminId, 'admin'));
    const result = await caller.reports.cash.reconciliation({ limit: 20 });

    expect(result.summary.openSessionCount).toBe(0);
    expect(result.summary.closedRecentCount).toBe(0);
    expect(result.summary.reviewCount).toBe(0);
    expect(result.summary.netOverShort).toBe(0);
    expect(result.summary.largestDiscrepancy).toBe(0);
    expect(result.bySite).toEqual([]);
    expect(result.recentDiscrepancies).toEqual([]);
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

    await expect(adminCaller.reports.cash.reconciliation({ limit: 20 })).resolves.toBeDefined();
    await expect(managerCaller.reports.cash.reconciliation({ limit: 20 })).resolves.toBeDefined();
    await expect(cashierCaller.reports.cash.reconciliation({ limit: 20 })).rejects.toThrow(
      /TRPCError|administrators|managers/i
    );
  });

  it('aggregates open sessions across every site in the tenant', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await caller.reports.cash.reconciliation({ limit: 20 });
    expect(result.summary.openSessionCount).toBe(2);
  });

  it('sums overShort signed and surfaces largest absolute discrepancy', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await caller.reports.cash.reconciliation({ limit: 20 });

    // Closed in window: 5 + (-3.5) + 0.1 = 1.6
    expect(result.summary.closedRecentCount).toBe(3);
    expect(result.summary.netOverShort).toBeCloseTo(1.6, 2);
    // Largest absolute = 5
    expect(result.summary.largestDiscrepancy).toBeCloseTo(5, 2);
    // All three closures have |overShort| > 0.009 → reviewCount = 3.
    expect(result.summary.reviewCount).toBe(3);
  });

  it('groups closed sessions per site and reports overShort counts', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await caller.reports.cash.reconciliation({ limit: 20 });

    expect(result.bySite).toHaveLength(2);
    const siteA = result.bySite.find(row => row.siteId === harnessA.siteAId);
    const siteB = result.bySite.find(row => row.siteId === harnessA.siteBId);
    expect(siteA).toBeDefined();
    expect(siteB).toBeDefined();
    // Site A: 1 open + 2 closed in window (+5 and +0.1).
    expect(siteA?.openSessions).toBe(1);
    expect(siteA?.closedSessions).toBe(2);
    expect(siteA?.netOverShort).toBeCloseTo(5.1, 2);
    expect(siteA?.overShortCount).toBe(2);
    // Site B: 1 open + 1 closed (-3.5).
    expect(siteB?.openSessions).toBe(1);
    expect(siteB?.closedSessions).toBe(1);
    expect(siteB?.netOverShort).toBeCloseTo(-3.5, 2);
    expect(siteB?.overShortCount).toBe(1);
  });

  it('orders recentDiscrepancies by absolute overShort and excludes the old row', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await caller.reports.cash.reconciliation({ limit: 20 });

    expect(result.recentDiscrepancies).toHaveLength(3);
    const ids = result.recentDiscrepancies.map(row => row.sessionId);
    // Ordered by |overShort|: 5, 3.5, 0.1
    expect(ids).toEqual(['rcash-closed-a-1', 'rcash-closed-a-2', 'rcash-closed-a-3']);
    // Old row outside the window must be excluded.
    expect(ids).not.toContain('rcash-closed-a-old');
  });

  it('isolates tenants — tenant A admin sees zero of tenant B fixtures', async () => {
    const callerA = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await callerA.reports.cash.reconciliation({ limit: 20 });
    // None of the bySite rows should belong to tenant B's site, and
    // the summary numbers above already passed (would be polluted if leaked).
    expect(
      result.bySite.every(row => row.siteId !== harnessB.siteAId && row.siteId !== harnessB.siteBId)
    ).toBe(true);
    expect(result.recentDiscrepancies.every(row => row.sessionId !== 'rcash-closed-b-1')).toBe(
      true
    );
    // largestDiscrepancy must be 5, not 999 (B's fixture).
    expect(result.summary.largestDiscrepancy).toBeCloseTo(5, 2);
  });

  it('clamps recentDiscrepancies length to limit', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await caller.reports.cash.reconciliation({ limit: 1 });
    expect(result.recentDiscrepancies).toHaveLength(1);
    // Highest |overShort| = 5 → first row.
    expect(result.recentDiscrepancies[0]?.sessionId).toBe('rcash-closed-a-1');
  });
});
