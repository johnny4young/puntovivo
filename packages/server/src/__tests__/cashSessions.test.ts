import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { TRPCError } from '@trpc/server';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
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
      headers: {
        'x-site-id': siteId,
      },
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
});
