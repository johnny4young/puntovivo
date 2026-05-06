/**
 * ENG-065a — Tests for `peripherals.retryHardwareOutbox`.
 *
 * Mirrors the structure of `sync-contract-v1.test.ts`'s retry suite.
 * Asserts:
 *   - Admin gate (cashier + manager FORBIDDEN).
 *   - `HARDWARE_OUTBOX_NOT_FOUND` on unknown id.
 *   - `retrying` and `dead_letter` and `failed` rows reset to `queued`
 *     with attempts=0, lastError=null, claimToken=null, lockedAt=null,
 *     nextRetryAt=null.
 *   - `queued` / `submitting` / `printed` rows are no-ops (so a
 *     drained row cannot be replayed).
 *   - Cross-tenant isolation (foreign tenant cannot retry).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { hardwareOutbox, sites, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;

function buildContext(role: 'admin' | 'manager' | 'cashier' = 'admin'): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: 'admin@localhost', role, tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: { id: userId, email: 'admin@localhost', role, tenantId },
    tenantId,
    siteId,
  };
}

function expectErrorCode(error: unknown, code: string) {
  expect(error).toBeInstanceOf(TRPCError);
  const cause = (error as TRPCError).cause;
  expect(cause).toBeInstanceOf(ServerErrorWithCode);
  expect((cause as ServerErrorWithCode).errorCode).toBe(code);
}

async function insertHardwareRow(opts: {
  status:
    | 'queued'
    | 'submitting'
    | 'printed'
    | 'failed'
    | 'retrying'
    | 'dead_letter';
  attempts?: number;
  lastError?: Record<string, unknown> | null;
  claimToken?: string | null;
  lockedAt?: string | null;
  nextRetryAt?: string | null;
  tenantOverride?: string;
}): Promise<string> {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(hardwareOutbox).values({
    id,
    tenantId: opts.tenantOverride ?? tenantId,
    status: opts.status,
    kind: 'print-receipt',
    payload: { test: true },
    attempts: opts.attempts ?? 0,
    nextRetryAt: opts.nextRetryAt ?? null,
    lastError: opts.lastError ?? null,
    priority: 0,
    claimToken: opts.claimToken ?? null,
    lockedAt: opts.lockedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

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
});

afterAll(async () => {
  // In-memory DB is torn down with the server; no explicit cleanup
  // needed (and `getDatabase()` after `server.close()` throws).
  await server.close();
});

describe('peripherals.retryHardwareOutbox — admin gate', () => {
  it('rejects cashier with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(buildContext('cashier'));
    await expect(
      caller.peripherals.retryHardwareOutbox({ id: 'whatever' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects manager with FORBIDDEN (read-only role)', async () => {
    const caller = appRouter.createCaller(buildContext('manager'));
    await expect(
      caller.peripherals.retryHardwareOutbox({ id: 'whatever' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('peripherals.retryHardwareOutbox — admin path', () => {
  it('returns HARDWARE_OUTBOX_NOT_FOUND for unknown row id', async () => {
    const caller = appRouter.createCaller(buildContext('admin'));
    try {
      await caller.peripherals.retryHardwareOutbox({ id: 'never-existed' });
      throw new Error('Expected NOT_FOUND');
    } catch (err) {
      expectErrorCode(err, 'HARDWARE_OUTBOX_NOT_FOUND');
    }
  });

  it('resets a `retrying` row back to queued with all fields cleared', async () => {
    const id = await insertHardwareRow({
      status: 'retrying',
      attempts: 3,
      lastError: { kind: 'DEVICE_TIMEOUT', message: 'TCP read timed out' },
      claimToken: 'token-abc',
      lockedAt: new Date().toISOString(),
      nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const caller = appRouter.createCaller(buildContext('admin'));
    const result = await caller.peripherals.retryHardwareOutbox({ id });
    expect(result).toEqual({ ok: true, id });

    const row = await getDatabase()
      .select()
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.id, id))
      .get();
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(0);
    expect(row?.lastError).toBeNull();
    expect(row?.claimToken).toBeNull();
    expect(row?.lockedAt).toBeNull();
    expect(row?.nextRetryAt).toBeNull();
  });

  it('resets a `dead_letter` row back to queued', async () => {
    const id = await insertHardwareRow({
      status: 'dead_letter',
      attempts: 8,
      lastError: { kind: 'PERMISSION_DENIED', message: 'driver locked' },
    });

    const caller = appRouter.createCaller(buildContext('admin'));
    const result = await caller.peripherals.retryHardwareOutbox({ id });
    expect(result).toEqual({ ok: true, id });

    const row = await getDatabase()
      .select()
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.id, id))
      .get();
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(0);
    expect(row?.lastError).toBeNull();
  });

  it('resets a `failed` row back to queued', async () => {
    const id = await insertHardwareRow({
      status: 'failed',
      attempts: 1,
      lastError: { kind: 'PROTOCOL_ERROR', message: 'unexpected response' },
    });

    const caller = appRouter.createCaller(buildContext('admin'));
    await caller.peripherals.retryHardwareOutbox({ id });

    const row = await getDatabase()
      .select()
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.id, id))
      .get();
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(0);
  });

  it('is a no-op for `printed` rows (drained terminal state)', async () => {
    const id = await insertHardwareRow({
      status: 'printed',
      attempts: 1,
    });

    const caller = appRouter.createCaller(buildContext('admin'));
    const result = await caller.peripherals.retryHardwareOutbox({ id });
    expect(result).toEqual({ ok: true, id });

    const row = await getDatabase()
      .select()
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.id, id))
      .get();
    // No-op: the row stays at `printed`.
    expect(row?.status).toBe('printed');
    expect(row?.attempts).toBe(1);
  });

  it('is a no-op for `queued` and `submitting` rows', async () => {
    const queuedId = await insertHardwareRow({ status: 'queued' });
    const submittingId = await insertHardwareRow({ status: 'submitting' });

    const caller = appRouter.createCaller(buildContext('admin'));
    await caller.peripherals.retryHardwareOutbox({ id: queuedId });
    await caller.peripherals.retryHardwareOutbox({ id: submittingId });

    const queuedRow = await getDatabase()
      .select()
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.id, queuedId))
      .get();
    const submittingRow = await getDatabase()
      .select()
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.id, submittingId))
      .get();
    expect(queuedRow?.status).toBe('queued');
    expect(submittingRow?.status).toBe('submitting');
  });

  it('rejects cross-tenant retry with HARDWARE_OUTBOX_NOT_FOUND', async () => {
    // Insert a row owned by a foreign tenant; the current admin
    // caller (tenantId) must not see it. Need to seed the tenant
    // row first because `hardware_outbox.tenant_id` has a FK to
    // `tenants.id`.
    const foreignTenantId = 'foreign-tenant-' + nanoid(6);
    const db = getDatabase();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign Tenant',
      slug: `foreign-${nanoid(6)}`,
      settings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const id = await insertHardwareRow({
      status: 'retrying',
      attempts: 1,
      tenantOverride: foreignTenantId,
    });

    const caller = appRouter.createCaller(buildContext('admin'));
    try {
      await caller.peripherals.retryHardwareOutbox({ id });
      throw new Error('Expected NOT_FOUND');
    } catch (err) {
      expectErrorCode(err, 'HARDWARE_OUTBOX_NOT_FOUND');
    }

    // Foreign row was not touched.
    const row = await getDatabase()
      .select()
      .from(hardwareOutbox)
      .where(eq(hardwareOutbox.id, id))
      .get();
    expect(row?.status).toBe('retrying');
    expect(row?.attempts).toBe(1);
  });
});
