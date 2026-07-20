/**
 * admin retry + mark-settled mutation tests for the
 * `payments.*` router. Pinned: role gates, tenant scope, state
 * transitions, audit-log emission, idempotency on already-settled rows.
 */

import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, paymentOutbox, tenants, users, type PaymentRailId } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

interface MutationHarness {
  tenantId: string;
  adminId: string;
  managerId: string;
  cashierId: string;
}

async function seedHarness(suffix: string): Promise<MutationHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `pay-mut-tenant-${suffix}`;
  const adminId = `pay-mut-admin-${suffix}`;
  const managerId = `pay-mut-mgr-${suffix}`;
  const cashierId = `pay-mut-csh-${suffix}`;
  await db.insert(tenants).values({
    id: tenantId,
    name: `PayMut Tenant ${suffix}`,
    slug: `pay-mut-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${suffix}@paymut.test`,
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
      email: `mgr-${suffix}@paymut.test`,
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
      email: `csh-${suffix}@paymut.test`,
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
  attempts?: number;
  providerTransactionId?: string | null;
}): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.insert(paymentOutbox).values({
    id: args.id,
    tenantId: args.tenantId,
    salePaymentId: null,
    railId: args.railId,
    kind: 'charge',
    status: args.status,
    amount: 100_000,
    currencyCode: 'COP',
    reference: args.id,
    providerTransactionId: args.providerTransactionId ?? null,
    payload: { fixture: true },
    payloadVersion: 1,
    attempts: args.attempts ?? 0,
    nextRetryAt: '2026-05-13T00:00:00.000Z',
    lastError: { kind: 'PROVIDER_TIMEOUT', message: 'stale' },
    priority: 0,
    claimToken: 'old:claim',
    lockedAt: '2026-05-12T23:55:00.000Z',
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
    user: { userId, email: `${userId}@paymut.test`, role, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: {
      id: userId,
      email: `${userId}@paymut.test`,
      role,
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

async function readOutbox(outboxId: string) {
  const db = getDatabase();
  return db.select().from(paymentOutbox).where(eq(paymentOutbox.id, outboxId)).get();
}

async function readLatestAudit(
  tenantId: string,
  resourceId: string,
  action: 'payment.retry' | 'payment.mark_settled'
) {
  const db = getDatabase();
  return db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, tenantId),
        eq(auditLogs.resourceId, resourceId),
        eq(auditLogs.action, action)
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .get();
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

describe('payments.retryOutbox', () => {
  it('admin resets a dead_letter row back to queued with zeroed retry budget', async () => {
    const h = await seedHarness('retry-deadletter');
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'retry-dl',
      railId: 'wompi',
      status: 'dead_letter',
      attempts: 6,
      providerTransactionId: 'wompi-tx-zzz',
    });
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.payments.retryOutbox({ outboxId: 'retry-dl' });
    expect(result).toMatchObject({
      outboxId: 'retry-dl',
      status: 'queued',
      attempts: 0,
    });
    const row = await readOutbox('retry-dl');
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(0);
    expect(row?.nextRetryAt).toBeNull();
    expect(row?.claimToken).toBeNull();
    expect(row?.lockedAt).toBeNull();
    expect(row?.lastError).toBeNull();
    const audit = await readLatestAudit(h.tenantId, 'retry-dl', 'payment.retry');
    expect(audit).toBeDefined();
    expect(audit?.before).toMatchObject({ status: 'dead_letter', attempts: 6 });
    expect(audit?.after).toMatchObject({ status: 'queued', attempts: 0 });
    expect(audit?.metadata).toMatchObject({ railId: 'wompi' });
  });

  it('admin retries a retrying row in the same way', async () => {
    const h = await seedHarness('retry-retrying');
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'retry-rt',
      railId: 'bold',
      status: 'retrying',
      attempts: 3,
    });
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await caller.payments.retryOutbox({ outboxId: 'retry-rt' });
    const row = await readOutbox('retry-rt');
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(0);
  });

  it('refuses to retry a settled row with PAYMENT_OUTBOX_NOT_RETRIABLE', async () => {
    const h = await seedHarness('retry-settled');
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'retry-st',
      railId: 'epayco',
      status: 'settled',
      attempts: 0,
    });
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await expect(caller.payments.retryOutbox({ outboxId: 'retry-st' })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'PAYMENT_OUTBOX_NOT_RETRIABLE' }),
    });
  });

  it('refuses to retry an approved row to avoid a double-charge risk', async () => {
    const h = await seedHarness('retry-approved');
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'retry-ap',
      railId: 'wompi',
      status: 'approved',
      attempts: 0,
    });
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await expect(caller.payments.retryOutbox({ outboxId: 'retry-ap' })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'PAYMENT_OUTBOX_NOT_RETRIABLE' }),
    });
    const row = await readOutbox('retry-ap');
    expect(row?.status).toBe('approved');
  });

  it('refuses to retry a submitting row to avoid worker race', async () => {
    const h = await seedHarness('retry-submitting');
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'retry-sb',
      railId: 'bold',
      status: 'submitting',
      attempts: 1,
    });
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await expect(caller.payments.retryOutbox({ outboxId: 'retry-sb' })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'PAYMENT_OUTBOX_NOT_RETRIABLE' }),
    });
  });

  it('returns PAYMENT_OUTBOX_NOT_FOUND for a missing id', async () => {
    const h = await seedHarness('retry-missing');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await expect(caller.payments.retryOutbox({ outboxId: 'nope' })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'PAYMENT_OUTBOX_NOT_FOUND' }),
    });
  });

  it('cross-tenant retry collapses to NOT_FOUND (never leaks existence)', async () => {
    const a = await seedHarness('retry-tenant-a');
    const b = await seedHarness('retry-tenant-b');
    await insertOutboxRow({
      tenantId: b.tenantId,
      id: 'retry-cross',
      railId: 'wompi',
      status: 'dead_letter',
      attempts: 6,
    });
    const callerFromA = appRouter.createCaller(buildCtx(a.tenantId, a.adminId, 'admin'));
    await expect(
      callerFromA.payments.retryOutbox({ outboxId: 'retry-cross' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'PAYMENT_OUTBOX_NOT_FOUND' }),
    });
    // Tenant B's row stays untouched.
    const row = await readOutbox('retry-cross');
    expect(row?.status).toBe('dead_letter');
    expect(row?.attempts).toBe(6);
  });

  it('manager attempting retry is FORBIDDEN', async () => {
    const h = await seedHarness('retry-mgr');
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'retry-mgr',
      railId: 'mercado_pago',
      status: 'dead_letter',
      attempts: 6,
    });
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.managerId, 'manager'));
    await expect(caller.payments.retryOutbox({ outboxId: 'retry-mgr' })).rejects.toBeInstanceOf(
      TRPCError
    );
  });
});

describe('payments.markSettled', () => {
  it('admin flips an approved row to settled and writes audit', async () => {
    const h = await seedHarness('settle-approved');
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'settle-ap',
      railId: 'wompi',
      status: 'approved',
      providerTransactionId: 'wompi-tx-original',
    });
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.payments.markSettled({
      outboxId: 'settle-ap',
      providerTransactionId: 'wompi-tx-manual',
    });
    expect(result).toMatchObject({
      outboxId: 'settle-ap',
      status: 'settled',
      providerTransactionId: 'wompi-tx-manual',
    });
    const row = await readOutbox('settle-ap');
    expect(row?.status).toBe('settled');
    expect(row?.providerTransactionId).toBe('wompi-tx-manual');
    expect(row?.claimToken).toBeNull();
    expect(row?.lockedAt).toBeNull();
    const audit = await readLatestAudit(h.tenantId, 'settle-ap', 'payment.mark_settled');
    expect(audit?.before).toMatchObject({
      status: 'approved',
      providerTransactionId: 'wompi-tx-original',
    });
    expect(audit?.after).toMatchObject({
      status: 'settled',
      providerTransactionId: 'wompi-tx-manual',
    });
  });

  it('admin can mark a declined row settled (operator override of hard decline)', async () => {
    const h = await seedHarness('settle-declined');
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'settle-dc',
      railId: 'bold',
      status: 'declined',
    });
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await caller.payments.markSettled({ outboxId: 'settle-dc' });
    const row = await readOutbox('settle-dc');
    expect(row?.status).toBe('settled');
  });

  it('normalizes blank providerTransactionId overrides to omitted', async () => {
    const h = await seedHarness('settle-blank-tx');
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'settle-blank-tx',
      railId: 'wompi',
      status: 'approved',
      providerTransactionId: 'wompi-tx-existing',
    });
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await caller.payments.markSettled({
      outboxId: 'settle-blank-tx',
      providerTransactionId: '   ',
    });
    const row = await readOutbox('settle-blank-tx');
    expect(row?.status).toBe('settled');
    expect(row?.providerTransactionId).toBe('wompi-tx-existing');
  });

  it('mark-settled is idempotent on already-settled rows (no second audit row)', async () => {
    const h = await seedHarness('settle-idempotent');
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'settle-idem',
      railId: 'wompi',
      status: 'settled',
      providerTransactionId: 'wompi-tx-final',
    });
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.payments.markSettled({ outboxId: 'settle-idem' });
    expect(result.providerTransactionId).toBe('wompi-tx-final');
    const db = getDatabase();
    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, h.tenantId),
          eq(auditLogs.resourceId, 'settle-idem'),
          eq(auditLogs.action, 'payment.mark_settled')
        )
      )
      .all();
    expect(auditRows.length).toBe(0);
  });

  it('mark-settled on already-settled row UPDATES providerTransactionId when caller supplies a new one + emits audit + clears claim token', async () => {
    const h = await seedHarness('settle-update-txid');
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'settle-update',
      railId: 'epayco',
      status: 'settled',
      providerTransactionId: 'epayco-tx-old',
    });
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await caller.payments.markSettled({
      outboxId: 'settle-update',
      providerTransactionId: 'epayco-tx-new',
    });
    const row = await readOutbox('settle-update');
    expect(row?.providerTransactionId).toBe('epayco-tx-new');
    // HIGH 3 from code review: idempotent-update path must defensively
    // clear claim_token + locked_at — a settled row should never carry
    // an active claim from a worker that crashed mid-settle.
    expect(row?.claimToken).toBeNull();
    expect(row?.lockedAt).toBeNull();
    const audit = await readLatestAudit(h.tenantId, 'settle-update', 'payment.mark_settled');
    expect(audit?.metadata).toMatchObject({ alreadySettled: true });
  });

  it('cross-tenant mark-settled collapses to NOT_FOUND', async () => {
    const a = await seedHarness('settle-tenant-a');
    const b = await seedHarness('settle-tenant-b');
    await insertOutboxRow({
      tenantId: b.tenantId,
      id: 'settle-cross',
      railId: 'wompi',
      status: 'approved',
    });
    const callerFromA = appRouter.createCaller(buildCtx(a.tenantId, a.adminId, 'admin'));
    await expect(
      callerFromA.payments.markSettled({ outboxId: 'settle-cross' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'PAYMENT_OUTBOX_NOT_FOUND' }),
    });
    const row = await readOutbox('settle-cross');
    expect(row?.status).toBe('approved');
  });

  it('manager attempting mark-settled is FORBIDDEN', async () => {
    const h = await seedHarness('settle-mgr');
    await insertOutboxRow({
      tenantId: h.tenantId,
      id: 'settle-mgr',
      railId: 'nequi',
      status: 'declined',
    });
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.managerId, 'manager'));
    await expect(caller.payments.markSettled({ outboxId: 'settle-mgr' })).rejects.toBeInstanceOf(
      TRPCError
    );
  });
});
