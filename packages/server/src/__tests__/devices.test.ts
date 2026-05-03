/**
 * ENG-052 — Tests for the devices service + auth.registerDevice
 * tRPC procedure.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { hash } from 'argon2';
import { TRPCError } from '@trpc/server';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { devices, tenants, users } from '../db/schema.js';
import {
  deactivateDevice,
  findActiveDevice,
  markSeen,
  registerDevice,
} from '../services/devices/devicesService.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { eq } from 'drizzle-orm';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  tenantId = nanoid();
  userId = nanoid();
  await db.insert(tenants).values({
    id: tenantId,
    name: 'Devices Test',
    slug: `dev-${tenantId.slice(0, 6)}`,
    settings: {},
    isActive: true,
  });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `dev-${userId.slice(0, 6)}@test.local`,
    passwordHash: await hash('TestPassword123!'),
    name: 'Devices Tester',
    role: 'admin',
    isActive: true,
  });
});

describe('devicesService.registerDevice (ENG-052)', () => {
  it('creates a new active device row with server-generated id', async () => {
    const { deviceId, registeredAt } = await registerDevice(getDatabase(), {
      tenantId,
      userId,
      kind: 'web',
      name: 'cashier-01',
    });
    expect(deviceId).toMatch(/^[A-Za-z0-9_-]{10,}$/);
    expect(registeredAt).toBeDefined();

    const row = await getDatabase()
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId))
      .get();
    expect(row).toMatchObject({
      tenantId,
      kind: 'web',
      name: 'cashier-01',
      isActive: true,
      registeredByUserId: userId,
    });
  });

  it('idempotent on existing active deviceId — bumps last_seen only', async () => {
    const first = await registerDevice(getDatabase(), {
      tenantId,
      userId,
      kind: 'desktop',
      name: 'electron-1',
    });
    const second = await registerDevice(getDatabase(), {
      tenantId,
      userId,
      kind: 'desktop',
      name: 'electron-1',
      deviceId: first.deviceId,
    });
    expect(second.deviceId).toBe(first.deviceId);
    const rows = await getDatabase()
      .select()
      .from(devices)
      .where(eq(devices.id, first.deviceId))
      .all();
    expect(rows).toHaveLength(1);
  });

  it('cross-tenant deviceId is treated as a new registration', async () => {
    const otherTenantId = nanoid();
    const otherUserId = nanoid();
    await getDatabase().insert(tenants).values({
      id: otherTenantId,
      name: 'Other',
      slug: `other-${otherTenantId.slice(0, 6)}`,
      settings: {},
      isActive: true,
    });
    await getDatabase().insert(users).values({
      id: otherUserId,
      tenantId: otherTenantId,
      email: `other-${otherUserId.slice(0, 6)}@test.local`,
      passwordHash: await hash('Pass123!'),
      name: 'Other',
      role: 'admin',
      isActive: true,
    });
    const orig = await registerDevice(getDatabase(), {
      tenantId,
      userId,
      kind: 'web',
      name: 'name',
    });
    // Same id supplied to a different tenant: lookup misses, new row created.
    const otherReg = await registerDevice(getDatabase(), {
      tenantId: otherTenantId,
      userId: otherUserId,
      kind: 'web',
      name: 'name',
      deviceId: orig.deviceId,
    });
    expect(otherReg.deviceId).not.toBe(orig.deviceId);
  });

  it('persists metadata as JSON', async () => {
    const { deviceId } = await registerDevice(getDatabase(), {
      tenantId,
      userId,
      kind: 'web',
      name: 'meta',
      metadata: { os: 'macOS', ua: 'Chrome', appVersion: '1.0.0' },
    });
    const row = await getDatabase()
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId))
      .get();
    expect(row?.metadata).toMatchObject({ os: 'macOS', ua: 'Chrome' });
  });
});

describe('devicesService.findActiveDevice (ENG-052)', () => {
  it('returns row for active device on matching tenant', async () => {
    const reg = await registerDevice(getDatabase(), {
      tenantId,
      userId,
      kind: 'web',
      name: 'find-active',
    });
    const found = await findActiveDevice(getDatabase(), {
      tenantId,
      deviceId: reg.deviceId,
    });
    expect(found).toMatchObject({ id: reg.deviceId, tenantId, kind: 'web' });
  });

  it('returns null for unknown device id', async () => {
    const found = await findActiveDevice(getDatabase(), {
      tenantId,
      deviceId: 'non-existent',
    });
    expect(found).toBeNull();
  });

  it('returns null for cross-tenant lookup (multi-tenant isolation)', async () => {
    const reg = await registerDevice(getDatabase(), {
      tenantId,
      userId,
      kind: 'web',
      name: 'isolation',
    });
    const found = await findActiveDevice(getDatabase(), {
      tenantId: 'different-tenant',
      deviceId: reg.deviceId,
    });
    expect(found).toBeNull();
  });

  it('returns null for deactivated device', async () => {
    const reg = await registerDevice(getDatabase(), {
      tenantId,
      userId,
      kind: 'web',
      name: 'deactivated',
    });
    await deactivateDevice(getDatabase(), { tenantId, deviceId: reg.deviceId });
    const found = await findActiveDevice(getDatabase(), {
      tenantId,
      deviceId: reg.deviceId,
    });
    expect(found).toBeNull();
  });
});

describe('devicesService.markSeen (ENG-052)', () => {
  it('updates last_seen_at', async () => {
    const reg = await registerDevice(getDatabase(), {
      tenantId,
      userId,
      kind: 'web',
      name: 'mark-seen',
    });
    const future = new Date(Date.now() + 60_000);
    await markSeen(getDatabase(), { tenantId, deviceId: reg.deviceId }, future);
    const row = await getDatabase()
      .select()
      .from(devices)
      .where(eq(devices.id, reg.deviceId))
      .get();
    expect(row?.lastSeenAt).toBe(future.toISOString());
  });
});

describe('auth.registerDevice tRPC procedure (ENG-052)', () => {
  function callerWith(role: 'admin' | 'cashier' | 'manager'): ReturnType<typeof appRouter.createCaller> {
    const ctx: Context = {
      req: {
        server: server.app,
        headers: {},
        user: { userId, email: 'test', role, tenantId },
        jwtVerify: async () => {},
      } as unknown as Context['req'],
      res: {} as unknown as Context['res'],
      db: getDatabase(),
      user: { id: userId, email: 'test', role, tenantId },
      tenantId,
      siteId: null,
    };
    return appRouter.createCaller(ctx);
  }

  it('returns deviceId + registeredAt for valid input', async () => {
    const result = await callerWith('admin').auth.registerDevice({
      kind: 'desktop',
      name: 'tRPC-registered',
    });
    expect(result.deviceId).toMatch(/^[A-Za-z0-9_-]{10,}$/);
    expect(result.registeredAt).toBeDefined();
  });

  it('idempotent when same deviceId is supplied twice', async () => {
    const first = await callerWith('admin').auth.registerDevice({
      kind: 'desktop',
      name: 'twice',
    });
    const second = await callerWith('admin').auth.registerDevice({
      kind: 'desktop',
      name: 'twice',
      deviceId: first.deviceId,
    });
    expect(second.deviceId).toBe(first.deviceId);
  });

  it('rejects unauthenticated callers (no user in context)', async () => {
    const ctx: Context = {
      req: { server: server.app, headers: {}, user: null, jwtVerify: async () => {} } as unknown as Context['req'],
      res: {} as unknown as Context['res'],
      db: getDatabase(),
      user: null,
      tenantId: null,
      siteId: null,
    };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.auth.registerDevice({ kind: 'web', name: 'no-auth' })
    ).rejects.toThrow(TRPCError);
  });
});
