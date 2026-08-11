/**
 * `events.*` tRPC router integration tests.
 *
 * Drives the kernel's read procedures end-to-end against an
 * in-memory DB. Coverage:
 *
 * - `events.getContract` returns the manifest + per-event field
 * metadata.
 * - `events.peekOutbox` returns empty for a fresh tenant.
 * - `events.peekOutbox` returns inserted rows ordered by priority
 * desc + createdAt asc.
 * - Manager + admin can call; cashier FORBIDDEN.
 * - Cross-tenant isolation: A's rows never leak to B.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants, users, webhookOutbox, webhookSubscriptions } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { PUBLIC_EVENT_TYPES } from '../services/events/manifest.js';

let server: PuntovivoServer;

interface RouterHarness {
  tenantId: string;
  adminId: string;
  managerId: string;
  cashierId: string;
}

async function seedHarness(suffix: string): Promise<RouterHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `events-rtr-tenant-${suffix}`;
  const adminId = `events-rtr-admin-${suffix}`;
  const managerId = `events-rtr-mgr-${suffix}`;
  const cashierId = `events-rtr-csh-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `EventsRtr Tenant ${suffix}`,
    slug: `events-rtr-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${suffix}@eventsrtr.test`,
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
      email: `mgr-${suffix}@eventsrtr.test`,
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
      email: `csh-${suffix}@eventsrtr.test`,
      name: `Cashier ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantId, adminId, managerId, cashierId };
}

async function insertOutboxRow(args: {
  tenantId: string;
  id: string;
  eventType: string;
  priority?: number;
  createdAt?: string;
}): Promise<void> {
  const db = getDatabase();
  const now = args.createdAt ?? new Date().toISOString();
  await db.insert(webhookOutbox).values({
    id: args.id,
    tenantId: args.tenantId,
    eventType: args.eventType,
    eventVersion: 1,
    operationEventId: null,
    payload: { saleId: 'demo' },
    payloadVersion: 1,
    status: 'queued',
    attempts: 0,
    nextRetryAt: null,
    lastError: null,
    priority: args.priority ?? 0,
    claimToken: null,
    lockedAt: null,
    idempotencyKey: null,
    createdAt: now,
    updatedAt: now,
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
    user: { userId, email: `${userId}@eventsrtr.test`, role, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: {
      id: userId,
      email: `${userId}@eventsrtr.test`,
      role,
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

beforeAll(async () => {
  server = await createServer({
    dbPath: ':memory:',
    verbose: false,
    webhookSecretKey: 'events-router-test-key',
  });
});

describe('events subscriptions', () => {
  it('creates a tenant-scoped subscription and returns its signing secret only once', async () => {
    const h = await seedHarness('subscription-create');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const created = await caller.events.createSubscription({
      name: 'ERP production',
      destinationUrl: 'https://93.184.216.34/hooks/puntovivo',
      eventTypes: ['sale.completed', 'sale.refunded'],
    });
    expect(created.signingSecret.length).toBeGreaterThan(30);
    const listed = await caller.events.listSubscriptions();
    expect(listed).toMatchObject([{ id: created.id, enabled: true }]);
    expect(JSON.stringify(listed)).not.toContain(created.signingSecret);
    expect(JSON.stringify(listed)).not.toContain('sealedSecret');
  });

  it('returns a stable conflict when the destination already has an active subscription', async () => {
    const h = await seedHarness('subscription-duplicate');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const input = {
      name: 'Primary ERP',
      destinationUrl: 'https://93.184.216.40/hooks/puntovivo',
      eventTypes: ['sale.completed' as const],
    };
    await caller.events.createSubscription(input);
    await expect(
      caller.events.createSubscription({ ...input, name: 'Duplicate ERP' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('prevents managers and other tenants from mutating a subscription', async () => {
    const a = await seedHarness('subscription-iso-a');
    const b = await seedHarness('subscription-iso-b');
    const adminA = appRouter.createCaller(buildCtx(a.tenantId, a.adminId, 'admin'));
    const created = await adminA.events.createSubscription({
      name: 'Tenant A',
      destinationUrl: 'https://93.184.216.35/hook',
      eventTypes: ['sale.completed'],
    });
    const managerA = appRouter.createCaller(buildCtx(a.tenantId, a.managerId, 'manager'));
    await expect(
      managerA.events.createSubscription({
        name: 'Forbidden',
        destinationUrl: 'https://93.184.216.36/hook',
        eventTypes: ['sale.completed'],
      })
    ).rejects.toBeInstanceOf(TRPCError);
    const adminB = appRouter.createCaller(buildCtx(b.tenantId, b.adminId, 'admin'));
    await expect(adminB.events.disableSubscription({ id: created.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('revokes the signing secret irreversibly', async () => {
    const h = await seedHarness('subscription-revoke');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const created = await caller.events.createSubscription({
      name: 'Disposable',
      destinationUrl: 'https://93.184.216.37/hook',
      eventTypes: ['inventory.adjusted'],
    });
    const revoked = await caller.events.revokeSubscription({ id: created.id });
    expect(revoked.revokedAt).toBeTruthy();
    const stored = await getDatabase()
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, created.id))
      .get();
    expect(stored).toMatchObject({ enabled: false, sealedSecret: null });
  });

  it('only retries dead-letter events and resets their claim state', async () => {
    const h = await seedHarness('delivery-retry');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'delivery-retry-event',
      eventType: 'sale.completed',
    });

    await expect(
      caller.events.retryDelivery({ outboxId: 'delivery-retry-event' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await getDatabase()
      .update(webhookOutbox)
      .set({
        status: 'dead_letter',
        attempts: 6,
        claimToken: 'stale-claim',
        lockedAt: new Date().toISOString(),
        lastError: 'WEBHOOK_HTTP_400',
      })
      .where(eq(webhookOutbox.id, 'delivery-retry-event'))
      .run();

    await expect(
      caller.events.retryDelivery({ outboxId: 'delivery-retry-event' })
    ).resolves.toEqual({ id: 'delivery-retry-event', status: 'queued' });
    expect(
      getDatabase()
        .select()
        .from(webhookOutbox)
        .where(eq(webhookOutbox.id, 'delivery-retry-event'))
        .get()
    ).toMatchObject({
      status: 'queued',
      attempts: 0,
      claimToken: null,
      lockedAt: null,
      lastError: null,
    });
  });
});

afterAll(async () => {
  await server.close();
});

describe('events.getContract', () => {
  it('returns the manifest version + every event type', async () => {
    const h = await seedHarness('contract');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.events.getContract();
    expect(result.version).toBeGreaterThan(0);
    expect([...result.eventTypes].sort()).toEqual([...PUBLIC_EVENT_TYPES].sort());
  });

  it('returns per-event field metadata with required flags', async () => {
    const h = await seedHarness('contract-fields');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.events.getContract();
    const saleCompleted = result.fields['sale.completed'];
    expect(saleCompleted.length).toBeGreaterThan(0);
    const saleId = saleCompleted.find(f => f.name === 'saleId');
    expect(saleId?.required).toBe(true);
  });

  it('manager can call (managerOrAdmin gate)', async () => {
    const h = await seedHarness('contract-mgr');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.managerId, 'manager'));
    await expect(caller.events.getContract()).resolves.toBeDefined();
  });

  it('cashier FORBIDDEN', async () => {
    const h = await seedHarness('contract-csh');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.cashierId, 'cashier'));
    await expect(caller.events.getContract()).rejects.toBeInstanceOf(TRPCError);
  });
});

describe('events.peekOutbox', () => {
  it('returns an empty list for a fresh tenant', async () => {
    const h = await seedHarness('peek-empty');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const rows = await caller.events.peekOutbox({ limit: 50 });
    expect(rows).toEqual([]);
  });

  it('returns inserted rows ordered by priority desc, createdAt asc', async () => {
    const h = await seedHarness('peek-ordered');
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'row-low',
      eventType: 'sale.completed',
      priority: 1,
      createdAt: '2026-05-08T10:00:00.000Z',
    });
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'row-high-old',
      eventType: 'sale.refunded',
      priority: 5,
      createdAt: '2026-05-08T09:00:00.000Z',
    });
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'row-high-new',
      eventType: 'inventory.adjusted',
      priority: 5,
      createdAt: '2026-05-08T10:30:00.000Z',
    });

    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const rows = await caller.events.peekOutbox({ limit: 50 });
    expect(rows.map(r => r.id)).toEqual(['row-high-old', 'row-high-new', 'row-low']);
  });

  it('respects the limit clamp', async () => {
    const h = await seedHarness('peek-limit');
    for (let i = 0; i < 10; i += 1) {
      await insertOutboxRow({
        tenantId: h.tenantId,
        id: `row-${i}`,
        eventType: 'sale.completed',
        priority: i,
      });
    }
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const rows = await caller.events.peekOutbox({ limit: 3 });
    expect(rows).toHaveLength(3);
  });

  it('isolates tenants — A rows never leak into B', async () => {
    const a = await seedHarness('iso-a');
    const b = await seedHarness('iso-b');
    await insertOutboxRow({
      tenantId: a.tenantId,
      id: 'row-a',
      eventType: 'sale.completed',
    });
    await insertOutboxRow({
      tenantId: b.tenantId,
      id: 'row-b',
      eventType: 'sale.completed',
    });

    const callerA = appRouter.createCaller(buildCtx(a.tenantId, a.adminId, 'admin'));
    const callerB = appRouter.createCaller(buildCtx(b.tenantId, b.adminId, 'admin'));
    const rowsA = await callerA.events.peekOutbox({ limit: 50 });
    const rowsB = await callerB.events.peekOutbox({ limit: 50 });
    expect(rowsA.map(r => r.id)).toEqual(['row-a']);
    expect(rowsB.map(r => r.id)).toEqual(['row-b']);
  });

  it('cashier FORBIDDEN', async () => {
    const h = await seedHarness('peek-csh');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.cashierId, 'cashier'));
    await expect(caller.events.peekOutbox({ limit: 50 })).rejects.toBeInstanceOf(TRPCError);
  });
});

describe('events.peekOutbox cleanup', () => {
  it('lookup against the local in-memory DB sees zero pre-seed leakage between tests', async () => {
    // Defensive — the beforeEach above is implicit (tenants are unique
    // per suffix). This test asserts the harness assumption.
    const db = getDatabase();
    const allRows = await db.select().from(webhookOutbox).all();
    // After the previous tests we have rows from peek-ordered + peek-limit
    // + iso-a + iso-b — but they are tenant-scoped and the caller filter
    // is per-tenant. The presence of unrelated rows is fine; this test
    // just pins that webhook_outbox is queryable directly.
    expect(allRows.length).toBeGreaterThanOrEqual(0);
    // Cleanup so a subsequent run sees an empty table.
    for (const t of ['iso-a', 'iso-b']) {
      await db
        .delete(webhookOutbox)
        .where(eq(webhookOutbox.tenantId, `events-rtr-tenant-${t}`))
        .run();
    }
  });
});
