/**
 * `surfaces.*` tRPC router integration tests.
 *
 * Drives the kernel's read procedure end-to-end against an in-memory
 * DB. Coverage:
 *
 * - `surfaces.list` returns every manifest entry with the joined
 * module-resolved `enabled` flag.
 * - POS Desktop (moduleId=null) reports enabled=true unconditionally.
 * - Surface modules default OFF → `enabled: false` on a fresh tenant.
 * - Flipping a surface's underlying module to true via
 * `tenants.settings.modules` makes the surface report enabled=true.
 * - Cross-tenant isolation: A's module flip doesn't bleed into B.
 * - Manager + admin can call; cashier + viewer FORBIDDEN.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { SURFACE_IDS } from '../services/surfaces/manifest.js';

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
  const tenantId = `surf-rtr-tenant-${suffix}`;
  const adminId = `surf-rtr-admin-${suffix}`;
  const managerId = `surf-rtr-mgr-${suffix}`;
  const cashierId = `surf-rtr-csh-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `SurfRtr Tenant ${suffix}`,
    slug: `surf-rtr-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${suffix}@surfrtr.test`,
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
      email: `mgr-${suffix}@surfrtr.test`,
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
      email: `csh-${suffix}@surfrtr.test`,
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

async function setModuleState(tenantId: string, moduleId: string, enabled: boolean): Promise<void> {
  const db = getDatabase();
  await db
    .update(tenants)
    .set({
      settings: sql`json_set(COALESCE(${tenants.settings}, '{}'), ${'$.modules.' + moduleId}, ${
        enabled ? sql`json('true')` : sql`json('false')`
      })`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tenants.id, tenantId));
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
    user: { userId, email: `${userId}@surfrtr.test`, role, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: {
      id: userId,
      email: `${userId}@surfrtr.test`,
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

describe('surfaces.list', () => {
  it('returns the full surface manifest joined with module state', async () => {
    const h = await seedHarness('list');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.surfaces.list();

    expect(result.surfaces).toHaveLength(SURFACE_IDS.length);
    const ids = result.surfaces.map(s => s.id);
    expect(ids).toEqual(['pos-desktop', 'pos-touch', 'kds', 'customer-display', 'mobile-waiter']);

    // Every entry carries the descriptor fields the renderer needs.
    for (const surface of result.surfaces) {
      expect(typeof surface.defaultRoute).toBe('string');
      expect(surface.defaultRoute.startsWith('/')).toBe(true);
      expect(typeof surface.defaultRoleSet).toBe('string');
      expect(typeof surface.i18nKey).toBe('string');
      expect(typeof surface.enabled).toBe('boolean');
    }
  });

  it('POS Desktop is always enabled (moduleId=null implicit default)', async () => {
    const h = await seedHarness('desktop-default');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.surfaces.list();
    const desktop = result.surfaces.find(s => s.id === 'pos-desktop');
    expect(desktop).toBeDefined();
    expect(desktop?.moduleId).toBeNull();
    expect(desktop?.enabled).toBe(true);
  });

  it('surface modules default OFF on a fresh tenant', async () => {
    const h = await seedHarness('fresh-off');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.surfaces.list();

    const offByDefault = result.surfaces.filter(s => s.moduleId !== null && s.enabled === false);
    expect(offByDefault.map(s => s.id)).toEqual([
      'pos-touch',
      'kds',
      'customer-display',
      'mobile-waiter',
    ]);
  });

  it('flipping the underlying module on flips the surface enabled flag', async () => {
    const h = await seedHarness('flip-on');
    await setModuleState(h.tenantId, 'kds', true);

    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.surfaces.list();
    const kds = result.surfaces.find(s => s.id === 'kds');
    expect(kds?.enabled).toBe(true);

    // Other surfaces stay default off.
    const touch = result.surfaces.find(s => s.id === 'pos-touch');
    expect(touch?.enabled).toBe(false);
  });

  it('isolates tenants — A flipping a surface does not affect B', async () => {
    const a = await seedHarness('iso-a');
    const b = await seedHarness('iso-b');
    await setModuleState(a.tenantId, 'kds', true);

    const callerA = appRouter.createCaller(buildCtx(a.tenantId, a.adminId, 'admin'));
    const callerB = appRouter.createCaller(buildCtx(b.tenantId, b.adminId, 'admin'));
    const resultA = await callerA.surfaces.list();
    const resultB = await callerB.surfaces.list();

    expect(resultA.surfaces.find(s => s.id === 'kds')?.enabled).toBe(true);
    expect(resultB.surfaces.find(s => s.id === 'kds')?.enabled).toBe(false);
  });

  it('manager can call the list (managerOrAdmin gate)', async () => {
    const h = await seedHarness('mgr');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.managerId, 'manager'));
    const result = await caller.surfaces.list();
    expect(result.surfaces).toHaveLength(SURFACE_IDS.length);
  });

  it('cashier is FORBIDDEN', async () => {
    const h = await seedHarness('cashier');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.cashierId, 'cashier'));
    await expect(caller.surfaces.list()).rejects.toThrow();
  });
});
