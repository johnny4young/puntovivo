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
  auditLogs,
  cashSessions,
  hardwareOutbox,
  managerApprovalRequests,
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
import { registerDevice } from '../services/devices/devicesService.js';
import { freshCriticalContext } from './utils/criticalCommandFixture.js';
import {
  resolveLossPreventionSettings,
  writeLossPreventionSettings,
} from '../services/loss-prevention/index.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let cashSessionId: string;
let saleId: string;
let deviceId: string;
let approverId: string;

function buildContext(role: 'admin' | 'manager' | 'cashier' = 'admin'): Context {
  return freshCriticalContext({
    db: getDatabase(),
    serverApp: server.app,
    tenantId,
    userId,
    email: 'admin@localhost',
    role,
    siteId,
    deviceId,
  });
}

const now = () => new Date().toISOString();

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
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
  deviceId = (
    await registerDevice(db, {
      tenantId,
      userId,
      kind: 'web',
      name: 'hardware-outbox-integration',
    })
  ).deviceId;
  approverId = nanoid();
  await db.insert(users).values({
    id: approverId,
    tenantId,
    email: `drawer-approver-${approverId}@example.test`,
    name: 'Drawer Approver',
    passwordHash: 'not-used-by-router-tests',
    role: 'manager',
    isActive: true,
    createdAt: now(),
    updatedAt: now(),
  });

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
  await getDatabase().delete(hardwareOutbox).where(eq(hardwareOutbox.tenantId, tenantId));
  await getDatabase().delete(sitePeripherals).where(eq(sitePeripherals.tenantId, tenantId));
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
  it('requires a one-time approval when a cashier targets a registered drawer', async () => {
    const adminCaller = appRouter.createCaller(buildContext('admin'));
    await adminCaller.peripherals.register({
      siteId,
      kind: 'cash_drawer',
      driver: 'escpos',
      config: { channel: 'mock' },
    });
    const caller = appRouter.createCaller(buildContext('cashier'));
    await expect(caller.peripherals.kickCashDrawer({ siteId })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_REQUIRED' }),
    });
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

  it('consumes an exact cashier grant and records both approval and drawer evidence', async () => {
    const mock = new MockEscPosTransport();
    __setEscPosTransportForTest(mock);
    const adminCaller = appRouter.createCaller(buildContext('admin'));
    await adminCaller.peripherals.register({
      siteId,
      kind: 'cash_drawer',
      driver: 'escpos',
      config: { channel: 'mock' },
    });
    const approvalRequestId = nanoid();
    const timestamp = now();
    await getDatabase()
      .insert(managerApprovalRequests)
      .values({
        id: approvalRequestId,
        tenantId,
        siteId,
        requesterId: userId,
        action: 'cash_drawer_open',
        status: 'approved',
        reason: 'Cashier needs change',
        resourceType: 'site',
        resourceId: siteId,
        summary: { label: 'Main site' },
        requestedAt: timestamp,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        decidedAt: timestamp,
        decidedBy: approverId,
        grantExpiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const cashierCaller = appRouter.createCaller(buildContext('cashier'));
    await expect(
      cashierCaller.peripherals.kickCashDrawer({ siteId, approvalRequestId })
    ).resolves.toEqual({ status: 'ok' });
    const consumed = await getDatabase()
      .select({ status: managerApprovalRequests.status })
      .from(managerApprovalRequests)
      .where(eq(managerApprovalRequests.id, approvalRequestId))
      .get();
    expect(consumed?.status).toBe('consumed');
    const evidence = await getDatabase()
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.actorId, userId),
          eq(auditLogs.resourceId, siteId)
        )
      )
      .all();
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'cash_drawer.open',
          metadata: expect.objectContaining({ approvalRequestId, approverId }),
        }),
      ])
    );
  });

  it('forces a direct manager through approval after the configured no-sale cap', async () => {
    const db = getDatabase();
    const previous = resolveLossPreventionSettings(db, tenantId);
    writeLossPreventionSettings(db, tenantId, {
      ...previous,
      roles: {
        ...previous.roles,
        manager: {
          ...previous.roles.manager,
          shift: {
            ...previous.roles.manager.shift,
            noSale: { enabled: true, maxCount: 0 },
          },
        },
      },
    });
    try {
      const mock = new MockEscPosTransport();
      __setEscPosTransportForTest(mock);
      const adminCaller = appRouter.createCaller(buildContext('admin'));
      await adminCaller.peripherals.register({
        siteId,
        kind: 'cash_drawer',
        driver: 'escpos',
        config: { channel: 'mock' },
      });
      const managerCaller = appRouter.createCaller(buildContext('manager'));
      await expect(managerCaller.peripherals.kickCashDrawer({ siteId })).rejects.toMatchObject({
        cause: expect.objectContaining({ errorCode: 'MANAGER_APPROVAL_REQUIRED' }),
      });

      const approvalRequestId = nanoid();
      const timestamp = now();
      await db.insert(managerApprovalRequests).values({
        id: approvalRequestId,
        tenantId,
        siteId,
        requesterId: userId,
        action: 'cash_drawer_open',
        status: 'approved',
        reason: 'Manager no-sale cap exceeded',
        resourceType: 'site',
        resourceId: siteId,
        summary: { label: 'Main site' },
        requestedAt: timestamp,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        decidedAt: timestamp,
        decidedBy: approverId,
        grantExpiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await expect(
        appRouter
          .createCaller(buildContext('manager'))
          .peripherals.kickCashDrawer({ siteId, approvalRequestId })
      ).resolves.toEqual({ status: 'ok' });
      expect(mock.buffer()).toEqual(ESCPOS_BYTES.DRAWER_KICK);

      const consumed = await db
        .select({ status: managerApprovalRequests.status })
        .from(managerApprovalRequests)
        .where(eq(managerApprovalRequests.id, approvalRequestId))
        .get();
      expect(consumed?.status).toBe('consumed');
      const trigger = await db
        .select({ after: auditLogs.after, metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.action, 'loss_prevention.triggered'),
            eq(auditLogs.resourceId, 'no_sale_limit')
          )
        )
        .all();
      expect(trigger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            after: expect.objectContaining({
              requiredAction: 'cash_drawer_open',
              approvalProvided: true,
            }),
            metadata: expect.objectContaining({ actionResourceId: siteId }),
          }),
        ])
      );
    } finally {
      writeLossPreventionSettings(db, tenantId, previous);
    }
  });

  it('keeps a cashier grant consumed when hardware failure is ambiguous', async () => {
    const failing: EscPosTransport = {
      async write() {
        throw new EscPosTransportError('Timed out after dispatch', {
          kind: 'DEVICE_TIMEOUT',
          message: 'Drawer outcome unknown',
        });
      },
      async close() {},
    };
    __setEscPosTransportForTest(failing);
    const adminCaller = appRouter.createCaller(buildContext('admin'));
    await adminCaller.peripherals.register({
      siteId,
      kind: 'cash_drawer',
      driver: 'escpos',
      config: { channel: 'mock' },
    });
    const approvalRequestId = nanoid();
    const timestamp = now();
    await getDatabase()
      .insert(managerApprovalRequests)
      .values({
        id: approvalRequestId,
        tenantId,
        siteId,
        requesterId: userId,
        action: 'cash_drawer_open',
        status: 'approved',
        reason: 'Open after count',
        resourceType: 'site',
        resourceId: siteId,
        summary: { label: 'Main site' },
        requestedAt: timestamp,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        decidedAt: timestamp,
        decidedBy: approverId,
        grantExpiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const result = await appRouter
      .createCaller(buildContext('cashier'))
      .peripherals.kickCashDrawer({ siteId, approvalRequestId });
    expect(result.status).toBe('error');
    const consumed = await getDatabase()
      .select({ status: managerApprovalRequests.status })
      .from(managerApprovalRequests)
      .where(eq(managerApprovalRequests.id, approvalRequestId))
      .get();
    expect(consumed?.status).toBe('consumed');
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
      payload: { kind: 'print-receipt', document: { lines: [] }, siteId } as Record<
        string,
        unknown
      >,
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
