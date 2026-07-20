/**
 * `operations.needsAttention` tests.
 *
 * Pins the contract for the Operations "Needs attention" landing:
 *
 * - All clear → empty `areas`, `totalCount` 0, `highestSeverity` null.
 * - Fiscal / hardware / payment outbox failures → that area as `danger`
 * with the failing-row count.
 * - Sync conflicts → `danger`; a large pending backlog with no
 * conflicts → `warning`; conflicts outrank the backlog.
 * - Multiple areas aggregate `totalCount` + `highestSeverity`.
 * - Cross-tenant isolation: tenant A's outbox failures never surface
 * for tenant B.
 * - Cashier is rejected (manager/admin only).
 *
 * @module __tests__/operations-needs-attention.test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  companies,
  fiscalOutbox,
  hardwareOutbox,
  paymentOutbox,
  sites,
  syncConflicts,
  syncOutbox,
  tenants,
  users,
  type HardwareOutboxStatus,
  type PaymentOutboxStatus,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let foreignTenantId: string;

function buildCtx(args: {
  tenantId: string;
  userId: string;
  role?: 'admin' | 'manager' | 'cashier' | 'viewer';
}): Context {
  const role = args.role ?? 'admin';
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId: args.userId,
        email: `${args.userId}@example.com`,
        role,
        tenantId: args.tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: args.userId,
      email: `${args.userId}@example.com`,
      role,
      tenantId: args.tenantId,
    },
    tenantId: args.tenantId,
    siteId: null,
  };
}

const now = () => new Date().toISOString();

async function seedFiscalFailure(forTenant: string, status: 'rejected' | 'dead_letter') {
  await getDatabase()
    .insert(fiscalOutbox)
    .values({
      id: nanoid(),
      tenantId: forTenant,
      status,
      kind: 'emit',
      providerId: 'mock-co',
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 1,
      createdAt: now(),
      updatedAt: now(),
    });
}

async function seedHardwareFailure(forTenant: string, status: HardwareOutboxStatus) {
  await getDatabase()
    .insert(hardwareOutbox)
    .values({
      id: nanoid(),
      tenantId: forTenant,
      status,
      kind: 'print-receipt',
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 1,
      priority: 0,
      createdAt: now(),
      updatedAt: now(),
    });
}

async function seedPaymentFailure(forTenant: string, status: PaymentOutboxStatus) {
  await getDatabase()
    .insert(paymentOutbox)
    .values({
      id: nanoid(),
      tenantId: forTenant,
      salePaymentId: null,
      railId: 'wompi',
      kind: 'charge',
      status,
      amount: 50_000,
      currencyCode: 'COP',
      reference: `REF-${nanoid(6)}`,
      providerTransactionId: null,
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 1,
      priority: 0,
      createdAt: now(),
      updatedAt: now(),
    });
}

async function seedSyncRow(forTenant: string, status: 'queued' | 'conflict' | 'dead_letter') {
  await getDatabase()
    .insert(syncOutbox)
    .values({
      id: nanoid(),
      tenantId: forTenant,
      status,
      entityType: 'products',
      entityId: nanoid(),
      operation: 'update',
      conflictPolicy: 'auto_lww',
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 1,
      createdAt: now(),
      updatedAt: now(),
    });
}

async function seedSyncConflict(forTenant: string) {
  await getDatabase()
    .insert(syncConflicts)
    .values({
      id: nanoid(),
      tenantId: forTenant,
      entityType: 'products',
      entityId: nanoid(),
      localData: { fixture: true },
      remoteData: { fixture: false },
      status: 'pending',
      createdAt: now(),
    });
}

async function clearOutboxes() {
  const db = getDatabase();
  for (const t of [tenantId, foreignTenantId]) {
    await db.delete(fiscalOutbox).where(eq(fiscalOutbox.tenantId, t));
    await db.delete(hardwareOutbox).where(eq(hardwareOutbox.tenantId, t));
    await db.delete(paymentOutbox).where(eq(paymentOutbox.tenantId, t));
    await db.delete(syncConflicts).where(eq(syncConflicts.tenantId, t));
    await db.delete(syncOutbox).where(eq(syncOutbox.tenantId, t));
  }
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();

  const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin');
  tenantId = admin.tenantId;
  userId = admin.id;

  // Foreign tenant for cross-tenant isolation.
  foreignTenantId = nanoid();
  const foreignCompanyId = nanoid();
  await db.insert(tenants).values({
    id: foreignTenantId,
    name: 'Ops Foreign Tenant',
    slug: `ops-foreign-${foreignTenantId.slice(0, 8)}`,
    createdAt: now(),
    updatedAt: now(),
  });
  await db.insert(companies).values({
    id: foreignCompanyId,
    tenantId: foreignTenantId,
    name: 'Ops Foreign Company',
    createdAt: now(),
    updatedAt: now(),
  });
  await db.insert(sites).values({
    id: nanoid(),
    tenantId: foreignTenantId,
    companyId: foreignCompanyId,
    name: 'Ops Foreign Site',
    isActive: true,
  });
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  await clearOutboxes();
});

describe('operations.needsAttention', () => {
  it('returns all-clear when no outbox failures exist', async () => {
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.operations.needsAttention();
    expect(result.areas).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.highestSeverity).toBeNull();
  });

  it('surfaces fiscal outbox failures as a danger area', async () => {
    await seedFiscalFailure(tenantId, 'rejected');
    await seedFiscalFailure(tenantId, 'dead_letter');
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.operations.needsAttention();
    const fiscal = result.areas.find(a => a.area === 'fiscal');
    expect(fiscal).toEqual({ area: 'fiscal', severity: 'danger', count: 2 });
    expect(result.highestSeverity).toBe('danger');
  });

  it('surfaces hardware outbox failures (device area)', async () => {
    await seedHardwareFailure(tenantId, 'dead_letter');
    await seedHardwareFailure(tenantId, 'failed');
    // a healthy 'printed' row must NOT count
    await seedHardwareFailure(tenantId, 'printed');
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.operations.needsAttention();
    expect(result.areas.find(a => a.area === 'device')).toEqual({
      area: 'device',
      severity: 'danger',
      count: 2,
    });
  });

  it('surfaces payment outbox failures', async () => {
    await seedPaymentFailure(tenantId, 'declined');
    // a settled row must NOT count
    await seedPaymentFailure(tenantId, 'settled');
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.operations.needsAttention();
    expect(result.areas.find(a => a.area === 'payments')).toEqual({
      area: 'payments',
      severity: 'danger',
      count: 1,
    });
  });

  it('marks sync conflicts as danger and outranks a pending backlog', async () => {
    await seedSyncConflict(tenantId);
    // also a big pending backlog — conflicts must win the row
    for (let i = 0; i < 30; i += 1) {
      await seedSyncRow(tenantId, 'queued');
    }
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.operations.needsAttention();
    expect(result.areas.find(a => a.area === 'sync')).toEqual({
      area: 'sync',
      severity: 'danger',
      count: 1,
    });
  });

  it('marks a large pending backlog (no conflicts) as warning', async () => {
    for (let i = 0; i < 26; i += 1) {
      await seedSyncRow(tenantId, 'queued');
    }
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.operations.needsAttention();
    expect(result.areas.find(a => a.area === 'sync')).toEqual({
      area: 'sync',
      severity: 'warning',
      count: 26,
    });
    expect(result.highestSeverity).toBe('warning');
  });

  it('aggregates totalCount and highestSeverity across areas', async () => {
    await seedFiscalFailure(tenantId, 'rejected');
    for (let i = 0; i < 26; i += 1) {
      await seedSyncRow(tenantId, 'queued');
    }
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.operations.needsAttention();
    const areas = result.areas.map(a => a.area).sort();
    expect(areas).toEqual(['fiscal', 'sync']);
    expect(result.totalCount).toBe(1 + 26);
    // danger (fiscal) wins over the sync warning
    expect(result.highestSeverity).toBe('danger');
  });

  it('does not leak another tenant outbox failures', async () => {
    await seedFiscalFailure(foreignTenantId, 'rejected');
    await seedHardwareFailure(foreignTenantId, 'dead_letter');
    await seedPaymentFailure(foreignTenantId, 'declined');
    await seedSyncConflict(foreignTenantId);
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId }));
    const result = await caller.operations.needsAttention();
    expect(result.areas).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('rejects a cashier (manager/admin only)', async () => {
    const caller = appRouter.createCaller(buildCtx({ tenantId, userId, role: 'cashier' }));
    await expect(caller.operations.needsAttention()).rejects.toThrow();
  });
});
