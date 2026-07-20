/**
 * Test fixture for procedures wrapped with
 * `criticalCommandProcedure`.
 *
 * Pre-registers a device for the active tenant + user, and returns a
 * `Context`-shaped object whose `req.headers` carry both
 * `x-device-id` and a freshly minted `x-puntovivo-envelope` JSON.
 *
 * Three call patterns:
 *
 * - `createCriticalCommandFixture(input)` — one-shot: registers a
 * device and returns a context + fresh envelope. Good for unit
 * tests that exercise a single critical procedure.
 * - `freshCriticalContext(input)` — pure builder: takes an already
 * registered `deviceId` and returns a context with a fresh
 * envelope. Used by the factory below for high-volume test files.
 * - `makeFreshContextFactory(setup)` — closure: pre-binds tenant /
 * user / device / site / role and returns a function that mints a
 * new context (with fresh envelope) per call. Pair with
 * `appRouter.createCaller(fresh())` for ergonomic replacement of
 * the legacy `createTestContext()` pattern in test files where
 * most procedures are critical (sales, cashSessions, transfers,
 * inventory, users — ).
 *
 * The helper does NOT spin up a tRPC caller — it returns the raw
 * Context so each test can decide whether to use
 * `appRouter.createCaller(ctx)` or compose with role-specific
 * fixtures.
 */

import { randomUUID } from 'node:crypto';
import type { Context } from '../../trpc/context.js';
import type { DatabaseInstance } from '../../db/index.js';
import { registerDevice as registerDeviceService } from '../../services/devices/devicesService.js';
import {
  COMMAND_ENVELOPE_HEADER,
  DEVICE_ID_HEADER,
  type CommandEnvelope,
} from '../../trpc/schemas/envelope.js';

export interface CriticalCommandFixtureInput {
  db: DatabaseInstance;
  /** Fastify server stub passed through to `req.server`. */
  serverApp: unknown;
  tenantId: string;
  userId: string;
  email: string;
  role: 'admin' | 'manager' | 'cashier' | 'viewer';
  siteId: string;
  /** Override device id for replay scenarios. */
  deviceId?: string;
  /** Override envelope to test replay or conflict scenarios. */
  envelope?: CommandEnvelope;
}

export interface CriticalCommandFixture {
  context: Context;
  deviceId: string;
  envelope: CommandEnvelope;
}

/**
 * Pre-register a device for the (tenantId, userId) and return a
 * Context shaped for tRPC critical mutations. Each call mints a fresh
 * envelope unless `input.envelope` is supplied.
 */
export async function createCriticalCommandFixture(
  input: CriticalCommandFixtureInput
): Promise<CriticalCommandFixture> {
  const deviceId =
    input.deviceId ??
    (
      await registerDeviceService(input.db, {
        tenantId: input.tenantId,
        userId: input.userId,
        kind: 'web',
        name: 'test-device',
      })
    ).deviceId;

  const envelope: CommandEnvelope = input.envelope ?? {
    operationId: randomUUID(),
    idempotencyKey: randomUUID(),
    clientCreatedAt: new Date().toISOString(),
  };

  const headers: Record<string, string> = {
    'x-site-id': input.siteId,
    [DEVICE_ID_HEADER]: deviceId,
    [COMMAND_ENVELOPE_HEADER]: JSON.stringify(envelope),
  };

  const mockReq = {
    server: input.serverApp,
    headers,
    user: {
      userId: input.userId,
      email: input.email,
      role: input.role,
      tenantId: input.tenantId,
    },
    jwtVerify: async () => {},
  } as unknown as Context['req'];

  const mockRes = {} as unknown as Context['res'];

  const context: Context = {
    req: mockReq,
    res: mockRes,
    db: input.db,
    user: {
      id: input.userId,
      email: input.email,
      role: input.role,
      tenantId: input.tenantId,
    },
    tenantId: input.tenantId,
    siteId: input.siteId,
  };

  return { context, deviceId, envelope };
}

/**
 * Build a fresh `Context` for a critical procedure given a device id
 * that was already registered (via `registerDeviceService` or
 * `createCriticalCommandFixture`). Mints a fresh envelope per call
 * unless `input.envelope` is provided (replay path).
 *
 * Pure builder — does not touch the database. Suitable for tests
 * that mint hundreds of contexts per file without paying a device
 * insert per call.
 */
export function freshCriticalContext(input: {
  db: DatabaseInstance;
  serverApp: unknown;
  tenantId: string;
  userId: string;
  email: string;
  role: 'admin' | 'manager' | 'cashier' | 'viewer';
  siteId: string;
  deviceId: string;
  // explicit `| undefined` on optional fixture override.
  envelope?: CommandEnvelope | undefined;
}): Context {
  const envelope: CommandEnvelope = input.envelope ?? {
    operationId: randomUUID(),
    idempotencyKey: randomUUID(),
    clientCreatedAt: new Date().toISOString(),
  };

  const headers: Record<string, string> = {
    'x-site-id': input.siteId,
    [DEVICE_ID_HEADER]: input.deviceId,
    [COMMAND_ENVELOPE_HEADER]: JSON.stringify(envelope),
  };

  const mockReq = {
    server: input.serverApp,
    headers,
    user: {
      userId: input.userId,
      email: input.email,
      role: input.role,
      tenantId: input.tenantId,
    },
    jwtVerify: async () => {},
  } as unknown as Context['req'];

  const mockRes = {} as unknown as Context['res'];

  return {
    req: mockReq,
    res: mockRes,
    db: input.db,
    user: {
      id: input.userId,
      email: input.email,
      role: input.role,
      tenantId: input.tenantId,
    },
    tenantId: input.tenantId,
    siteId: input.siteId,
  };
}

export interface FreshContextFactorySetup {
  db: DatabaseInstance;
  serverApp: unknown;
  tenantId: string;
  userId: string;
  email: string;
  defaultRole?: 'admin' | 'manager' | 'cashier' | 'viewer';
  siteId: string;
  deviceId: string;
}

export interface FreshContextOverrides {
  userId?: string;
  email?: string;
  role?: 'admin' | 'manager' | 'cashier' | 'viewer';
  siteId?: string;
  envelope?: CommandEnvelope;
}

/**
 * Pre-bind tenant / user / device / site / role and return a function
 * that mints a fresh `Context` per call. The returned factory is the
 * recommended replacement for the legacy `createTestContext()` helper
 * in test files where the dominant procedure surface is critical
 * ().
 *
 * Usage:
 *
 * ```ts
 * let fresh: ReturnType<typeof makeFreshContextFactory>;
 *
 * beforeAll(async () => {
 * const reg = await registerDeviceService(db, { tenantId, userId, kind: 'web', name: 'test' });
 * fresh = makeFreshContextFactory({
 * db, serverApp: server.app, tenantId, userId, email,
 * siteId, deviceId: reg.deviceId, defaultRole: 'admin',
 * });
 * });
 *
 * const caller = appRouter.createCaller(fresh());
 * await caller.sales.create({...});
 * ```
 */
export function makeFreshContextFactory(setup: FreshContextFactorySetup) {
  const defaultRole = setup.defaultRole ?? 'admin';
  return function fresh(overrides?: FreshContextOverrides): Context {
    return freshCriticalContext({
      db: setup.db,
      serverApp: setup.serverApp,
      tenantId: setup.tenantId,
      userId: overrides?.userId ?? setup.userId,
      email: overrides?.email ?? setup.email,
      role: overrides?.role ?? defaultRole,
      siteId: overrides?.siteId ?? setup.siteId,
      deviceId: setup.deviceId,
      envelope: overrides?.envelope,
    });
  };
}

// Re-export from the shared helper so tests keep their existing
// import path. Implementation lives in `lib/envelopeHeadersProxy.ts`
// because the dev seed (production-shaped code) consumes it too —
// importing a `__tests__/` artifact from `db/` would cross layers.
export {
  makeEnvelopeHeadersProxy,
  type EnvelopeHeadersProxyOptions,
} from '../../lib/envelopeHeadersProxy.js';
