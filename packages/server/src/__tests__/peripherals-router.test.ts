/**
 * Integration tests for the `peripherals.*` admin router.
 *
 * Boots a real Fastify server + tRPC caller. Asserts write gating,
 * CRUD round-trip, partial-unique enforcement, and the test action's
 * stamping of `last_tested_at` + `last_test_result`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { sites, sitePeripherals, users } from '../db/schema.js';
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
      user: {
        userId,
        email: 'admin@localhost',
        role,
        tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: 'admin@localhost',
      role,
      tenantId,
    },
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
});

afterAll(async () => {
  await server.close();
});

afterEach(async () => {
  await getDatabase().delete(sitePeripherals).where(eq(sitePeripherals.tenantId, tenantId));
});

describe('peripherals.* — admin gate', () => {
  it('rejects cashier on list', async () => {
    const caller = appRouter.createCaller(buildContext('cashier'));
    await expect(caller.peripherals.list({ siteId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects cashier on register', async () => {
    const caller = appRouter.createCaller(buildContext('cashier'));
    await expect(
      caller.peripherals.register({
        siteId,
        kind: 'printer',
        driver: 'system',
        config: {},
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('peripherals.list', () => {
  it('returns empty array when no peripherals registered', async () => {
    const caller = appRouter.createCaller(buildContext());
    const rows = await caller.peripherals.list({ siteId });
    expect(rows).toEqual([]);
  });

  it('allows manager callers for Operations Center read access', async () => {
    const caller = appRouter.createCaller(buildContext('manager'));
    const rows = await caller.peripherals.list({ siteId });
    expect(rows).toEqual([]);
  });

  it('returns NOT_FOUND when siteId is foreign', async () => {
    const caller = appRouter.createCaller(buildContext());
    await expect(caller.peripherals.list({ siteId: 'unknown-site' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('peripherals.register', () => {
  it('persists a system printer with empty config', async () => {
    const caller = appRouter.createCaller(buildContext());
    const row = await caller.peripherals.register({
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
      displayName: 'Caja principal',
    });
    expect(row.kind).toBe('printer');
    expect(row.driver).toBe('system');
    expect(row.displayName).toBe('Caja principal');
    expect(row.isActive).toBe(true);
    expect(row.lastTestedAt).toBeNull();
  });

  it('persists a manual payment terminal with prompt config', async () => {
    const caller = appRouter.createCaller(buildContext());
    const row = await caller.peripherals.register({
      siteId,
      kind: 'payment_terminal',
      driver: 'manual',
      config: { prompt: 'Insert card and follow terminal prompts' },
    });
    expect(row.kind).toBe('payment_terminal');
    expect(row.driver).toBe('manual');
    expect((row.config as Record<string, unknown>).prompt).toBe(
      'Insert card and follow terminal prompts'
    );
  });

  it('rejects an unknown driver with PERIPHERAL_DRIVER_INVALID', async () => {
    const caller = appRouter.createCaller(buildContext());
    try {
      await caller.peripherals.register({
        siteId,
        kind: 'printer',
        // No printer driver named "starprnt" exists today; this one
        // is a placeholder for a future Star TSP100 implementation.
        driver: 'starprnt',
        config: {},
      });
      throw new Error('should have thrown');
    } catch (err) {
      expectErrorCode(err, 'PERIPHERAL_DRIVER_INVALID');
    }
  });

  it('rejects malformed config with PERIPHERAL_CONFIG_INVALID', async () => {
    const caller = appRouter.createCaller(buildContext());
    try {
      await caller.peripherals.register({
        siteId,
        kind: 'payment_terminal',
        driver: 'manual',
        config: { prompt: 12345 } as unknown as Record<string, unknown>,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expectErrorCode(err, 'PERIPHERAL_CONFIG_INVALID');
    }
  });

  it('blocks a second active peripheral of the same kind with PERIPHERAL_ACTIVE_DUPLICATE', async () => {
    const caller = appRouter.createCaller(buildContext());
    await caller.peripherals.register({
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
    });
    try {
      await caller.peripherals.register({
        siteId,
        kind: 'printer',
        driver: 'system',
        config: {},
      });
      throw new Error('should have thrown');
    } catch (err) {
      expectErrorCode(err, 'PERIPHERAL_ACTIVE_DUPLICATE');
    }
  });

  // `autoPrintOnComplete` is opt-in per site; the printer
  // driver schema must accept + round-trip the boolean so the
  // SalesPage hook can read it back via `activeForSite`.
  it('round-trips the  autoPrintOnComplete printer config flag', async () => {
    const caller = appRouter.createCaller(buildContext());
    const row = await caller.peripherals.register({
      siteId,
      kind: 'printer',
      driver: 'escpos',
      config: {
        channel: 'mock',
        autoPrintOnComplete: true,
      },
      displayName: 'Auto-print printer',
    });
    expect(row.kind).toBe('printer');
    expect(row.driver).toBe('escpos');
    const config = row.config as Record<string, unknown>;
    expect(config.autoPrintOnComplete).toBe(true);

    // activeForSite is the surface SalesPage reads; the flag must
    // survive the projection that drops persistence-only columns.
    const active = await caller.peripherals.activeForSite({ siteId });
    const printer = active.find(p => p.kind === 'printer');
    expect(printer).toBeDefined();
    expect((printer!.config as Record<string, unknown>).autoPrintOnComplete).toBe(true);
  });

  it('rejects a non-boolean autoPrintOnComplete with PERIPHERAL_CONFIG_INVALID', async () => {
    const caller = appRouter.createCaller(buildContext());
    try {
      await caller.peripherals.register({
        siteId,
        kind: 'printer',
        driver: 'escpos',
        config: {
          channel: 'mock',
          autoPrintOnComplete: 'yes' as unknown as boolean,
        },
      });
      throw new Error('should have thrown');
    } catch (err) {
      expectErrorCode(err, 'PERIPHERAL_CONFIG_INVALID');
    }
  });
});

describe('peripherals.setActive', () => {
  it('toggles a row off and lets a new one register', async () => {
    const caller = appRouter.createCaller(buildContext());
    const first = await caller.peripherals.register({
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
    });
    await caller.peripherals.setActive({ id: first.id, isActive: false });
    const second = await caller.peripherals.register({
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
    });
    expect(second.id).not.toBe(first.id);
    expect(second.isActive).toBe(true);
  });

  it('rejects re-activating when another active row of the same kind exists', async () => {
    const caller = appRouter.createCaller(buildContext());
    const first = await caller.peripherals.register({
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
    });
    await caller.peripherals.setActive({ id: first.id, isActive: false });
    const second = await caller.peripherals.register({
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
    });
    void second;
    try {
      await caller.peripherals.setActive({ id: first.id, isActive: true });
      throw new Error('should have thrown');
    } catch (err) {
      expectErrorCode(err, 'PERIPHERAL_ACTIVE_DUPLICATE');
    }
  });
});

describe('peripherals.test', () => {
  it('stamps last_tested_at and last_test_result=ok for the system printer', async () => {
    const caller = appRouter.createCaller(buildContext());
    const row = await caller.peripherals.register({
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
    });
    const result = await caller.peripherals.test({ id: row.id });
    expect(result.status).toBe('ok');
    expect(result.peripheral.lastTestResult).toBe('ok');
    expect(result.peripheral.lastTestedAt).not.toBeNull();
  });

  it('stamps last_test_result=ok for the manual payment terminal', async () => {
    const caller = appRouter.createCaller(buildContext());
    const row = await caller.peripherals.register({
      siteId,
      kind: 'payment_terminal',
      driver: 'manual',
      config: {},
    });
    const result = await caller.peripherals.test({ id: row.id });
    expect(result.status).toBe('ok');
    expect(result.peripheral.lastTestResult).toBe('ok');
  });
});

describe('peripherals.remove', () => {
  it('deletes the row', async () => {
    const caller = appRouter.createCaller(buildContext());
    const row = await caller.peripherals.register({
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
    });
    await caller.peripherals.remove({ id: row.id });
    const reloaded = await getDatabase()
      .select()
      .from(sitePeripherals)
      .where(eq(sitePeripherals.id, row.id))
      .get();
    expect(reloaded).toBeUndefined();
  });

  it('throws PERIPHERAL_NOT_FOUND on a foreign id', async () => {
    const caller = appRouter.createCaller(buildContext());
    try {
      await caller.peripherals.remove({ id: 'unknown-id' });
      throw new Error('should have thrown');
    } catch (err) {
      expectErrorCode(err, 'PERIPHERAL_NOT_FOUND');
    }
  });
});

describe('peripherals.update', () => {
  it('updates displayName and config', async () => {
    const caller = appRouter.createCaller(buildContext());
    const row = await caller.peripherals.register({
      siteId,
      kind: 'payment_terminal',
      driver: 'manual',
      config: { prompt: 'Original prompt' },
    });
    const updated = await caller.peripherals.update({
      id: row.id,
      config: { prompt: 'Updated prompt' },
      displayName: 'Datáfono frente',
    });
    expect((updated.config as Record<string, unknown>).prompt).toBe('Updated prompt');
    expect(updated.displayName).toBe('Datáfono frente');
  });

  it('rejects swapping to an unknown driver mid-update', async () => {
    const caller = appRouter.createCaller(buildContext());
    const row = await caller.peripherals.register({
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
    });
    try {
      await caller.peripherals.update({
        id: row.id,
        // No driver named "starprnt" is registered for printer kind.
        driver: 'starprnt',
        config: {},
      });
      throw new Error('should have thrown');
    } catch (err) {
      // The static dispatch table has no entry for this driver, so we
      // surface PERIPHERAL_DRIVER_INVALID rather than letting an
      // unimplemented driver write to the row.
      expectErrorCode(err, 'PERIPHERAL_DRIVER_INVALID');
    }
  });
});

describe('peripherals.activeForSite', () => {
  it('returns an empty array when no peripherals are registered', async () => {
    const caller = appRouter.createCaller(buildContext('cashier'));
    const result = await caller.peripherals.activeForSite({ siteId });
    expect(result).toEqual([]);
  });

  it('returns a minimal projection (kind + driver + config only) for cashier role', async () => {
    const adminCaller = appRouter.createCaller(buildContext('admin'));
    await adminCaller.peripherals.register({
      siteId,
      kind: 'scanner',
      driver: 'wedge',
      config: { interCharGapMs: 50 },
      displayName: 'Caja principal',
    });
    const cashierCaller = appRouter.createCaller(buildContext('cashier'));
    const result = await cashierCaller.peripherals.activeForSite({ siteId });
    expect(result).toHaveLength(1);
    const row = result[0]!;
    expect(row.kind).toBe('scanner');
    expect(row.driver).toBe('wedge');
    expect((row.config as Record<string, unknown>).interCharGapMs).toBe(50);
    // The minimal projection MUST NOT leak admin-only fields.
    expect(row).not.toHaveProperty('displayName');
    expect(row).not.toHaveProperty('lastTestedAt');
    expect(row).not.toHaveProperty('lastTestDetails');
    expect(row).not.toHaveProperty('createdAt');
  });

  it('excludes inactive rows', async () => {
    const adminCaller = appRouter.createCaller(buildContext('admin'));
    const registered = await adminCaller.peripherals.register({
      siteId,
      kind: 'scanner',
      driver: 'wedge',
      config: {},
    });
    await adminCaller.peripherals.setActive({ id: registered.id, isActive: false });
    const cashierCaller = appRouter.createCaller(buildContext('cashier'));
    const result = await cashierCaller.peripherals.activeForSite({ siteId });
    expect(result).toEqual([]);
  });

  it('throws NOT_FOUND when the siteId belongs to another tenant', async () => {
    const cashierCaller = appRouter.createCaller(buildContext('cashier'));
    try {
      await cashierCaller.peripherals.activeForSite({ siteId: 'unknown-site' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('NOT_FOUND');
    }
  });
});
