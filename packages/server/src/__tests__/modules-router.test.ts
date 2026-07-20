/**
 * `modules.*` tRPC router integration tests.
 *
 * Drives the kernel's three procedures end-to-end against an
 * in-memory DB. Coverage:
 *
 * - `modules.list` returns every manifest entry joined with the
 * tenant's effective state + the explicit-vs-default flag.
 * - `modules.getEffective` returns a complete `Record<ModuleId, boolean>`.
 * - `modules.setActive` flips `tenants.settings.modules[id]` AND
 * writes an audit log row with before/after snapshot.
 * - `modules.setActive` is a no-op when state already matches
 * (idempotent path returns `changed: false`).
 * - `modules.setActive` admin-only — manager + cashier FORBIDDEN.
 * - Cross-tenant isolation: A's setActive doesn't affect B.
 * - Unknown module id → BAD_REQUEST via Zod refine.
 * - JSON merge preserves sibling settings (fiscal, ai, locale).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, sites, companies, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { MODULE_IDS, MODULES_MANIFEST } from '../services/modules/manifest.js';
import {
  createCriticalCommandFixture,
  type CriticalCommandFixture,
} from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;

interface RouterHarness {
  tenantId: string;
  siteId: string;
  adminId: string;
  managerId: string;
  cashierId: string;
}

async function seedHarness(suffix: string): Promise<RouterHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `mod-rtr-tenant-${suffix}`;
  const companyId = `mod-rtr-co-${suffix}`;
  const siteId = `mod-rtr-site-${suffix}`;
  const adminId = `mod-rtr-admin-${suffix}`;
  const managerId = `mod-rtr-mgr-${suffix}`;
  const cashierId = `mod-rtr-csh-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `ModRtr Tenant ${suffix}`,
    slug: `mod-rtr-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `Co ${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: `Sede ${suffix}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${suffix}@modrtr.test`,
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
      email: `mgr-${suffix}@modrtr.test`,
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
      email: `csh-${suffix}@modrtr.test`,
      name: `Cashier ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantId, siteId, adminId, managerId, cashierId };
}

/**
 * Plain context for non-critical reads (`modules.list`,
 * `modules.getEffective`). No envelope / device id required.
 */
function buildCtx(
  tenantId: string,
  userId: string,
  role: 'admin' | 'manager' | 'cashier' | 'viewer'
): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: { userId, email: `${userId}@modrtr.test`, role, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: {
      id: userId,
      email: `${userId}@modrtr.test`,
      role,
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

/**
 * Critical-command context for `modules.setActive`. Uses the shared
 * fixture that pre-registers a device and mints a fresh envelope.
 */
async function freshAdmin(h: RouterHarness): Promise<CriticalCommandFixture> {
  return createCriticalCommandFixture({
    db: getDatabase(),
    serverApp: server.app,
    tenantId: h.tenantId,
    userId: h.adminId,
    email: `admin@modrtr.test`,
    role: 'admin',
    siteId: h.siteId,
  });
}

async function freshFor(
  h: RouterHarness,
  role: 'admin' | 'manager' | 'cashier'
): Promise<CriticalCommandFixture> {
  const userId = role === 'admin' ? h.adminId : role === 'manager' ? h.managerId : h.cashierId;
  return createCriticalCommandFixture({
    db: getDatabase(),
    serverApp: server.app,
    tenantId: h.tenantId,
    userId,
    email: `${role}@modrtr.test`,
    role,
    siteId: h.siteId,
  });
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

describe('modules.list', () => {
  it('returns every manifest entry with the effective state for a fresh tenant (defaults)', async () => {
    const h = await seedHarness('list-fresh');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.modules.list();

    expect(result.modules.map(m => m.id)).toEqual([...MODULE_IDS]);
    for (const row of result.modules) {
      expect(row.enabled).toBe(MODULES_MANIFEST[row.id].defaultEnabled);
      expect(row.isExplicit).toBe(false);
      expect(row.defaultEnabled).toBe(MODULES_MANIFEST[row.id].defaultEnabled);
    }
  });

  it('marks isExplicit=true for modules that have been toggled', async () => {
    const h = await seedHarness('list-explicit');
    const adminFix = await freshAdmin(h);
    const adminCaller = appRouter.createCaller(adminFix.context);

    await adminCaller.modules.setActive({ moduleId: 'copilot', enabled: false });

    const readCaller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const list = await readCaller.modules.list();
    const copilot = list.modules.find(m => m.id === 'copilot');
    expect(copilot?.enabled).toBe(false);
    expect(copilot?.isExplicit).toBe(true);

    const quotations = list.modules.find(m => m.id === 'quotations');
    // Untouched module stays at default + explicit=false.
    expect(quotations?.enabled).toBe(true);
    expect(quotations?.isExplicit).toBe(false);
  });

  it('cashier FORBIDDEN; manager allowed; admin allowed', async () => {
    const h = await seedHarness('list-roles');
    const cashierCaller = appRouter.createCaller(buildCtx(h.tenantId, h.cashierId, 'cashier'));
    await expect(cashierCaller.modules.list()).rejects.toThrow(/administrators|managers/i);

    const managerCaller = appRouter.createCaller(buildCtx(h.tenantId, h.managerId, 'manager'));
    const managerResult = await managerCaller.modules.list();
    // Every demo module is admin-visible today. Manager may call the
    // read endpoint, but role visibility still filters the catalog.
    expect(managerResult.modules).toEqual([]);

    const adminCaller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    await expect(adminCaller.modules.list()).resolves.toBeDefined();
  });
});

describe('modules.getEffective', () => {
  it('returns a complete map keyed on every known module', async () => {
    const h = await seedHarness('eff-fresh');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId, 'admin'));
    const result = await caller.modules.getEffective();

    expect(Object.keys(result.modules).sort()).toEqual([...MODULE_IDS].sort());
    for (const id of MODULE_IDS) {
      expect(result.modules[id]).toBe(MODULES_MANIFEST[id].defaultEnabled);
    }
  });

  it('cashier allowed (tenantProcedure — any logged-in user)', async () => {
    const h = await seedHarness('eff-cashier');
    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.cashierId, 'cashier'));
    await expect(caller.modules.getEffective()).resolves.toBeDefined();
  });
});

describe('modules.setActive', () => {
  it('flips the persisted state + writes an audit log row', async () => {
    const h = await seedHarness('set-flip');
    const db = getDatabase();
    const fix = await freshAdmin(h);
    const caller = appRouter.createCaller(fix.context);

    const result = await caller.modules.setActive({ moduleId: 'copilot', enabled: false });
    expect(result.changed).toBe(true);
    expect(result.enabled).toBe(false);

    // Persistence: the JSON blob has copilot=false now.
    const row = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, h.tenantId))
      .get();
    const settings = row?.settings as Record<string, unknown>;
    const modules = settings?.modules as Record<string, unknown>;
    expect(modules?.copilot).toBe(false);

    // Audit row.
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.tenantId, h.tenantId)).all();
    const moduleRows = audit.filter(r => r.action === 'module.toggle');
    expect(moduleRows).toHaveLength(1);
    expect(moduleRows[0]?.resourceType).toBe('tenant_module');
    expect(moduleRows[0]?.resourceId).toBe('copilot');
    expect(moduleRows[0]?.before).toEqual({ enabled: true });
    expect(moduleRows[0]?.after).toEqual({ enabled: false });
    expect(moduleRows[0]?.metadata).toMatchObject({
      moduleId: 'copilot',
      defaultEnabled: true,
    });
  });

  it('returns changed:false when the new state matches the current state (no audit row)', async () => {
    const h = await seedHarness('set-noop');
    const fix = await freshAdmin(h);
    const caller = appRouter.createCaller(fix.context);

    // Default for copilot is true; setting to true is a no-op.
    const result = await caller.modules.setActive({ moduleId: 'copilot', enabled: true });
    expect(result.changed).toBe(false);

    const db = getDatabase();
    const moduleRows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, h.tenantId))
      .all();
    expect(moduleRows.filter(r => r.action === 'module.toggle')).toHaveLength(0);
  });

  it('manager + cashier FORBIDDEN', async () => {
    const h = await seedHarness('set-roles');

    const mgrFix = await freshFor(h, 'manager');
    const managerCaller = appRouter.createCaller(mgrFix.context);
    await expect(
      managerCaller.modules.setActive({ moduleId: 'copilot', enabled: false })
    ).rejects.toThrow(/administrators/i);

    const cshFix = await freshFor(h, 'cashier');
    const cashierCaller = appRouter.createCaller(cshFix.context);
    await expect(
      cashierCaller.modules.setActive({ moduleId: 'copilot', enabled: false })
    ).rejects.toThrow(/administrators/i);
  });

  it('rejects unknown module ids at Zod refine', async () => {
    const h = await seedHarness('set-bad-id');
    const fix = await freshAdmin(h);
    const caller = appRouter.createCaller(fix.context);
    await expect(
      // @ts-expect-error — intentionally bogus id to trigger Zod refine
      caller.modules.setActive({ moduleId: 'not-a-module', enabled: false })
    ).rejects.toThrow(/moduleId must be one of/i);
  });

  it('isolates tenants — A toggling does not affect B', async () => {
    const a = await seedHarness('iso-a');
    const b = await seedHarness('iso-b');

    const fixA = await freshAdmin(a);
    const callerA = appRouter.createCaller(fixA.context);
    const callerB = appRouter.createCaller(buildCtx(b.tenantId, b.adminId, 'admin'));

    await callerA.modules.setActive({ moduleId: 'copilot', enabled: false });

    const aEffective = await callerA.modules.getEffective();
    const bEffective = await callerB.modules.getEffective();

    expect(aEffective.modules.copilot).toBe(false);
    expect(bEffective.modules.copilot).toBe(true);
  });

  it('preserves sibling settings (fiscal, ai, locale) when merging the modules key', async () => {
    const h = await seedHarness('set-merge');
    const db = getDatabase();
    // Pre-populate sibling settings on the tenant.
    await db
      .update(tenants)
      .set({
        settings: {
          fiscal_dian_enabled: true,
          ai: { enabled: true, monthlyBudgetUsd: 50 },
          someOtherKey: 'preserve-me',
        },
      })
      .where(eq(tenants.id, h.tenantId));

    const fix = await freshAdmin(h);
    const caller = appRouter.createCaller(fix.context);
    await caller.modules.setActive({ moduleId: 'quotations', enabled: false });

    const row = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, h.tenantId))
      .get();
    const settings = row?.settings as Record<string, unknown>;

    // The new module key landed.
    expect((settings.modules as Record<string, unknown>)?.quotations).toBe(false);
    // Siblings stayed intact.
    expect(settings.fiscal_dian_enabled).toBe(true);
    expect((settings.ai as Record<string, unknown>)?.enabled).toBe(true);
    expect(settings.someOtherKey).toBe('preserve-me');
  });
});
