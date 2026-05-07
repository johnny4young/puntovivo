/**
 * ENG-068 — `createModuleGuard` middleware regression test.
 *
 * Pins the contract every gated procedure relies on:
 *
 *   - Active module → next() runs.
 *   - Deactivated module → FORBIDDEN with `errorCode: 'MODULE_NOT_ACTIVATED'`
 *     and `details.moduleId` matching the guarded id.
 *   - Cross-tenant: tenant A's setting does NOT leak into tenant B's call.
 *   - Default fallback: a tenant with NO `settings.modules` entry resolves
 *     to the manifest default (true today for every demo module).
 *   - Fixed-point: re-toggling within a transaction fires next() vs
 *     FORBIDDEN per the latest persisted state.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants, users } from '../db/schema.js';
import { router } from '../trpc/init.js';
import {
  adminProcedureWithModule,
  isModuleActiveForTenant,
} from '../trpc/middleware/modules.js';
import type { Context } from '../trpc/context.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';

let server: PuntovivoServer;

interface GateHarness {
  tenantId: string;
  adminId: string;
  managerId: string;
}

async function seedHarness(suffix: string): Promise<GateHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `mod-gate-tenant-${suffix}`;
  const adminId = `mod-gate-admin-${suffix}`;
  const managerId = `mod-gate-mgr-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `ModGate Tenant ${suffix}`,
    slug: `mod-gate-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${suffix}@modgate.test`,
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
      email: `mgr-${suffix}@modgate.test`,
      name: `Manager ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantId, adminId, managerId };
}

async function setModuleState(
  tenantId: string,
  moduleId: string,
  enabled: boolean
): Promise<void> {
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

function buildCtx(tenantId: string, userId: string): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: { userId, email: `${userId}@modgate.test`, role: 'admin' as const, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: {
      id: userId,
      email: `${userId}@modgate.test`,
      role: 'admin',
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

// Build a tiny test router that uses the new guard around `copilot`.
const gatedRouter = router({
  // adminProcedureWithModule wraps adminProcedure with the module gate.
  protectedPing: adminProcedureWithModule('copilot')
    .input(z.object({}).optional())
    .query(() => ({ ok: true as const })),
});

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

describe('createModuleGuard (ENG-068)', () => {
  it('allows the call when the module resolves to true via default', async () => {
    const h = await seedHarness('default-on');
    // No settings.modules → defaults apply → copilot defaults to true.
    const caller = gatedRouter.createCaller(buildCtx(h.tenantId, h.adminId));
    await expect(caller.protectedPing()).resolves.toEqual({ ok: true });
  });

  it('allows the call when the module is explicitly true', async () => {
    const h = await seedHarness('explicit-on');
    await setModuleState(h.tenantId, 'copilot', true);

    const caller = gatedRouter.createCaller(buildCtx(h.tenantId, h.adminId));
    await expect(caller.protectedPing()).resolves.toEqual({ ok: true });
  });

  it('rejects with MODULE_NOT_ACTIVATED when the module is explicitly false', async () => {
    const h = await seedHarness('explicit-off');
    await setModuleState(h.tenantId, 'copilot', false);

    const caller = gatedRouter.createCaller(buildCtx(h.tenantId, h.adminId));
    await expect(caller.protectedPing()).rejects.toMatchObject({
      message: expect.stringMatching(/Module 'copilot'/i),
    });

    // The cause carries the structured error code + moduleId.
    try {
      await caller.protectedPing();
      throw new Error('expected the call to throw');
    } catch (err: unknown) {
      const cause = (err as { cause?: unknown }).cause;
      expect(cause).toBeInstanceOf(ServerErrorWithCode);
      expect((cause as ServerErrorWithCode).errorCode).toBe('MODULE_NOT_ACTIVATED');
      expect((cause as ServerErrorWithCode).details).toMatchObject({
        moduleId: 'copilot',
      });
    }
  });

  it('isolates tenants — A toggling off does not block B', async () => {
    const a = await seedHarness('iso-a');
    const b = await seedHarness('iso-b');
    await setModuleState(a.tenantId, 'copilot', false);
    // tenant B keeps its default (true).

    const callerA = gatedRouter.createCaller(buildCtx(a.tenantId, a.adminId));
    const callerB = gatedRouter.createCaller(buildCtx(b.tenantId, b.adminId));

    await expect(callerA.protectedPing()).rejects.toThrow(/Module 'copilot'/i);
    await expect(callerB.protectedPing()).resolves.toEqual({ ok: true });
  });

  it('flips behavior live when a tenant toggles the module', async () => {
    const h = await seedHarness('flip-flop');
    const caller = gatedRouter.createCaller(buildCtx(h.tenantId, h.adminId));

    // Default → allowed.
    await expect(caller.protectedPing()).resolves.toEqual({ ok: true });

    // Off → forbidden.
    await setModuleState(h.tenantId, 'copilot', false);
    await expect(caller.protectedPing()).rejects.toThrow(/Module 'copilot'/i);

    // Back on → allowed.
    await setModuleState(h.tenantId, 'copilot', true);
    await expect(caller.protectedPing()).resolves.toEqual({ ok: true });
  });
});

describe('isModuleActiveForTenant (ENG-068)', () => {
  it('returns true for an unknown tenant (no row matched) — defensive fallback', async () => {
    const db = getDatabase();
    // No row matches → resolveModulesState gets undefined → defaults
    // resolved → copilot defaults to true. Documented as defensive
    // fallback so an upstream session-context bug doesn't accidentally
    // block legit traffic.
    const active = await isModuleActiveForTenant(db, 'no-such-tenant', 'copilot');
    expect(active).toBe(true);
  });

  it('returns the explicit boolean when set', async () => {
    const h = await seedHarness('explicit-check');
    const db = getDatabase();
    await setModuleState(h.tenantId, 'quotations', false);
    expect(await isModuleActiveForTenant(db, h.tenantId, 'quotations')).toBe(false);
    expect(await isModuleActiveForTenant(db, h.tenantId, 'copilot')).toBe(true);
  });
});
