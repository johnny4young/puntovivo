import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type OpenYojobServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { sales, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: OpenYojobServer;
let tenantId: string;
let userId: string;

function createTestContext(): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: {
      userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    jwtVerify: async () => {},
  } as unknown as Context['req'];

  const mockRes = {} as unknown as Context['res'];

  return {
    req: mockReq,
    res: mockRes,
    db,
    user: {
      id: userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

describe('Sales tRPC Router', () => {
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

    tenantId = seededUser.tenantId;
    userId = seededUser.id;

    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12)
    ).toISOString();
    const yesterday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12)
    ).toISOString();

    await db.insert(sales).values([
      {
        id: nanoid(),
        tenantId,
        saleNumber: 'SALE-100001',
        subtotal: 100,
        taxAmount: 19,
        discountAmount: 0,
        total: 119,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        createdBy: userId,
        createdAt: today,
        updatedAt: today,
      },
      {
        id: nanoid(),
        tenantId,
        saleNumber: 'SALE-100002',
        subtotal: 50,
        taxAmount: 9.5,
        discountAmount: 0,
        total: 59.5,
        paymentMethod: 'transfer',
        paymentStatus: 'pending',
        status: 'completed',
        createdBy: userId,
        createdAt: today,
        updatedAt: today,
      },
      {
        id: nanoid(),
        tenantId,
        saleNumber: 'SALE-100003',
        subtotal: 20,
        taxAmount: 3.8,
        discountAmount: 0,
        total: 23.8,
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        status: 'completed',
        createdBy: userId,
        createdAt: yesterday,
        updatedAt: yesterday,
      },
    ]);
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns aggregate sales KPIs for the current tenant', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const result = await caller.sales.summary();

    expect(result.todaySalesTotal).toBeCloseTo(178.5);
    expect(result.transactionCount).toBe(3);
    expect(result.averageOrder).toBeCloseTo(67.4333333333);
    expect(result.pendingPaymentsTotal).toBeCloseTo(59.5);
  });
});
