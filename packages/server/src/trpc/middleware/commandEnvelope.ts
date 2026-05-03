/**
 * ENG-052 — `commandEnvelope` tRPC middleware.
 *
 * Wraps every critical mutation listed in ADR-0002. Responsibilities,
 * in order:
 *
 * 1. Read the `x-device-id` header. Validate against the `devices`
 *    table for the active tenant. Reject with `DEVICE_NOT_REGISTERED`
 *    on miss / mismatch / deactivated.
 * 2. Read the `x-puntovivo-envelope` header (JSON). Validate shape
 *    via Zod. Reject with `MISSING_COMMAND_ENVELOPE` on missing /
 *    malformed.
 * 3. Hash the canonical input. Atomically reserve `idempotency_keys`
 *    by `(tenantId, deviceId, idempotencyKey, operationKind)`.
 *    - First caller reserves the key and invokes the procedure.
 *    - Hit with matching hash while first caller runs → throw
 *      `COMMAND_IN_PROGRESS` (procedure NOT invoked).
 *    - Hit with matching hash after success → return cached
 *      `result_ref` (procedure NOT invoked).
 *    - Hit with mismatched hash → throw `IDEMPOTENCY_KEY_CONFLICT`
 *      with both hashes in `details`.
 * 4. Inject `ctx.envelope`, `ctx.deviceId`, `ctx.log` (request-scoped
 *    child logger) for downstream procedure code.
 * 5. Mark the device as seen (best-effort; failure does not roll
 *    back the procedure).
 *
 * Composes after `tenantProcedure` (depends on `ctx.tenantId`).
 *
 * @module trpc/middleware/commandEnvelope
 */

import { TRPCError } from '@trpc/server';
import { findActiveDevice, markSeen } from '../../services/devices/devicesService.js';
import {
  completeKey,
  failKey,
  reserveKey,
} from '../../services/idempotency/idempotencyService.js';
import { hashCanonicalInput } from '../../services/idempotency/keyHasher.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { createModuleLogger } from '../../logging/logger.js';
import {
  COMMAND_ENVELOPE_HEADER,
  DEVICE_ID_HEADER,
  commandEnvelopeSchema,
  type CommandEnvelope,
} from '../schemas/envelope.js';
import { middleware } from '../init.js';
import type { Context } from '../context.js';

const log = createModuleLogger('commandEnvelope');

/**
 * Extracts the (operationKind) string from the tRPC path. The path is
 * the dotted procedure name like `sales.create`, so we keep it as-is.
 */
function readPath(meta: { path?: string } | undefined): string {
  return meta?.path ?? 'unknown';
}

function readHeader(req: Context['req'], name: string): string | null {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function parseEnvelope(rawHeader: string | null): CommandEnvelope {
  if (!rawHeader) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'MISSING_COMMAND_ENVELOPE',
      message:
        'Critical mutations require a Command Envelope. Renderer must set ' +
        'the x-puntovivo-envelope header (operationId, idempotencyKey, clientCreatedAt).',
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawHeader);
  } catch (parseError) {
    // Preserve the JSON parser's error message so the operator can
    // diagnose malformed envelopes from logs. The errorCode + trpc
    // code stay stable for the client; details carry the diagnostic
    // payload behind a structured shape.
    const parseMessage =
      parseError instanceof Error ? parseError.message : String(parseError);
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'MISSING_COMMAND_ENVELOPE',
      message: 'x-puntovivo-envelope header is not valid JSON.',
      details: { reason: 'invalid_json', parseMessage },
    });
  }
  const result = commandEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'MISSING_COMMAND_ENVELOPE',
      message: 'x-puntovivo-envelope shape invalid: ' + result.error.message,
      details: { issues: result.error.issues },
    });
  }
  return result.data;
}

/**
 * The middleware itself. Procedures pick this up via the
 * `criticalCommandProcedure` decorator (see `criticalCommand.ts`).
 */
export const commandEnvelope = middleware(async ({ ctx, next, path, getRawInput }) => {
  if (!ctx.tenantId || !ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Command envelope requires an authenticated tenant context.',
    });
  }
  const tenantId = ctx.tenantId;
  const user = ctx.user;

  const operationKind = readPath({ path });

  // 1. Device validation.
  const deviceId = readHeader(ctx.req, DEVICE_ID_HEADER);
  if (!deviceId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'DEVICE_NOT_REGISTERED',
      message:
        'x-device-id header is required for critical mutations. ' +
        'Call auth.registerDevice first and persist the returned id.',
    });
  }

  const device = await findActiveDevice(ctx.db, {
    tenantId,
    deviceId,
  });
  if (!device) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'DEVICE_NOT_REGISTERED',
      message:
        'Device id not found, deactivated, or belongs to a different tenant. ' +
        'Re-register via auth.registerDevice.',
      details: { deviceId },
    });
  }

  // 2. Envelope validation.
  const rawEnvelope = readHeader(ctx.req, COMMAND_ENVELOPE_HEADER);
  const envelope = parseEnvelope(rawEnvelope);

  // ENG-052b — Build a request-scoped child off the Fastify request
  // logger so every line carries `requestId` (set by the
  // `onRequest` hook in `index.ts`) in addition to envelope-level
  // bindings. Falling back to the module logger keeps tests that
  // mock `req` without a Fastify-shaped logger working.
  const baseLog =
    typeof (ctx.req as unknown as { log?: { child: (b: Record<string, unknown>) => unknown } }).log
      ?.child === 'function'
      ? ((ctx.req as unknown as {
          log: { child: (b: Record<string, unknown>) => typeof log };
        }).log)
      : log;
  const requestLog = baseLog.child({
    operationId: envelope.operationId,
    operationKind,
    deviceId: device.id,
    userId: user.id,
    tenantId,
  });

  // 3. Idempotency reservation. tRPC v11 lazily exposes the raw input via
  // getRawInput(); we resolve it here so the canonical hash covers
  // exactly what the client sent.
  const rawInput = await getRawInput();
  const requestHash = hashCanonicalInput(rawInput);
  const reservation = await reserveKey(ctx.db, {
    tenantId,
    deviceId: device.id,
    idempotencyKey: envelope.idempotencyKey,
    operationKind,
    requestHash,
  });

  if (reservation.state === 'conflict') {
    requestLog.warn(
      { storedHash: reservation.storedHash, providedHash: reservation.providedHash },
      'idempotency key replayed with mismatched canonical input hash'
    );
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'IDEMPOTENCY_KEY_CONFLICT',
      message:
        'Replay of idempotency key with a different canonical input. ' +
        'Mint a fresh idempotency key for the new payload.',
      details: {
        providedHash: reservation.providedHash,
        storedHash: reservation.storedHash,
        operationKind,
      },
    });
  }

  if (reservation.state === 'processing') {
    requestLog.warn(
      { lockedAt: reservation.lockedAt, expiresAt: reservation.expiresAt },
      'idempotency key replayed while original command is still processing'
    );
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'COMMAND_IN_PROGRESS',
      message:
        'A critical command with the same idempotency key is already processing. ' +
        'Wait for the original request to finish before retrying.',
      details: {
        operationKind,
        lockedAt: reservation.lockedAt,
        expiresAt: reservation.expiresAt,
      },
    });
  }

  if (reservation.state === 'cached') {
    requestLog.info('idempotency cache hit — returning stored result');
    // Background: bump last-seen on the device. Failure is non-fatal
    // for the request (we already have the cached result), but log
    // it via the request-scoped child logger so a recurring
    // markSeen failure stops being silent.
    markSeen(ctx.db, { tenantId, deviceId: device.id }).catch(err => {
      requestLog.warn({ err }, 'markSeen failed after idempotency cache hit');
    });
    // Returning a cached value through the middleware chain requires
    // wrapping in the MiddlewareResult shape so downstream code
    // doesn't try to re-run the procedure body.
    return {
      ok: true as const,
      data: reservation.resultRef,
      marker: 'middlewareMarker' as never,
    } as never;
  }

  const failReservation = () =>
    failKey(ctx.db, {
      tenantId,
      deviceId: device.id,
      idempotencyKey: envelope.idempotencyKey,
      operationKind,
      reservationId: reservation.reservationId,
      requestHash,
    });

  // 4. Run the procedure with envelope context, then persist.
  let result: Awaited<ReturnType<typeof next>>;
  try {
    result = await next({
      ctx: {
        ...ctx,
        deviceId: device.id,
        envelope,
        log: requestLog,
      },
    });
  } catch (error) {
    await failReservation();
    throw error;
  }

  if (!result.ok) {
    // Errors are NOT cached. Caller should retry with same key after
    // fixing the upstream condition.
    await failReservation();
    return result;
  }

  const completed = await completeKey(ctx.db, {
    tenantId,
    deviceId: device.id,
    idempotencyKey: envelope.idempotencyKey,
    operationKind,
    reservationId: reservation.reservationId,
    requestHash,
    resultRef: result.data,
  });
  if (!completed) {
    requestLog.error('idempotency reservation could not be completed after procedure success');
  }

  // Best-effort device liveness update — log via the request-scoped
  // child logger so recurring failures (e.g. DB lock contention)
  // surface in the operations dashboard later (ENG-065).
  markSeen(ctx.db, { tenantId, deviceId: device.id }).catch(err => {
    requestLog.warn({ err }, 'markSeen failed after successful command');
  });

  return result;
});
