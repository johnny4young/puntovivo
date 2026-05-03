/**
 * ENG-052 — Test fixture for procedures wrapped with
 * `criticalCommandProcedure`.
 *
 * Pre-registers a device for the active tenant + user, and returns a
 * `Context`-shaped object whose `req.headers` carry both
 * `x-device-id` and a freshly minted `x-puntovivo-envelope` JSON.
 *
 * Two call patterns:
 *
 * - `freshContext({...})` — generates a new envelope (UUID v4 +
 *   UUID v4 + ISO date) per call. Use for normal end-to-end tests.
 * - `replayContext(context)` — clones a context and reuses its
 *   envelope so the replay path through `idempotency_keys` is
 *   exercised.
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
    (await registerDeviceService(input.db, {
      tenantId: input.tenantId,
      userId: input.userId,
      kind: 'web',
      name: 'test-device',
    })).deviceId;

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
