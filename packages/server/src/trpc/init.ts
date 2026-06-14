/**
 * tRPC Initialization
 *
 * Base tRPC configuration for Puntovivo
 */

import { initTRPC, type TRPCDefaultErrorShape } from '@trpc/server';
import { ZodError } from 'zod';
import type { Context } from './context.js';
import { ServerErrorWithCode, type ServerErrorCode } from '../lib/errorCodes.js';

/**
 * The augmented error shape the client receives from every failed tRPC
 * request. Adds two i18n-aware fields on top of the default tRPC shape:
 *  - `errorCode`: stable machine-readable code attached via
 *    `throwServerError`. The client maps it to a translated message via
 *    `translateServerError`.
 *  - `errorDetails`: optional structured payload (e.g. password policy
 *    violations) the client can render alongside the translated message.
 */
export type FormattedErrorShape = TRPCDefaultErrorShape & {
  data: TRPCDefaultErrorShape['data'] & {
    zodError: ReturnType<ZodError['flatten']> | null;
    errorCode: ServerErrorCode | null;
    errorDetails: Record<string, unknown> | null;
  };
};

/**
 * Pure error formatter exported so it can be unit-tested in isolation from
 * tRPC's HTTP wire format. The actual call site is `t.create` below.
 */
export function formatTrpcError(args: {
  shape: TRPCDefaultErrorShape;
  error: { cause?: unknown };
}): FormattedErrorShape {
  const cause = args.error.cause;
  return {
    ...args.shape,
    data: {
      ...args.shape.data,
      zodError: cause instanceof ZodError ? cause.flatten() : null,
      errorCode: cause instanceof ServerErrorWithCode ? cause.errorCode : null,
      errorDetails:
        cause instanceof ServerErrorWithCode ? (cause.details ?? null) : null,
    },
  };
}

const t = initTRPC.context<Context>().create({
  errorFormatter: ({ shape, error }) => formatTrpcError({ shape, error }),
});

export const router = t.router;
export const middleware = t.middleware;

// ENG-135 — tracing wraps the entire procedure chain
// (`protectedProcedure`, `tenantProcedure`, `adminProcedure`, ...)
// so every call carries `procedure / durationMs / outcome /
// correlationId / tenantId / userId` on its server log line, and
// failures route through `captureException` to the centralized
// sink (when one is wired via `registerTelemetrySink`). The middleware
// is imported as a bare function and wrapped with `t.middleware`
// here so `tracing.ts` does not need to import from `init.ts` —
// that import edge would create a circular module load.
import { tracingMiddlewareFn } from './middleware/tracing.js';
const tracingMiddleware = t.middleware(
  tracingMiddlewareFn as Parameters<typeof t.middleware>[0]
);

// ENG-165 — tRPC-aware rate limiting runs on the base procedure so every
// call is bucketed by (procedure shape, tenant, user). Wrapped here as a
// bare function (like tracing) so `bucketRateLimit.ts` never imports
// `init.ts` — that edge would close a circular module load. The
// underlying store self-bypasses under the test runner, so this does not
// throttle the suite.
import { bucketRateLimitFn } from './middleware/bucketRateLimit.js';
const bucketRateLimitMiddleware = t.middleware(
  bucketRateLimitFn as Parameters<typeof t.middleware>[0]
);
export const publicProcedure = t.procedure
  .use(tracingMiddleware)
  .use(bucketRateLimitMiddleware);
