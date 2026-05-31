import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { TRPCError } from '@trpc/server';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeEnvelopeHeadersProxy } from './utils/criticalCommandFixture.js';
import {
  cashMovements,
  cashSessions,
  denominationTemplates,
  products,
  sites,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let baseUnitId: string;
let testDeviceId: string;

function createTestContext(
  overrides?: Partial<NonNullable<Context['user']>>
): Context {
  const db = getDatabase();
  const role = overrides?.role ?? 'admin';
  const currentUserId = overrides?.id ?? userId;
  const email = overrides?.email ?? 'admin@localhost';
  const currentTenantId = overrides?.tenantId ?? tenantId;

  return {
    req: {
      server: server.app,
      headers: makeEnvelopeHeadersProxy({
        getDeviceId: () => testDeviceId,
        getSiteId: () => siteId,
      }),
      user: {
        userId: currentUserId,
        email,
        role,
        tenantId: currentTenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: currentUserId,
      email,
      role,
      tenantId: currentTenantId,
    },
    tenantId: currentTenantId,
    siteId,
  };
}

function expectErrorCode(error: unknown, errorCode: string) {
  expect(error).toBeInstanceOf(TRPCError);
  const cause = (error as TRPCError).cause;
  expect(cause).toBeInstanceOf(ServerErrorWithCode);
  expect((cause as ServerErrorWithCode).errorCode).toBe(errorCode);
}

describe('Cash sessions tRPC Router', () => {
  beforeAll(async () => {
    server = await createServer({
      dbPath: ':memory:',
      verbose: false,
    });

    const db = getDatabase();
    const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();

    if (!seededUser) {
      throw new Error('Expected seeded admin user');
    }

    const seededSite = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, seededUser.tenantId), eq(sites.isActive, true)))
      .get();

    if (!seededSite) {
      throw new Error('Expected seeded site');
    }

    const seededUnits = await db
      .select()
      .from(units)
      .where(eq(units.tenantId, seededUser.tenantId))
      .all();
    const baseUnit = seededUnits.find(unit => unit.abbreviation === 'UND');

    if (!baseUnit) {
      throw new Error('Expected seeded base unit');
    }

    tenantId = seededUser.tenantId;
    userId = seededUser.id;
    siteId = seededSite.id;
    baseUnitId = baseUnit.id;

    // ENG-052b — register one device per test file for the active
    // tenant. The id is shared across role overrides because device
    // validation in `commandEnvelope` is scoped to (tenantId,
    // deviceId), not user.
    const registration = await registerDeviceService(getDatabase(), {
      tenantId,
      userId,
      kind: 'web',
      name: 'cashSessions.test',
    });
    testDeviceId = registration.deviceId;
  });

  afterAll(async () => {
    await server.close();
  });

  it('opens a cash session and exposes it through getActive', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const opened = await caller.cashSessions.open({
      registerName: 'Back counter',
      openingFloat: 150,
      denominations: [
        { value: 50, count: 3 },
      ],
    });

    expect(opened.status).toBe('open');
    expect(opened.expectedBalance).toBe(150);
    expect(opened.registerName).toBe('Back counter');
    expect(opened.siteId).toBe(siteId);
    expect(opened.cashierId).toBe(userId);

    const active = await caller.cashSessions.getActive();
    expect(active?.id).toBe(opened.id);
    expect(active?.openingCountDenominations).toEqual([{ value: 50, count: 3 }]);
  });

  it('bootstraps register assignments for the active site and syncs new registers from openings', async () => {
    const cashierId = nanoid();
    const cashierEmail = 'cash-session-register-template@example.com';
    const now = new Date().toISOString();

    await getDatabase().insert(users).values({
      id: cashierId,
      tenantId,
      email: cashierEmail,
      name: 'Register Template Cashier',
      passwordHash: 'hash',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(
      createTestContext({
        id: cashierId,
        email: cashierEmail,
        role: 'cashier',
      })
    );

    const initialAssignments = await caller.cashSessions.registerAssignments();

    expect(initialAssignments.length).toBeGreaterThan(0);
    expect(initialAssignments[0]).toEqual(
      expect.objectContaining({
        registerName: expect.any(String),
        label: expect.any(String),
        isOccupied: expect.any(Boolean),
      })
    );

    await caller.cashSessions.open({
      registerName: 'Front register',
      openingFloat: 100,
      denominations: [{ value: 50, count: 2 }],
    });

    const nextAssignments = await caller.cashSessions.registerAssignments();
    expect(nextAssignments).toContainEqual(
      expect.objectContaining({
        registerName: 'Front register',
        openingFloat: 100,
        denominations: [{ value: 50, count: 2 }],
        isOccupied: true,
        activeCashierName: 'Register Template Cashier',
      })
    );

    const persistedTemplate = await getDatabase()
      .select()
      .from(denominationTemplates)
      .where(
        and(
          eq(denominationTemplates.tenantId, tenantId),
          eq(denominationTemplates.siteId, siteId),
          eq(denominationTemplates.registerName, 'Front register')
        )
      )
      .get();

    expect(persistedTemplate).toBeDefined();
    expect(persistedTemplate?.openingFloat).toBe(100);
    expect(persistedTemplate?.denominations).toEqual([{ value: 50, count: 2 }]);
  });

  it('rejects an opening float that does not match the denomination count', async () => {
    const cashierId = nanoid();
    const db = getDatabase();
    await db.insert(users).values({
      id: cashierId,
      tenantId,
      email: 'cash-session-mismatch@example.com',
      name: 'Mismatch Cashier',
      passwordHash: 'hash',
      role: 'cashier',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const caller = appRouter.createCaller(
      createTestContext({
        id: cashierId,
        email: 'cash-session-mismatch@example.com',
        role: 'cashier',
      })
    );

    let caught: unknown;
    try {
      await caller.cashSessions.open({
        registerName: 'Mismatch register',
        openingFloat: 120,
        denominations: [{ value: 50, count: 2 }],
      });
    } catch (error) {
      caught = error;
    }

    expectErrorCode(caught, 'CASH_SESSION_OPENING_FLOAT_MISMATCH');
  });

  it('closes the active cash session with blind count and calculates over/short', async () => {
    const cashierId = nanoid();
    const cashierEmail = 'cash-session-close@example.com';
    const db = getDatabase();
    const now = new Date().toISOString();

    await db.insert(users).values({
      id: cashierId,
      tenantId,
      email: cashierEmail,
      name: 'Cashier Close Session',
      passwordHash: 'hash',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(
      createTestContext({
        id: cashierId,
        email: cashierEmail,
        role: 'cashier',
      })
    );

    const opened = await caller.cashSessions.open({
      registerName: 'Close register',
      openingFloat: 100,
      denominations: [{ value: 50, count: 2 }],
    });

    const closed = await caller.cashSessions.close({
      actualCount: 110,
      denominations: [{ value: 50, count: 2 }, { value: 10, count: 1 }],
    });

    expect(closed.id).toBe(opened.id);
    expect(closed.status).toBe('closed');
    expect(closed.actualCount).toBe(110);
    expect(closed.actualCountDenominations).toEqual([
      { value: 50, count: 2 },
      { value: 10, count: 1 },
    ]);
    expect(closed.overShort).toBe(10);
    expect(closed.closedAt).toEqual(expect.any(String));

    const active = await caller.cashSessions.getActive();
    expect(active).toBeNull();
  });

  it('rejects a closing count that does not match the denomination count', async () => {
    const cashierId = nanoid();
    const cashierEmail = 'cash-session-close-mismatch@example.com';
    const db = getDatabase();
    const now = new Date().toISOString();

    await db.insert(users).values({
      id: cashierId,
      tenantId,
      email: cashierEmail,
      name: 'Cashier Close Mismatch',
      passwordHash: 'hash',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(
      createTestContext({
        id: cashierId,
        email: cashierEmail,
        role: 'cashier',
      })
    );

    await caller.cashSessions.open({
      registerName: 'Mismatch close register',
      openingFloat: 80,
      denominations: [{ value: 20, count: 4 }],
    });

    let caught: unknown;
    try {
      await caller.cashSessions.close({
        actualCount: 90,
        denominations: [{ value: 20, count: 4 }],
      });
    } catch (error) {
      caught = error;
    }

    expectErrorCode(caught, 'CASH_SESSION_COUNT_MISMATCH');
  });

  it('requires an active cash session before creating a sale', async () => {
    const cashierId = nanoid();
    const cashierEmail = 'cash-session-required@example.com';
    const db = getDatabase();

    await db.insert(users).values({
      id: cashierId,
      tenantId,
      email: cashierEmail,
      name: 'Cashier Without Session',
      passwordHash: 'hash',
      role: 'cashier',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const productId = nanoid();
    const now = new Date().toISOString();

    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Session Required Product',
      sku: 'SESSION-REQ-01',
      price: 15,
      price2: 15,
      price3: 15,
      cost: 7,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      initialCost: 7,
      stock: 5,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: baseUnitId,
      equivalence: 1,
      price: 15,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(
      createTestContext({
        id: cashierId,
        email: cashierEmail,
        role: 'cashier',
      })
    );

    let caught: unknown;
    try {
      await caller.sales.create({
        items: [
          {
            productId,
            unitId: baseUnitId,
            quantity: 1,
            unitPrice: 15,
            discount: 0,
          },
        ],
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'completed',
        amountReceived: 15,
        discountAmount: 0,
      });
    } catch (error) {
      caught = error;
    }

    expectErrorCode(caught, 'CASH_SESSION_REQUIRED');

    const stillNoSession = await db
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(and(eq(cashSessions.cashierId, cashierId), eq(cashSessions.status, 'open')))
      .get();
    expect(stillNoSession).toBeUndefined();
  });

  it('records manual cash movements and exposes them through the session timeline', async () => {
    const cashierId = nanoid();
    const cashierEmail = 'cash-session-movements@example.com';
    const db = getDatabase();
    const now = new Date().toISOString();

    await db.insert(users).values({
      id: cashierId,
      tenantId,
      email: cashierEmail,
      name: 'Cashier Movements',
      passwordHash: 'hash',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const caller = appRouter.createCaller(
      createTestContext({
        id: cashierId,
        email: cashierEmail,
        role: 'cashier',
      })
    );

    const opened = await caller.cashSessions.open({
      registerName: 'Movement register',
      openingFloat: 120,
      denominations: [{ value: 20, count: 6 }],
    });

    const paidIn = await caller.cashSessions.recordMovement({
      type: 'paid_in',
      amount: 30,
      note: 'Coins replenished from safe',
    });

    const skim = await caller.cashSessions.recordMovement({
      type: 'skim',
      amount: 10,
      note: 'Skimmed excess cash to safe',
    });

    expect(paidIn.sessionId).toBe(opened.id);
    expect(paidIn.type).toBe('paid_in');
    expect(skim.type).toBe('skim');

    const movements = await caller.cashSessions.movements({
      sessionId: opened.id,
      limit: 10,
    });

    expect(movements).toHaveLength(2);
    expect(movements[0]?.id).toBe(skim.id);
    expect(movements[0]?.createdByName).toBe('Cashier Movements');
    expect(movements[1]?.id).toBe(paidIn.id);

    const updatedSession = await caller.cashSessions.getActive();
    expect(updatedSession?.expectedBalance).toBe(140);

    const persistedMovement = await db
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.id, paidIn.id))
      .get();
    expect(persistedMovement).toMatchObject({
      sessionId: opened.id,
      type: 'paid_in',
      amount: 30,
      note: 'Coins replenished from safe',
      createdBy: cashierId,
    });
  });

  it('does not expose another cashier session timeline to a regular cashier', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const ownerId = nanoid();
    const viewerId = nanoid();

    await db.insert(users).values([
      {
        id: ownerId,
        tenantId,
        email: 'cash-session-owner@example.com',
        name: 'Cash Session Owner',
        passwordHash: 'hash',
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: viewerId,
        tenantId,
        email: 'cash-session-viewer@example.com',
        name: 'Cash Session Viewer',
        passwordHash: 'hash',
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const ownerCaller = appRouter.createCaller(
      createTestContext({
        id: ownerId,
        email: 'cash-session-owner@example.com',
        role: 'cashier',
      })
    );
    const viewerCaller = appRouter.createCaller(
      createTestContext({
        id: viewerId,
        email: 'cash-session-viewer@example.com',
        role: 'cashier',
      })
    );

    const opened = await ownerCaller.cashSessions.open({
      registerName: 'Owner register',
      openingFloat: 80,
      denominations: [{ value: 20, count: 4 }],
    });

    await ownerCaller.cashSessions.recordMovement({
      type: 'paid_in',
      amount: 15,
      note: 'Owner-only note',
    });

    const movements = await viewerCaller.cashSessions.movements({
      sessionId: opened.id,
      limit: 10,
    });

    expect(movements).toEqual([]);
  });

  it('requires manager or admin role to list recent cash-session balances', async () => {
    const cashierCaller = appRouter.createCaller(createTestContext({ role: 'cashier' }));

    await expect(cashierCaller.cashSessions.listRecent()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('builds a cash management report with active sessions and discrepancy summary for admins', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const activeCashierId = nanoid();
    const closedCashierId = nanoid();

    await db.insert(users).values([
      {
        id: activeCashierId,
        tenantId,
        email: 'cash-report-active@example.com',
        name: 'Cash Report Active',
        passwordHash: 'hash',
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: closedCashierId,
        tenantId,
        email: 'cash-report-closed@example.com',
        name: 'Cash Report Closed',
        passwordHash: 'hash',
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const activeCaller = appRouter.createCaller(
      createTestContext({
        id: activeCashierId,
        email: 'cash-report-active@example.com',
        role: 'cashier',
      })
    );
    const closedCaller = appRouter.createCaller(
      createTestContext({
        id: closedCashierId,
        email: 'cash-report-closed@example.com',
        role: 'cashier',
      })
    );
    const adminCaller = appRouter.createCaller(createTestContext());
    const baselineReport = await adminCaller.cashSessions.report({ limit: 20 });

    await activeCaller.cashSessions.open({
      registerName: 'North register',
      openingFloat: 60,
      denominations: [{ value: 20, count: 3 }],
    });

    await closedCaller.cashSessions.open({
      registerName: 'South register',
      openingFloat: 80,
      denominations: [{ value: 20, count: 4 }],
    });

    await closedCaller.cashSessions.close({
      actualCount: 75,
      denominations: [{ value: 20, count: 3 }, { value: 10, count: 1 }, { value: 5, count: 1 }],
    });

    const report = await adminCaller.cashSessions.report({ limit: 20 });

    expect(report.summary).toEqual({
      activeSessionCount: baselineReport.summary.activeSessionCount + 1,
      activeRegisterCount: baselineReport.summary.activeRegisterCount + 1,
      recentClosureCount: baselineReport.summary.recentClosureCount + 1,
      reviewCount: baselineReport.summary.reviewCount + 1,
      netOverShort: baselineReport.summary.netOverShort - 5,
      largestDiscrepancy: Math.max(baselineReport.summary.largestDiscrepancy, 5),
    });
    expect(report.activeSessions).toContainEqual(
      expect.objectContaining({
        registerName: 'North register',
        cashierName: 'Cash Report Active',
        status: 'open',
      })
    );
    expect(report.recentClosures).toContainEqual(
      expect.objectContaining({
        registerName: 'South register',
        cashierName: 'Cash Report Closed',
        status: 'closed',
        overShort: -5,
      })
    );
  });

  it('limits cash management report visibility to the current cashier when not privileged', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const ownerId = nanoid();
    const viewerId = nanoid();

    await db.insert(users).values([
      {
        id: ownerId,
        tenantId,
        email: 'cash-report-owner@example.com',
        name: 'Cash Report Owner',
        passwordHash: 'hash',
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: viewerId,
        tenantId,
        email: 'cash-report-viewer@example.com',
        name: 'Cash Report Viewer',
        passwordHash: 'hash',
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const ownerCaller = appRouter.createCaller(
      createTestContext({
        id: ownerId,
        email: 'cash-report-owner@example.com',
        role: 'cashier',
      })
    );
    const viewerCaller = appRouter.createCaller(
      createTestContext({
        id: viewerId,
        email: 'cash-report-viewer@example.com',
        role: 'cashier',
      })
    );

    await ownerCaller.cashSessions.open({
      registerName: 'Owner report register',
      openingFloat: 50,
      denominations: [{ value: 10, count: 5 }],
    });

    const report = await viewerCaller.cashSessions.report({ limit: 5 });

    expect(report.summary).toEqual({
      activeSessionCount: 0,
      activeRegisterCount: 0,
      recentClosureCount: 0,
      reviewCount: 0,
      netOverShort: 0,
      largestDiscrepancy: 0,
    });
    expect(report.activeSessions).toEqual([]);
    expect(report.recentClosures).toEqual([]);
  });

  // ENG-056 — integration cases proving the router thin wrappers
  // enforce the cash-session boundary: no movement without a session,
  // no movement without a site, and pendingChecks surfaces zero counts
  // for an empty session.

  it('rejects manual cash movement when no active session exists (router-level)', async () => {
    const noSessionCashierId = nanoid();
    const db = getDatabase();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: noSessionCashierId,
      tenantId,
      email: 'no-session-cashier@example.com',
      name: 'No Session Cashier',
      passwordHash: 'hash',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const caller = appRouter.createCaller(
      createTestContext({
        id: noSessionCashierId,
        email: 'no-session-cashier@example.com',
        role: 'cashier',
      })
    );
    await expect(
      caller.cashSessions.recordMovement({
        type: 'paid_in',
        amount: 5,
        note: 'no-session integration test',
      })
    ).rejects.toMatchObject({ cause: { errorCode: 'CASH_SESSION_REQUIRED' } });
  });

  it('exposes zero pending fiscal/payment counts via pendingChecks for an empty active session', async () => {
    const cashierId = nanoid();
    const db = getDatabase();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: cashierId,
      tenantId,
      email: 'pending-checks-cashier@example.com',
      name: 'Pending Checks Cashier',
      passwordHash: 'hash',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const caller = appRouter.createCaller(
      createTestContext({
        id: cashierId,
        email: 'pending-checks-cashier@example.com',
        role: 'cashier',
      })
    );
    await caller.cashSessions.open({
      registerName: 'Pending Checks register',
      openingFloat: 0,
      denominations: [],
    });
    const result = await caller.cashSessions.pendingChecks();
    expect(result.pendingFiscalDocuments).toBe(0);
    expect(result.pendingPaymentSales).toBe(0);
    expect(result.fiscalSamples).toEqual([]);
    expect(result.paymentSamples).toEqual([]);
  });

  it('returns the empty pendingChecks shape when caller has no active session', async () => {
    const cashierId = nanoid();
    const db = getDatabase();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: cashierId,
      tenantId,
      email: 'no-active-pending@example.com',
      name: 'No Active Pending',
      passwordHash: 'hash',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const caller = appRouter.createCaller(
      createTestContext({
        id: cashierId,
        email: 'no-active-pending@example.com',
        role: 'cashier',
      })
    );
    const result = await caller.cashSessions.pendingChecks();
    expect(result.pendingFiscalDocuments).toBe(0);
    expect(result.pendingPaymentSales).toBe(0);
  });
});
