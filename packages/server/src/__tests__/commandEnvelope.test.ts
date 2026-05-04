/**
 * ENG-052 — End-to-end tests for the `commandEnvelope` middleware,
 * exercising the full chain via `auth.changePassword` (the proof
 * procedure for ENG-052a).
 *
 * Coverage:
 * - Missing x-device-id → DEVICE_NOT_REGISTERED.
 * - Missing envelope header → MISSING_COMMAND_ENVELOPE.
 * - Invalid envelope JSON → MISSING_COMMAND_ENVELOPE.
 * - Cross-tenant deviceId → DEVICE_NOT_REGISTERED.
 * - Replay with same canonical input hash → cached result returned,
 *   procedure NOT re-invoked (verified by checking sessionVersion is
 *   only bumped once).
 * - Replay with mismatched hash → IDEMPOTENCY_KEY_CONFLICT.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  idempotencyKeys,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import {
  COMMAND_ENVELOPE_HEADER,
  DEVICE_ID_HEADER,
} from '../trpc/schemas/envelope.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { reserveKey } from '../services/idempotency/idempotencyService.js';
import { hashCanonicalInput } from '../services/idempotency/keyHasher.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { randomUUID } from 'node:crypto';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let deviceId: string;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  tenantId = nanoid();
  userId = nanoid();
  await db.insert(tenants).values({
    id: tenantId,
    name: 'Envelope Test',
    slug: `env-${tenantId.slice(0, 6)}`,
    settings: {},
    isActive: true,
  });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `env-${userId.slice(0, 6)}@test.local`,
    passwordHash: await hash('TestPassword123!'),
    name: 'Envelope Tester',
    role: 'admin',
    isActive: true,
  });
  const reg = await registerDevice(db, {
    tenantId,
    userId,
    kind: 'web',
    name: 'envelope-test',
  });
  deviceId = reg.deviceId;
});

afterAll(async () => {
  await getDatabase().delete(idempotencyKeys);
});

interface CallerOptions {
  envelope?: Record<string, string>;
  deviceIdHeader?: string;
  rawEnvelopeOverride?: string;
}

function makeCaller(opts: CallerOptions = {}): ReturnType<typeof appRouter.createCaller> {
  const headers: Record<string, string> = {};
  if (opts.deviceIdHeader !== '__skip__') {
    headers[DEVICE_ID_HEADER] = opts.deviceIdHeader ?? deviceId;
  }
  if (opts.rawEnvelopeOverride !== undefined) {
    if (opts.rawEnvelopeOverride !== '__skip__') {
      headers[COMMAND_ENVELOPE_HEADER] = opts.rawEnvelopeOverride;
    }
  } else {
    const env =
      opts.envelope ??
      {
        operationId: randomUUID(),
        idempotencyKey: randomUUID(),
        clientCreatedAt: new Date().toISOString(),
      };
    headers[COMMAND_ENVELOPE_HEADER] = JSON.stringify(env);
  }
  const ctx: Context = {
    req: {
      server: server.app,
      headers,
      user: { userId, email: 'envelope', role: 'admin', tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as unknown as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: 'envelope', role: 'admin', tenantId },
    tenantId,
    siteId: null,
  };
  return appRouter.createCaller(ctx);
}

async function resetPassword(): Promise<void> {
  const db = getDatabase();
  await db
    .update(users)
    .set({
      passwordHash: await hash('TestPassword123!'),
      sessionVersion: 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, userId));
}

beforeEach(async () => {
  await resetPassword();
  await getDatabase().delete(idempotencyKeys);
});

describe('commandEnvelope middleware: device id (ENG-052)', () => {
  it('rejects missing x-device-id header with DEVICE_NOT_REGISTERED', async () => {
    const caller = makeCaller({ deviceIdHeader: '__skip__' });
    let caught: unknown;
    try {
      await caller.auth.changePassword({
        currentPassword: 'TestPassword123!',
        newPassword: 'NewPassword456!',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause as ServerErrorWithCode | undefined;
    expect(cause?.errorCode).toBe('DEVICE_NOT_REGISTERED');
  });

  it('rejects unknown device id with DEVICE_NOT_REGISTERED', async () => {
    const caller = makeCaller({ deviceIdHeader: 'never-registered-device' });
    let caught: unknown;
    try {
      await caller.auth.changePassword({
        currentPassword: 'TestPassword123!',
        newPassword: 'NewPassword456!',
      });
    } catch (err) {
      caught = err;
    }
    const cause = (caught as TRPCError).cause as ServerErrorWithCode | undefined;
    expect(cause?.errorCode).toBe('DEVICE_NOT_REGISTERED');
  });

  it('rejects cross-tenant device id with DEVICE_NOT_REGISTERED', async () => {
    // Register a device on a DIFFERENT tenant; supplying its id should fail.
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
      passwordHash: await hash('TestPassword123!'),
      name: 'Other',
      role: 'admin',
      isActive: true,
    });
    const otherDevice = await registerDevice(getDatabase(), {
      tenantId: otherTenantId,
      userId: otherUserId,
      kind: 'web',
      name: 'other',
    });

    const caller = makeCaller({ deviceIdHeader: otherDevice.deviceId });
    let caught: unknown;
    try {
      await caller.auth.changePassword({
        currentPassword: 'TestPassword123!',
        newPassword: 'NewPassword456!',
      });
    } catch (err) {
      caught = err;
    }
    const cause = (caught as TRPCError).cause as ServerErrorWithCode | undefined;
    expect(cause?.errorCode).toBe('DEVICE_NOT_REGISTERED');
  });
});

describe('commandEnvelope middleware: envelope header (ENG-052)', () => {
  it('rejects missing x-puntovivo-envelope with MISSING_COMMAND_ENVELOPE', async () => {
    const caller = makeCaller({ rawEnvelopeOverride: '__skip__' });
    let caught: unknown;
    try {
      await caller.auth.changePassword({
        currentPassword: 'TestPassword123!',
        newPassword: 'NewPassword456!',
      });
    } catch (err) {
      caught = err;
    }
    const cause = (caught as TRPCError).cause as ServerErrorWithCode | undefined;
    expect(cause?.errorCode).toBe('MISSING_COMMAND_ENVELOPE');
  });

  it('rejects malformed envelope JSON with MISSING_COMMAND_ENVELOPE', async () => {
    const caller = makeCaller({ rawEnvelopeOverride: 'not-json' });
    let caught: unknown;
    try {
      await caller.auth.changePassword({
        currentPassword: 'TestPassword123!',
        newPassword: 'NewPassword456!',
      });
    } catch (err) {
      caught = err;
    }
    const cause = (caught as TRPCError).cause as ServerErrorWithCode | undefined;
    expect(cause?.errorCode).toBe('MISSING_COMMAND_ENVELOPE');
  });

  it('rejects envelope missing required fields with MISSING_COMMAND_ENVELOPE', async () => {
    const caller = makeCaller({
      rawEnvelopeOverride: JSON.stringify({ operationId: 'not-a-uuid' }),
    });
    let caught: unknown;
    try {
      await caller.auth.changePassword({
        currentPassword: 'TestPassword123!',
        newPassword: 'NewPassword456!',
      });
    } catch (err) {
      caught = err;
    }
    const cause = (caught as TRPCError).cause as ServerErrorWithCode | undefined;
    expect(cause?.errorCode).toBe('MISSING_COMMAND_ENVELOPE');
  });
});

describe('commandEnvelope middleware: idempotency replay (ENG-052)', () => {
  it('replay with same envelope + same input returns cached result, procedure NOT re-invoked', async () => {
    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };

    const caller1 = makeCaller({ envelope });
    const result1 = await caller1.auth.changePassword({
      currentPassword: 'TestPassword123!',
      newPassword: 'CachedTest123!',
    });
    expect(result1.success).toBe(true);

    // The first call bumped sessionVersion to 2 and changed the
    // password. The second call replays the SAME envelope; the
    // middleware MUST short-circuit and return the cached result
    // without re-running the procedure body. Verify by checking
    // sessionVersion is unchanged after the second call.
    const sessionBefore = await getDatabase()
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    const caller2 = makeCaller({ envelope });
    const result2 = await caller2.auth.changePassword({
      currentPassword: 'TestPassword123!',
      newPassword: 'CachedTest123!',
    });
    expect(result2).toMatchObject(result1);

    const sessionAfter = await getDatabase()
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    expect(sessionAfter?.sessionVersion).toBe(sessionBefore?.sessionVersion);
  });

  it('replay with same idempotencyKey but different input → IDEMPOTENCY_KEY_CONFLICT', async () => {
    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };

    // First call: legitimate change.
    await makeCaller({ envelope }).auth.changePassword({
      currentPassword: 'TestPassword123!',
      newPassword: 'FirstChange123!',
    });

    // Second call: same idempotencyKey, different password.
    let caught: unknown;
    try {
      await makeCaller({ envelope }).auth.changePassword({
        currentPassword: 'FirstChange123!',
        newPassword: 'DifferentChange456!',
      });
    } catch (err) {
      caught = err;
    }
    const cause = (caught as TRPCError).cause as ServerErrorWithCode | undefined;
    expect(cause?.errorCode).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('replay while original command is processing → COMMAND_IN_PROGRESS', async () => {
    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const payload = {
      currentPassword: 'TestPassword123!',
      newPassword: 'StillRunning123!',
    };
    const reservation = await reserveKey(getDatabase(), {
      tenantId,
      deviceId,
      idempotencyKey: envelope.idempotencyKey,
      operationKind: 'auth.changePassword',
      requestHash: hashCanonicalInput(payload),
    });
    expect(reservation.state).toBe('reserved');

    let caught: unknown;
    try {
      await makeCaller({ envelope }).auth.changePassword(payload);
    } catch (err) {
      caught = err;
    }
    const cause = (caught as TRPCError).cause as ServerErrorWithCode | undefined;
    expect(cause?.errorCode).toBe('COMMAND_IN_PROGRESS');

    const session = await getDatabase()
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    expect(session?.sessionVersion).toBe(1);
  });
});

describe('commandEnvelope middleware: device telemetry (ENG-052)', () => {
  it('successful call updates devices.last_seen_at', async () => {
    const caller = makeCaller();
    await caller.auth.changePassword({
      currentPassword: 'TestPassword123!',
      newPassword: 'TouchSeen123!',
    });
    // Allow the best-effort markSeen() to flush.
    await new Promise(resolve => setTimeout(resolve, 50));
    const row = await getDatabase()
      .select({ lastSeenAt: (await import('../db/schema.js')).devices.lastSeenAt })
      .from((await import('../db/schema.js')).devices)
      .where(eq((await import('../db/schema.js')).devices.id, deviceId))
      .get();
    expect(row?.lastSeenAt).toBeTruthy();
  });
});

describe('commandEnvelope middleware: operation journal (ENG-053)', () => {
  beforeEach(async () => {
    await resetPassword();
  });

  it('a successful critical mutation writes one operation_events row with status=succeeded', async () => {
    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const caller = makeCaller({ envelope });
    await caller.auth.changePassword({
      currentPassword: 'TestPassword123!',
      newPassword: 'JournalSucceed123!',
    });
    const { operationEvents } = await import('../db/schema.js');
    const event = await getDatabase()
      .select()
      .from(operationEvents)
      .where(eq(operationEvents.operationId, envelope.operationId))
      .get();
    expect(event).toBeTruthy();
    expect(event?.status).toBe('succeeded');
    expect(event?.operationKind).toBe('auth.changePassword');
    expect(event?.deviceId).toBe(deviceId);
    expect(event?.completedAt).toBeTruthy();
  });

  it('a failed critical mutation writes operation_events status=failed plus an operation_errors row', async () => {
    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const caller = makeCaller({ envelope });
    let caught: unknown = null;
    try {
      await caller.auth.changePassword({
        currentPassword: 'definitely-not-the-current-password',
        newPassword: 'JournalFail123!',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    const { operationEvents, operationErrors } = await import('../db/schema.js');
    const event = await getDatabase()
      .select()
      .from(operationEvents)
      .where(eq(operationEvents.operationId, envelope.operationId))
      .get();
    expect(event?.status).toBe('failed');
    expect(event?.completedAt).toBeTruthy();
    const errors = await getDatabase()
      .select()
      .from(operationErrors)
      .where(eq(operationErrors.operationEventId, event!.id))
      .all();
    expect(errors.length).toBe(1);
    // The proof procedure rejects bad passwords with a typed
    // ServerErrorWithCode (INVALID_CREDENTIALS etc.); just confirm
    // SOMETHING came through, not the specific code, since the
    // proof procedure may evolve.
    expect(errors[0]?.errorCode).toBeTruthy();
    expect(errors[0]?.recoverable).toBe(false);
  });

  it('replay with the same envelope reuses the existing operation_events row', async () => {
    const envelope = {
      operationId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientCreatedAt: new Date().toISOString(),
    };
    const caller1 = makeCaller({ envelope });
    await caller1.auth.changePassword({
      currentPassword: 'TestPassword123!',
      newPassword: 'Replay123Original!',
    });
    const { operationEvents } = await import('../db/schema.js');
    const firstSnapshot = await getDatabase()
      .select()
      .from(operationEvents)
      .where(eq(operationEvents.operationId, envelope.operationId))
      .all();
    expect(firstSnapshot.length).toBe(1);

    // Replay with the SAME envelope + same canonical input —
    // commandEnvelope returns the cached result without re-running
    // the procedure. The journal must NOT create a second event row.
    const caller2 = makeCaller({ envelope });
    await caller2.auth.changePassword({
      currentPassword: 'TestPassword123!',
      newPassword: 'Replay123Original!',
    });
    const secondSnapshot = await getDatabase()
      .select()
      .from(operationEvents)
      .where(eq(operationEvents.operationId, envelope.operationId))
      .all();
    expect(secondSnapshot.length).toBe(1);
    expect(secondSnapshot[0]?.id).toBe(firstSnapshot[0]?.id);
  });
});
