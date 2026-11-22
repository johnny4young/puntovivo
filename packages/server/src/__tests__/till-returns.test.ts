import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  inventoryBalances,
  products,
  sales,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { completeSale } from '../application/sales/completeSale.js';
import type { CompleteSaleContext } from '../application/sales/types.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';
import {
  summarizeShiftApproval,
  type ShiftLossPreventionEvaluation,
} from '../services/loss-prevention/index.js';

function evaluation(
  overrides: Partial<ShiftLossPreventionEvaluation> = {}
): ShiftLossPreventionEvaluation {
  return {
    role: 'manager',
    action: 'sale_refund',
    cashSessionId: 'session',
    policyEnabled: true,
    requiresApproval: false,
    violations: [],
    violation: null,
    alertChannels: ['in_app'],
    ...overrides,
  };
}

const limitViolation = {
  kind: 'shift_refund_limit' as const,
  action: 'sale_refund' as const,
  reason: 'limit_exceeded' as const,
  exceeded: ['amount' as const],
  currentCount: 0,
  prospectiveCount: 1,
  maxCount: 5,
  currentAmount: 0,
  prospectiveAmount: 17_000,
  maxAmount: 10_000,
};

describe('summarizeShiftApproval', () => {
  it('lets a manager inside every rule refund directly', () => {
    expect(summarizeShiftApproval(evaluation())).toEqual({
      required: false,
      reason: null,
      limitAmount: null,
    });
  });

  it('always sends a cashier refund to a manager', () => {
    expect(summarizeShiftApproval(evaluation({ role: 'cashier' }))).toEqual({
      required: true,
      reason: 'role',
      limitAmount: null,
    });
  });

  it('names the shift amount a refund crosses', () => {
    expect(
      summarizeShiftApproval(evaluation({ requiresApproval: true, violations: [limitViolation] }))
    ).toEqual({ required: true, reason: 'shift_amount', limitAmount: 10_000 });
  });

  it('reports a count cap without an amount', () => {
    expect(
      summarizeShiftApproval(
        evaluation({
          requiresApproval: true,
          violations: [{ ...limitViolation, exceeded: ['count'] }],
        })
      )
    ).toEqual({ required: true, reason: 'shift_count', limitAmount: null });
  });

  it('asks for a manager when there is no open shift to measure', () => {
    expect(
      summarizeShiftApproval(
        evaluation({
          requiresApproval: true,
          violations: [{ ...limitViolation, reason: 'shift_unavailable', exceeded: ['shift'] }],
        })
      )
    ).toEqual({ required: true, reason: 'no_shift', limitAmount: null });
  });

  it('puts dual approval ahead of every other cause', () => {
    expect(
      summarizeShiftApproval(
        evaluation({
          role: 'cashier',
          requiresApproval: true,
          violations: [
            limitViolation,
            {
              kind: 'dual_approval_threshold',
              action: 'sale_refund',
              reason: 'dual_approval_threshold',
              observedAmount: 90_000,
              thresholdAmount: 50_000,
            },
          ],
        })
      )
    ).toEqual({ required: true, reason: 'dual', limitAmount: 50_000 });
  });
});

describe('till returns', () => {
  let server: PuntovivoServer;
  let tenantId: string;
  let userId: string;
  let siteId: string;
  let unitId: string;
  let deviceId: string;
  let callerContext: ReturnType<typeof makeFreshContextFactory>;

  function context(): CompleteSaleContext {
    return {
      db: getDatabase(),
      tenantId,
      siteId,
      user: { id: userId, role: 'admin' },
      envelope: null,
      deviceId: null,
    };
  }

  async function seedProduct(name: string) {
    const db = getDatabase();
    const id = nanoid();
    const now = new Date().toISOString();
    await db.insert(products).values({
      id,
      tenantId,
      name,
      sku: `${name}-${randomUUID()}`,
      price: 10,
      price2: 10,
      price3: 10,
      cost: 4,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 4,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId: id,
      unitId,
      equivalence: 1,
      price: 10,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(inventoryBalances).values({
      id: nanoid(),
      tenantId,
      siteId,
      productId: id,
      onHand: 10,
      reserved: 0,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async function sell(name: string) {
    const productId = await seedProduct(name);
    const completed = await completeSale(context(), {
      mode: 'fresh',
      customerId: null,
      items: [{ productId, unitId, quantity: 1, unitPrice: 10, discount: 0 }],
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      amountReceived: 10,
      discountAmount: 0,
    });
    return completed.sale as { id: string; saleNumber: string };
  }

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!user) throw new Error('Expected seeded administrator');
    tenantId = user.tenantId;
    userId = user.id;
    const site = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;
    const unit = await db
      .select()
      .from(units)
      .where(and(eq(units.tenantId, tenantId), eq(units.abbreviation, 'UND')))
      .get();
    if (!unit) throw new Error('Expected UND unit');
    unitId = unit.id;
    const device = await registerDevice(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'till-returns.test',
    });
    deviceId = device.deviceId;
    callerContext = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId,
      email: user.email,
      siteId,
      deviceId: device.deviceId,
    });
    await appRouter.createCaller(callerContext()).cashSessions.open({
      registerName: 'Till returns register',
      openingFloat: 500,
      denominations: [{ value: 100, count: 5 }],
    });
  });

  afterAll(async () => server.close());

  it('previews the approval the commit will demand for each role', async () => {
    const sale = await sell('Preview approval widget');
    const adminPreview = await appRouter
      .createCaller(callerContext())
      .sales.previewReturn({ id: sale.id });
    expect(adminPreview.refundAmount).toBe(10);
    expect(adminPreview.approval).toEqual({ required: false, reason: null, limitAmount: null });

    const db = getDatabase();
    const cashierId = nanoid();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: cashierId,
      tenantId,
      email: `cashier-${cashierId}@returns.test`,
      name: 'Returns cashier',
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const cashierContext = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId: cashierId,
      email: `cashier-${cashierId}@returns.test`,
      defaultRole: 'cashier',
      siteId,
      deviceId,
    });
    const cashierPreview = await appRouter
      .createCaller(cashierContext())
      .sales.previewReturn({ id: sale.id });
    expect(cashierPreview.approval).toEqual({ required: true, reason: 'role', limitAmount: null });
  });

  it('lists today’s returnable sales at the active site only', async () => {
    const db = getDatabase();
    const caller = appRouter.createCaller(callerContext());
    const kept = await sell('Returnable today widget');
    const refunded = await sell('Fully refunded widget');
    await caller.sales.returnSale({ id: refunded.id });
    const moved = await sell('Other site widget');

    const originalSite = await db
      .select({ companyId: sites.companyId })
      .from(sites)
      .where(eq(sites.id, siteId))
      .get();
    const otherSiteId = nanoid();
    const otherSessionId = nanoid();
    const now = new Date().toISOString();
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId,
      companyId: originalSite!.companyId,
      name: `Returns other site ${randomUUID()}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(cashSessions).values({
      id: otherSessionId,
      tenantId,
      siteId: otherSiteId,
      cashierId: userId,
      registerName: 'Other register',
      openingCountDenominations: [],
      status: 'closed',
      closedAt: now,
    });
    await db
      .update(sales)
      .set({ cashSessionId: otherSessionId })
      .where(eq(sales.id, moved.id))
      .run();

    const rows = await caller.sales.returnableToday();
    const ids = rows.map(row => row.id);
    expect(ids).toContain(kept.id);
    expect(ids).not.toContain(refunded.id);
    expect(ids).not.toContain(moved.id);
    const row = rows.find(entry => entry.id === kept.id)!;
    expect(row).toMatchObject({
      saleNumber: kept.saleNumber,
      total: 10,
      registerName: 'Till returns register',
    });
    expect(Date.parse(row.completedAt)).not.toBeNaN();

    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    await db
      .update(sales)
      .set({ checkoutCompletedAt: yesterday, createdAt: yesterday })
      .where(eq(sales.id, kept.id))
      .run();
    expect((await caller.sales.returnableToday()).map(entry => entry.id)).not.toContain(kept.id);
  });

  it('returns nothing without an active site', async () => {
    const caller = appRouter.createCaller({ ...callerContext(), siteId: null });
    await expect(caller.sales.returnableToday()).resolves.toEqual([]);
  });
});
