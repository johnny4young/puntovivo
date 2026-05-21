/**
 * ENG-135 — tRPC tracing middleware.
 *
 * Wraps every procedure call with a span:
 *
 *   - Reads `tenantId / userId` from the ctx (populated by
 *     `createContext` from the JWT). Procedures called without a
 *     valid session see both fields as null — that is acceptable,
 *     anonymous calls still get a correlationId.
 *   - Reads `correlationId` from `ctx.req.id` (Fastify reqId,
 *     already stamped on `request.log` by the onRequest hook from
 *     ENG-052b). The alias is semantic — both names refer to the
 *     same value.
 *   - Measures `performance.now()` start / end and logs the result
 *     at info level on success, error level on failure.
 *   - On failure routes the error through `captureException` so
 *     the centralized sink (when wired) sees it. The procedure
 *     error is re-thrown so the tRPC error formatter still runs
 *     downstream.
 *
 * Composition: applied to `publicProcedure` in `init.ts`, so every
 * chain (`protectedProcedure`, `tenantProcedure`, `adminProcedure`,
 * ...) inherits the tracing automatically.
 *
 * @module trpc/middleware/tracing
 */

import {
  captureException,
  recordSpan,
  type TelemetryEventAttrs,
} from '../../observability/index.js';
import { createModuleLogger } from '../../logging/logger.js';
import type { Context } from '../context.js';

const fallbackLog = createModuleLogger('trpc-tracing');

function resolveCorrelationId(ctx: Context): string | null {
  const reqId = ctx.req?.id;
  if (typeof reqId === 'string' && reqId.length > 0) return reqId;
  if (typeof reqId === 'number') return String(reqId);
  return null;
}

function resolveProcedureLogger(ctx: Context): {
  info: (bindings: Record<string, unknown>, msg: string) => void;
  error: (bindings: Record<string, unknown>, msg: string) => void;
} {
  // The Fastify request-scoped logger already carries `requestId` +
  // `deviceId`. Falling back to the module logger keeps the helper
  // safe in unit tests that build a minimal ctx without a real
  // FastifyRequest.
  const candidate = (ctx.req as { log?: unknown } | undefined)?.log;
  if (
    candidate &&
    typeof (candidate as { info?: unknown }).info === 'function' &&
    typeof (candidate as { error?: unknown }).error === 'function'
  ) {
    return candidate as ReturnType<typeof resolveProcedureLogger>;
  }
  return fallbackLog;
}

/**
 * The bare async middleware function. Wrap with the tRPC
 * `middleware()` factory at the call site (in `init.ts`) so this
 * module does not have to import from `init.ts` — avoiding the
 * circular load `init.ts → tracing.ts → init.ts`.
 */
export async function tracingMiddlewareFn({
  ctx,
  path,
  next,
}: {
  ctx: Context;
  path: string;
  next: () => Promise<unknown>;
}): Promise<unknown> {
  const procedure = path ?? 'unknown';
  const correlationId = resolveCorrelationId(ctx);
  const tenantId = ctx.tenantId ?? null;
  const userId = ctx.user?.id ?? null;
  const log = resolveProcedureLogger(ctx);
  const attrs: TelemetryEventAttrs = {
    tenantId,
    userId,
    correlationId,
    procedure,
  };

  const startedAt = performance.now();
  // tRPC middleware `next()` does NOT throw on procedure failure —
  // it resolves with `{ ok: false, error }`. Wrap both shapes so
  // the tracing log + captureException path runs regardless.
  let result: unknown;
  let caught: unknown = null;
  try {
    result = await next();
  } catch (err) {
    caught = err;
  }
  const durationMs = Math.max(0, performance.now() - startedAt);
  const resultShape = result as { ok?: boolean; error?: unknown } | undefined;
  const failed = caught !== null || resultShape?.ok === false;
  if (failed) {
    const err = caught ?? resultShape?.error;
    log.error(
      {
        procedure,
        durationMs,
        outcome: 'error',
        correlationId,
        tenantId,
        userId,
        err,
      },
      'trpc procedure error'
    );
    // Fire-and-forget on the sink path. Awaiting would add the
    // sink latency to the failing-request critical path; the
    // local pino log already captured the failure synchronously.
    // The lambda holds a reference to `ctx.db`, which under the
    // current Electron + standalone-server topology is a process-
    // lifetime singleton (`packages/server/src/db/index.ts`). If
    // the deployment topology ever decouples connections per
    // request, this fire-and-forget needs to be awaited or the
    // captured `db` needs to be a stable reference that survives
    // teardown.
    void captureException(err, { ...attrs, durationMs }, ctx.db);
    void recordSpan(procedure, attrs, durationMs, 'error', ctx.db);
    if (caught !== null) throw caught;
    return result;
  }
  log.info(
    {
      procedure,
      durationMs,
      outcome: 'ok',
      correlationId,
      tenantId,
      userId,
    },
    'trpc procedure ok'
  );
  void recordSpan(procedure, attrs, durationMs, 'ok', ctx.db);
  return result;
}
