/**
 * `commandEnvelope` tRPC middleware.
 *
 * Wraps every critical mutation listed in ADR-0002. Responsibilities,
 * in order:
 *
 * 1. Read the `x-device-id` header. Validate against the `devices`
 * table for the active tenant. Reject with `DEVICE_NOT_REGISTERED`
 * on miss / mismatch / deactivated.
 * 2. Read the `x-puntovivo-envelope` header (JSON). Validate shape
 * via Zod. Reject with `MISSING_COMMAND_ENVELOPE` on missing /
 * malformed.
 * 3. Hash the canonical input. Atomically reserve `idempotency_keys`
 * by `(tenantId, deviceId, idempotencyKey, operationKind)`.
 * - First caller reserves the key and invokes the procedure.
 * - Hit with matching hash while first caller runs → throw
 * `COMMAND_IN_PROGRESS` (procedure NOT invoked).
 * - Hit with matching hash after success → return cached
 * `result_ref` (procedure NOT invoked).
 * - Hit with mismatched hash → throw `IDEMPOTENCY_KEY_CONFLICT`
 * with both hashes in `details`.
 * 4. Inject `ctx.envelope`, `ctx.deviceId`, `ctx.log` (request-scoped
 * child logger) for downstream procedure code.
 * 5. Mark the device as seen (best-effort; failure does not roll
 * back the procedure).
 *
 * Composes after `tenantProcedure` (depends on `ctx.tenantId`).
 *
 * @module trpc/middleware/commandEnvelope
 */

import { TRPCError } from '@trpc/server';
import { findActiveDevice, markSeen } from '../../services/devices/devicesService.js';
import {
  completeKey,
  completeKeyInTransaction,
  failKey,
  readCompletedKey,
  reserveKey,
} from '../../services/idempotency/idempotencyService.js';
import type { DatabaseInstance } from '../../db/index.js';
import { hashCanonicalInput, hashCommandRequest } from '../../services/idempotency/keyHasher.js';
import {
  markOperationCompleted,
  recordError,
  recordOperationStart,
} from '../../services/operation-journal/journal.js';
import { throwServerError, ServerErrorWithCode } from '../../lib/errorCodes.js';
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

/** Request-scoped child logger injected by the envelope middleware. */
type CommandLogger = ReturnType<typeof createModuleLogger>;

/**
 * the context shape every `criticalCommand*Procedure`
 * resolver sees after `commandEnvelope` has run. The middleware
 * injects `deviceId`, the validated `envelope`, and a request-scoped
 * child `log`; declaring the augmented shape once lets resolvers (and
 * their `build*Context` helpers) read `ctx.envelope` / `ctx.deviceId`
 * directly instead of the old `(ctx as unknown as { envelope?: ... })`
 * double-cast. The middleware forces this type on the `next({ ctx })`
 * call below so tRPC propagates it down the `.use(commandEnvelope)`
 * chain.
 */
export interface CriticalCommandContext extends Omit<Context, 'tenantId' | 'user'> {
  // The middleware throws `UNAUTHORIZED` when either is absent (see the
  // guard at the top of the handler), so downstream resolvers always
  // see a non-null tenant + user.
  tenantId: string;
  user: NonNullable<Context['user']>;
  deviceId: string;
  envelope: CommandEnvelope;
  log: CommandLogger;
  /**
   * Finish the idempotency row as the last write in a domain transaction.
   * Commands that do not yet own an atomic transaction may omit this call and
   * retain the middleware's compatibility completion after the resolver.
   */
  completeInTransaction: (db: DatabaseInstance, resultRef: unknown) => void;
}

/**
 * narrow a resolver's `ctx` to `CriticalCommandContext` at a
 * single documented boundary.
 *
 * tRPC does NOT propagate the `commandEnvelope` context override to
 * downstream resolvers: the middleware's idempotency cache short-circuit
 * returns a value that did not flow through `next()`, which collapses
 * tRPC's `$ContextOverridesOut` inference back to the base `Context`.
 * The middleware still injects `deviceId` / `envelope` / `log` at
 * runtime (see the typed `criticalCtx` it passes to `next` below), so
 * the assertion is sound for any procedure built on
 * `criticalCommand*Procedure`. This helper replaces the nine ad-hoc
 * `(ctx as unknown as { envelope?: ... })` double-casts that used to be
 * scattered across the sales / cashSessions / inventory routers with a
 * single, named, documented conversion. Only call it from inside a
 * `criticalCommand*Procedure` resolver.
 */
export function asCriticalCommandContext(ctx: Context): CriticalCommandContext {
  return ctx as unknown as CriticalCommandContext;
}

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

function isSqliteBusy(error: unknown): boolean {
  const visited = new Set<unknown>();
  let candidate = error;

  for (let depth = 0; depth < 8 && candidate != null && !visited.has(candidate); depth += 1) {
    visited.add(candidate);
    if (typeof candidate !== 'object') return false;

    const code = (candidate as { code?: unknown }).code;
    if (typeof code === 'string' && (code === 'SQLITE_BUSY' || code.startsWith('SQLITE_BUSY_'))) {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }

  return false;
}

function throwCommandDatabaseBusy(operationKind: string): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'COMMAND_DATABASE_BUSY',
    message: 'The local command store is temporarily busy. Retry the same command envelope.',
    details: { operationKind },
  });
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
    const parseMessage = parseError instanceof Error ? parseError.message : String(parseError);
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

  // Build a request-scoped child off the Fastify request
  // logger so every line carries `requestId` (set by the
  // `onRequest` hook in `index.ts`) in addition to envelope-level
  // bindings. Falling back to the module logger keeps tests that
  // mock `req` without a Fastify-shaped logger working.
  const baseLog =
    typeof (ctx.req as unknown as { log?: { child: (b: Record<string, unknown>) => unknown } }).log
      ?.child === 'function'
      ? (
          ctx.req as unknown as {
            log: { child: (b: Record<string, unknown>) => typeof log };
          }
        ).log
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
  // Identity covers the effective site as well as the input — see
  // hashCommandRequest. Defence in depth behind the client, which already
  // pins a retained envelope to the scope it was minted in.
  const requestHash = hashCommandRequest({ input: rawInput, siteId: ctx.siteId ?? null });
  let reservation: Awaited<ReturnType<typeof reserveKey>>;
  try {
    reservation = await reserveKey(ctx.db, {
      tenantId,
      deviceId: device.id,
      idempotencyKey: envelope.idempotencyKey,
      operationKind,
      requestHash,
    });
  } catch (error) {
    if (isSqliteBusy(error)) {
      requestLog.warn(
        { err: error },
        'command reservation could not acquire the SQLite writer lock'
      );
      throwCommandDatabaseBusy(operationKind);
    }
    throw error;
  }

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

  const failReservation = async () => {
    try {
      await failKey(ctx.db, {
        tenantId,
        deviceId: device.id,
        idempotencyKey: envelope.idempotencyKey,
        operationKind,
        reservationId: reservation.reservationId,
        requestHash,
      });
    } catch (failureError) {
      // Preserve the domain failure as the public response. A failed cleanup
      // remains bounded by the short processing lease and is safe to reclaim.
      requestLog.warn({ err: failureError }, 'failed to release command reservation');
    }
  };

  let attemptedTransactionalCompletion = false;
  let transactionalResultRef: unknown;
  const completeInTransaction = (db: DatabaseInstance, resultRef: unknown) => {
    const completed = completeKeyInTransaction(db, {
      tenantId,
      deviceId: device.id,
      idempotencyKey: envelope.idempotencyKey,
      operationKind,
      reservationId: reservation.reservationId,
      requestHash,
      resultRef,
    });
    if (!completed) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'COMMAND_IN_PROGRESS',
        message: 'The command reservation changed before the transaction could commit.',
        details: { operationKind },
      });
    }
    attemptedTransactionalCompletion = true;
    transactionalResultRef = resultRef;
  };

  // Operation journal start row. Idempotent on
  // (tenantId, operationId), so a retry with the same envelope
  // (same operationId, same idempotencyKey) reuses the existing
  // event id. Best-effort: if the journal insert fails we log and
  // proceed — the primary work must not block on observability.
  let journalEventId: string | null = null;
  try {
    const { eventId } = await recordOperationStart(ctx.db, {
      tenantId,
      operationId: envelope.operationId,
      operationKind,
      deviceId: device.id,
      userId: user.id,
      requestHash,
    });
    journalEventId = eventId;
  } catch (journalErr) {
    requestLog.warn(
      { err: journalErr },
      'recordOperationStart failed; continuing without journal correlation'
    );
  }

  // 4. Run the procedure with envelope context, then persist.
  let result: Awaited<ReturnType<typeof next>>;
  try {
    // build the augmented context as an explicitly typed
    // const so tRPC propagates `CriticalCommandContext` to every
    // downstream `criticalCommand*Procedure` resolver (no more
    // `(ctx as unknown as { envelope?: ... })` casts in the routers).
    const criticalCtx: CriticalCommandContext = {
      ...ctx,
      tenantId,
      user,
      deviceId: device.id,
      envelope,
      log: requestLog,
      completeInTransaction,
    };
    result = await next({ ctx: criticalCtx });
  } catch (caughtError) {
    let error = caughtError;
    if (attemptedTransactionalCompletion) {
      try {
        const persisted = await readCompletedKey(ctx.db, {
          tenantId,
          deviceId: device.id,
          idempotencyKey: envelope.idempotencyKey,
          operationKind,
          reservationId: reservation.reservationId,
          requestHash,
        });
        if (persisted.completed) {
          requestLog.error(
            { err: error },
            'procedure threw after its command transaction committed; returning cached result'
          );
          if (journalEventId) {
            try {
              await markOperationCompleted(ctx.db, journalEventId, 'succeeded');
            } catch (journalErr) {
              requestLog.warn(
                { err: journalErr },
                'markOperationCompleted(succeeded) failed after committed resolver throw'
              );
            }
          }
          return {
            ok: true as const,
            data: persisted.resultRef,
            marker: 'middlewareMarker' as never,
          } as never;
        }
      } catch (recoveryError) {
        requestLog.warn(
          { err: recoveryError, originalError: error },
          'could not verify whether transactional command completion committed'
        );
        if (isSqliteBusy(recoveryError)) error = recoveryError;
      }
    }
    await failReservation();
    // Capture the failure on the journal trail. The
    // caught error is typically a TRPCError carrying our
    // structured ServerErrorWithCode in `cause`; extract the
    // stable code when possible so the trail has consistent
    // vocabulary.
    if (journalEventId) {
      const commandDatabaseBusy = isSqliteBusy(error);
      const code = commandDatabaseBusy
        ? 'COMMAND_DATABASE_BUSY'
        : error instanceof TRPCError && error.cause instanceof ServerErrorWithCode
          ? error.cause.errorCode
          : 'PROCEDURE_THREW';
      const message = commandDatabaseBusy
        ? 'The local command store could not acquire its writer lock.'
        : error instanceof Error
          ? error.message
          : String(error);
      try {
        await recordError(ctx.db, {
          operationEventId: journalEventId,
          errorCode: code,
          message,
          // Must track the classification above: COMMAND_DATABASE_BUSY is
          // advertised to the client as retryable, so journalling it as
          // permanent would make operational review read transient lock
          // contention as a hard failure.
          recoverable: commandDatabaseBusy,
          errorData:
            error instanceof TRPCError && error.cause instanceof ServerErrorWithCode
              ? (error.cause.details ?? null)
              : null,
        });
        await markOperationCompleted(ctx.db, journalEventId, 'failed');
      } catch (journalErr) {
        requestLog.warn(
          { err: journalErr, originalError: code },
          'journal recordError/markCompleted failed during procedure throw path'
        );
      }
    }
    if (isSqliteBusy(error)) throwCommandDatabaseBusy(operationKind);
    throw error;
  }

  if (!result.ok) {
    // Errors are NOT cached. Caller should retry with same key after
    // fixing the upstream condition.
    await failReservation();
    if (journalEventId) {
      try {
        await recordError(ctx.db, {
          operationEventId: journalEventId,
          errorCode: 'PROCEDURE_NOT_OK',
          message: 'Procedure returned MiddlewareResult with ok=false',
          recoverable: false,
          errorData: null,
        });
        await markOperationCompleted(ctx.db, journalEventId, 'failed');
      } catch (journalErr) {
        requestLog.warn(
          { err: journalErr },
          'journal recordError/markCompleted failed during result.ok=false path'
        );
      }
    }
    return result;
  }

  if (attemptedTransactionalCompletion) {
    if (hashCanonicalInput(transactionalResultRef) !== hashCanonicalInput(result.data)) {
      requestLog.error(
        'transactional command returned a result different from its cached canonical response'
      );
      result = {
        ok: true as const,
        data: transactionalResultRef,
        marker: 'middlewareMarker' as never,
      } as never;
    }
  } else {
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
  }

  // Mark the operation as succeeded. Best-effort; the
  // primary work is already committed by this point.
  if (journalEventId) {
    try {
      await markOperationCompleted(ctx.db, journalEventId, 'succeeded');
    } catch (journalErr) {
      requestLog.warn({ err: journalErr }, 'markOperationCompleted(succeeded) failed');
    }
  }

  // Best-effort device liveness update — log via the request-scoped
  // child logger so recurring failures (e.g. DB lock contention)
  // surface in the operations dashboard later ().
  markSeen(ctx.db, { tenantId, deviceId: device.id }).catch(err => {
    requestLog.warn({ err }, 'markSeen failed after successful command');
  });

  return result;
});
