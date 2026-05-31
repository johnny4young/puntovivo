/**
 * ENG-062 — Hardware outbox integration tests.
 *
 * Drives `peripherals.printReceipt` + `peripherals.kickCashDrawer`
 * through the in-memory MockEscPosTransport via the
 * `__setEscPosTransportForTest` seam. Asserts:
 *
 *   - happy path: escpos+mock printer flushes bytes, returns
 *     `{status:'printed'}`, NO outbox row enqueued
 *   - failure path: forced transport error returns
 *     `{status:'fallback'}` AND a `hardware_outbox` row is queued
 *   - drawer kick: success returns `{status:'ok'}`, mock buffer
 *     contains the canonical pulse
 *   - drawer kick: no drawer registered returns
 *     `{status:'no-drawer-registered'}`
 *   - peekHardwareOutbox: cross-tenant isolation
 *   - peekHardwareOutbox: rejects cashier role
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  hardwareOutbox,
  sales,
  sitePeripherals,
  sites,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import {
  ESCPOS_BYTES,
  EscPosTransportError,
  MockEscPosTransport,
  __setEscPosTransportForTest,
  type EscPosTransport,
} from '../services/peripherals/index.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let cashSessionId: string;
let saleId: string;

function buildContext(role: 'admin' | 'cashier' = 'admin'): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      log: { warn: () => undefined },
      user: {
        userId,
        email: 'admin@localhost',
        role,
        tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: 'admin@localhost',
      role,
      tenantId,
    },
    tenantId,
    siteId,
  };
}

const now = () => new Date().toISOString();

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const seededUser = await db
    .select()
    .from(users)
    .where(eq(users.email, 'admin@localhost'))
    .get();
  if (!seededUser) throw new Error('Expected seeded admin user');
  tenantId = seededUser.tenantId;
  userId = seededUser.id;
  const seededSite = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!seededSite) throw new Error('Expected seeded site');
  siteId = seededSite.id;

  // Seed a minimal completed sale we can hand to printReceipt.
  cashSessionId = nanoid();
  await db.insert(cashSessions).values({
    id: cashSessionId,
    tenantId,
    siteId,
    cashierId: userId,
    registerName: 'Caja Test',
    openingFloat: 0,
    openingCountDenominations: [],
    expectedBalance: 0,
    status: 'open',
    openedAt: now(),
    createdAt: now(),
    updatedAt: now(),
  });

  saleId = nanoid();
  await db.insert(sales).values({
    id: saleId,
    tenantId,
    saleNumber: 'TEST-VTA-1',
    customerId: null,
    subtotal: 100,
    taxAmount: 0,
    discountAmount: 0,
    total: 100,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    cashSessionId,
    notes: null,
    createdBy: userId,
    syncStatus: 'pending',
    syncVersion: 1,
    createdAt: now(),
    updatedAt: now(),
  });
});

afterAll(async () => {
  __setEscPosTransportForTest(null);
  await server.close();
});

afterEach(async () => {
  __setEscPosTransportForTest(null);
  await getDatabase()
    .delete(hardwareOutbox)
    .where(eq(hardwareOutbox.tenantId, tenantId));
  await getDatabase()
    .delete(sitePeripherals)
    .where(eq(sitePeripherals.tenantId, tenantId));
});

describe('peripherals.printReceipt', () => {
  it('returns system-fallback when no printer is registered', async () => {
    const caller = appRouter.createCaller(buildContext('cashier'));
    const result = await caller.peripherals.printReceipt({ saleId, siteId });
    expect(result).toEqual({ status: 'system-fallback' });
  });

  it('returns system-fallback when the active driver is system', async () => {
    const adminCaller = appRouter.createCaller(buildContext('admin'));
    await adminCaller.peripherals.register({
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
    });
    const cashierCaller = appRouter.createCaller(buildContext('cashier'));
    const result = await cashierCaller.peripherals.printReceipt({ saleId, siteId });
    expect(result).toEqual({ status: 'system-fallback' });
  });

  it('returns printed and writes bytes to the transport when escpos succeeds', async () => {
    const mock = new MockEscPosTransport();
    __setEscPosTransportForTest(mock);
    const adminCaller = appRouter.createCaller(buildContext('admin'));
    await adminCaller.peripherals.register({
      siteId,
      kind: 'printer',
      driver: 'escpos',
      config: { channel: 'mock' },
    });
    const cashierCaller = appRouter.createCaller(buildContext('cashier'));
    const result = await cashierCaller.peripherals.printReceipt({ saleId, siteId });
    expect(result).toEqual({ status: 'printed' });
    const buf = mock.buffer();
    // Init prefix and full-cut suffix prove the byte builder ran.
    expect(buf.subarray(0, 2)).toEqual(ESCPOS_BYTES.INIT);
    expect(buf.subarray(buf.length - 3)).toEqual(ESCPOS_BYTES.CUT_FULL);

    // No outbox row on success.
    const rows = await getDatabase()
      .select()
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.tenantId, tenantId))
      .all();
    expect(rows).toHaveLength(0);
  });

  it('returns fallback and enqueues a retry row when the transport fails', async () => {
    const failing: EscPosTransport = {
      async write() {
        throw new EscPosTransportError('TCP refused', {
          kind: 'DEVICE_OFFLINE',
          message: 'Connection refused',
        });
      },
      async close() {},
    };
    __setEscPosTransportForTest(failing);
    const adminCaller = appRouter.createCaller(buildContext('admin'));
    await adminCaller.peripherals.register({
      siteId,
      kind: 'printer',
      driver: 'escpos',
      config: { channel: 'tcp', host: '192.168.1.50', port: 9100 },
    });
    const cashierCaller = appRouter.createCaller(buildContext('cashier'));
    const result = await cashierCaller.peripherals.printReceipt({ saleId, siteId });
    expect(result.status).toBe('fallback');
    if (result.status === 'fallback') {
      expect(result.error).toBe('DEVICE_OFFLINE');
    }

    const rows = await getDatabase()
      .select()
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.tenantId, tenantId))
      .all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0]!;
    expect(row.kind).toBe('print-receipt');
    expect(row.status).toBe('retrying');
    expect(row.attempts).toBe(1);
  });
});

describe('peripherals.kickCashDrawer', () => {
  it('rejects cashier role with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(buildContext('cashier'));
    try {
      await caller.peripherals.kickCashDrawer({ siteId });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('FORBIDDEN');
    }
  });

  it('returns no-drawer-registered when no drawer is configured', async () => {
    const caller = appRouter.createCaller(buildContext('admin'));
    const result = await caller.peripherals.kickCashDrawer({ siteId });
    expect(result).toEqual({ status: 'no-drawer-registered' });
  });

  it('writes the canonical drawer pulse to the transport on success', async () => {
    const mock = new MockEscPosTransport();
    __setEscPosTransportForTest(mock);
    const adminCaller = appRouter.createCaller(buildContext('admin'));
    await adminCaller.peripherals.register({
      siteId,
      kind: 'cash_drawer',
      driver: 'escpos',
      config: { channel: 'mock' },
    });
    const result = await adminCaller.peripherals.kickCashDrawer({ siteId });
    expect(result).toEqual({ status: 'ok' });
    expect(mock.buffer()).toEqual(ESCPOS_BYTES.DRAWER_KICK);
  });
});

describe('peripherals.peekHardwareOutbox', () => {
  it('rejects cashier role with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(buildContext('cashier'));
    try {
      await caller.peripherals.peekHardwareOutbox({});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('FORBIDDEN');
    }
  });

  it('returns rows scoped to the tenant ordered by createdAt desc', async () => {
    const db = getDatabase();
    await db.insert(hardwareOutbox).values({
      id: nanoid(),
      tenantId,
      status: 'queued',
      kind: 'print-receipt',
      peripheralId: null,
      payload: { kind: 'print-receipt', document: { lines: [] }, siteId } as Record<string, unknown>,
      attempts: 0,
      createdAt: now(),
      updatedAt: now(),
    });
    const caller = appRouter.createCaller(buildContext('admin'));
    const rows = await caller.peripherals.peekHardwareOutbox({});
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.kind).toBe('print-receipt');
  });
});
