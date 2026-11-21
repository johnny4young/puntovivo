import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;

function buildContext(role: 'admin' | 'manager' | 'cashier'): Context {
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: 'admin@localhost', role, tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as unknown as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: 'admin@localhost', role, tenantId },
    tenantId,
    siteId: null,
  };
}

function storedSettings(): Record<string, unknown> {
  const row = getDatabase()
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  return (row?.settings ?? {}) as Record<string, unknown>;
}

function zoneAuditCount(): number {
  return getDatabase()
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'register_zone.toggle')))
    .all().length;
}

describe('registerZones.set', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const admin = getDatabase()
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!admin) throw new Error('Expected seeded admin user');
    tenantId = admin.tenantId;
    userId = admin.id;
  });

  beforeEach(() => {
    getDatabase()
      .update(tenants)
      .set({
        settings: sql`json_remove(json_set(COALESCE(${tenants.settings}, '{}'), '$.businessType', 'pharmacy'), '$.registerZones')`,
      })
      .where(eq(tenants.id, tenantId))
      .run();
  });

  afterAll(async () => {
    await server.close();
  });

  it('stores an override that differs from the profile and audits it', async () => {
    const caller = appRouter.createCaller(buildContext('admin'));
    const auditsBefore = zoneAuditCount();

    const result = await caller.registerZones.set({ zoneId: 'quick-keys', enabled: true });

    expect(result.overrides).toEqual({ 'quick-keys': true });
    expect(storedSettings().registerZones).toEqual({ 'quick-keys': true });
    expect(storedSettings().businessType).toBe('pharmacy');
    expect(zoneAuditCount()).toBe(auditsBefore + 1);
  });

  it('removes the override when the value matches the profile again', async () => {
    const caller = appRouter.createCaller(buildContext('admin'));
    await caller.registerZones.set({ zoneId: 'quick-keys', enabled: true });

    const result = await caller.registerZones.set({ zoneId: 'quick-keys', enabled: false });

    expect(result.overrides).toEqual({});
    expect(storedSettings().registerZones).toEqual({});
  });

  it('treats a repeated value as a no-op without a write or audit row', async () => {
    const caller = appRouter.createCaller(buildContext('admin'));
    const auditsBefore = zoneAuditCount();
    const updatedBefore = getDatabase()
      .select({ updatedAt: tenants.updatedAt })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();

    const result = await caller.registerZones.set({ zoneId: 'credit', enabled: false });

    expect(result.overrides).toEqual({});
    expect(zoneAuditCount()).toBe(auditsBefore);
    expect(
      getDatabase()
        .select({ updatedAt: tenants.updatedAt })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .get()
    ).toEqual(updatedBefore);
  });

  it('replaces a malformed override blob instead of skipping the write', async () => {
    getDatabase()
      .update(tenants)
      .set({ settings: sql`json_set(${tenants.settings}, '$.registerZones', json('[1]'))` })
      .where(eq(tenants.id, tenantId))
      .run();
    const caller = appRouter.createCaller(buildContext('admin'));

    const result = await caller.registerZones.set({ zoneId: 'credit', enabled: true });

    expect(result.overrides).toEqual({ credit: true });
    expect(storedSettings().registerZones).toEqual({ credit: true });
  });

  it('leaves another tenant untouched', async () => {
    const now = new Date().toISOString();
    const otherId = `other-${Date.now()}`;
    getDatabase()
      .insert(tenants)
      .values({
        id: otherId,
        name: 'Other',
        slug: otherId,
        settings: { businessType: 'retail', registerZones: { credit: false } },
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const caller = appRouter.createCaller(buildContext('admin'));

    await caller.registerZones.set({ zoneId: 'credit', enabled: true });

    const other = getDatabase()
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, otherId))
      .get();
    expect(other?.settings).toEqual({ businessType: 'retail', registerZones: { credit: false } });
  });

  it('rejects the selling engine', async () => {
    const caller = appRouter.createCaller(buildContext('admin'));
    await expect(
      caller.registerZones.set({ zoneId: 'checkout' as never, enabled: false })
    ).rejects.toThrow();
    await expect(
      caller.registerZones.set({ zoneId: 'command-bar' as never, enabled: false })
    ).rejects.toThrow();
  });

  it('switches the lot, unit and quotation zones', async () => {
    const caller = appRouter.createCaller(buildContext('admin'));
    await caller.registerZones.set({ zoneId: 'pharmacy-lot', enabled: false });
    await caller.registerZones.set({ zoneId: 'units-cut', enabled: true });
    const result = await caller.registerZones.set({ zoneId: 'quote-delivery', enabled: true });

    expect(result.overrides).toEqual({
      'pharmacy-lot': false,
      'units-cut': true,
      'quote-delivery': true,
    });
  });

  it('is admin-only', async () => {
    for (const role of ['manager', 'cashier'] as const) {
      const caller = appRouter.createCaller(buildContext(role));
      await expect(
        caller.registerZones.set({ zoneId: 'credit', enabled: true })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('publishes the overrides to every register through auth.me', async () => {
    const admin = appRouter.createCaller(buildContext('admin'));
    await admin.registerZones.set({ zoneId: 'credit', enabled: true });

    const me = await appRouter.createCaller(buildContext('cashier')).auth.me();

    expect(me.tenant?.settings.registerZones).toEqual({ credit: true });
  });
});
