/**
 * ENG-065d — `payments.methodBreakdown` aggregation tests.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { paymentOutbox, tenants, users, type PaymentRailId } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

interface BreakdownHarness {
  tenantId: string;
  adminId: string;
}

async function seedHarness(suffix: string): Promise<BreakdownHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `pay-bd-tenant-${suffix}`;
  const adminId = `pay-bd-admin-${suffix}`;
  await db.insert(tenants).values({
    id: tenantId,
    name: `PayBd Tenant ${suffix}`,
    slug: `pay-bd-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: adminId,
    tenantId,
    email: `admin-${suffix}@paybd.test`,
    name: `Admin ${suffix}`,
    passwordHash: 'x',
    sessionVersion: 1,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return { tenantId, adminId };
}

async function insertOutboxRow(args: {
  tenantId: string;
  id: string;
  railId: PaymentRailId;
  status:
    | 'queued'
    | 'submitting'
    | 'approved'
    | 'declined'
    | 'timeout'
    | 'retrying'
    | 'settled'
    | 'dead_letter';
  amount: number;
  createdAt: string;
}): Promise<void> {
  const db = getDatabase();
  await db.insert(paymentOutbox).values({
    id: args.id,
    tenantId: args.tenantId,
    salePaymentId: null,
    railId: args.railId,
    kind: 'charge',
    status: args.status,
    amount: args.amount,
    currencyCode: 'COP',
    reference: args.id,
    providerTransactionId: null,
    payload: { fixture: true },
    payloadVersion: 1,
    attempts: 0,
    nextRetryAt: null,
    lastError: null,
    priority: 0,
    claimToken: null,
    lockedAt: null,
    idempotencyKey: null,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
  });
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
    user: { userId, email: `${userId}@paybd.test`, role, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: {
      id: userId,
      email: `${userId}@paybd.test`,
      role,
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

describe('payments.methodBreakdown (ENG-065d)', () => {
  it('empty tenant returns no entries', async () => {
    const h = await seedHarness('empty');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.payments.methodBreakdown({ windowDays: 7 });
    expect(result.windowDays).toBe(7);
    expect(result.entries).toEqual([]);
  });

  it('aggregates by (rail, status) and sorts deterministically', async () => {
    const h = await seedHarness('multi');
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'bd-1',
      railId: 'wompi',
      status: 'settled',
      amount: 50_000,
      createdAt: recent,
    });
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'bd-2',
      railId: 'wompi',
      status: 'settled',
      amount: 30_000,
      createdAt: recent,
    });
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'bd-3',
      railId: 'wompi',
      status: 'dead_letter',
      amount: 12_000,
      createdAt: recent,
    });
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'bd-4',
      railId: 'bold',
      status: 'approved',
      amount: 99_000,
      createdAt: recent,
    });
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'bd-5',
      railId: 'bold',
      status: 'declined',
      amount: 75_000,
      createdAt: recent,
    });

    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.payments.methodBreakdown({ windowDays: 7 });

    expect(result.entries).toEqual([
      { railId: 'bold', status: 'approved', count: 1, totalAmount: 99_000 },
      { railId: 'bold', status: 'declined', count: 1, totalAmount: 75_000 },
      { railId: 'wompi', status: 'dead_letter', count: 1, totalAmount: 12_000 },
      { railId: 'wompi', status: 'settled', count: 2, totalAmount: 80_000 },
    ]);
  });

  it('excludes rows older than the window', async () => {
    const h = await seedHarness('window');
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const ancient = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'bd-recent',
      railId: 'wompi',
      status: 'settled',
      amount: 10_000,
      createdAt: recent,
    });
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'bd-ancient',
      railId: 'wompi',
      status: 'settled',
      amount: 999_999,
      createdAt: ancient,
    });
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.payments.methodBreakdown({ windowDays: 7 });
    expect(result.entries).toEqual([
      { railId: 'wompi', status: 'settled', count: 1, totalAmount: 10_000 },
    ]);
  });

  it('isolates rows across tenants', async () => {
    const a = await seedHarness('iso-a');
    const b = await seedHarness('iso-b');
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await insertOutboxRow({
      tenantId: a.tenantId,
      id: 'bd-iso-a',
      railId: 'wompi',
      status: 'settled',
      amount: 10_000,
      createdAt: recent,
    });
    await insertOutboxRow({
      tenantId: b.tenantId,
      id: 'bd-iso-b',
      railId: 'wompi',
      status: 'settled',
      amount: 999_999,
      createdAt: recent,
    });
    const callerA = appRouter.createCaller(buildCtx(a.tenantId, a.adminId, 'admin'));
    const result = await callerA.payments.methodBreakdown({ windowDays: 7 });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ totalAmount: 10_000 });
  });

  it('rejects out-of-bound windowDays via Zod', async () => {
    const h = await seedHarness('bounds');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await expect(
      caller.payments.methodBreakdown({ windowDays: 0 })
    ).rejects.toBeDefined();
    await expect(
      caller.payments.methodBreakdown({ windowDays: 91 })
    ).rejects.toBeDefined();
  });
});
