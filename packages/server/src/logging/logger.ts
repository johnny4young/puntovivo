/**
 * single pino logger for the whole server workspace.
 *
 * `rootLogger` is the shared pino instance; Fastify adopts it at
 * `createServer()` so HTTP request logs and application logs share one
 * NDJSON stream. `createModuleLogger('<name>')` returns a child that
 * stamps a stable `module` field on every record so operators can
 * `grep '"module":"sync"'` (or feed the stream into any JSON-aware
 * observability tool).
 *
 * Redaction policy — every field listed in `REDACT_PATHS` is replaced
 * with `[Redacted]` before pino ever writes it, so seed-time credential
 * dumps, request `authorization` headers, and refresh cookies cannot
 * leak even when an operator debug-logs the whole object. See
 * `docs/SECURITY.md` for the full policy.
 *
 * Level is driven by `PUNTOVIVO_LOG_LEVEL` (trace|debug|info|warn|
 * error|fatal). In the absence of that env var: `info` when
 * `NODE_ENV === 'production'`, otherwise `debug`.
 *
 * No `transport:` option — pino-pretty's worker-thread transport
 * cannot be resolved under Electron's CJS Vite bundle (the old
 * `logger: false` in `index.ts` was a workaround for exactly this).
 * The root logger writes plain NDJSON to stdout; developers who want
 * pretty output pipe it manually: `npm run dev:server | pino-pretty`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';

export type PuntovivoLogger = pino.Logger;

/**
 * Field paths that get censored to `[Redacted]` on every log record.
 *
 * Keep the list tight — over-redacting makes debugging harder, and
 * every addition is a policy change. Reuses the shape documented in
 * `docs/SECURITY.md` so the redaction contract stays in one place.
 */
const REDACT_PATHS: readonly string[] = [
  'password',
  'passwordHash',
  'pin',
  'staffPinHash',
  'staff_pin_hash',
  'token',
  'refreshToken',
  'jwtSecret',
  'signingSecret',
  'sealedSecret',
  'email',
  'authorization',
  'cookie',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.passwordHash',
  '*.pin',
  '*.staffPinHash',
  '*.staff_pin_hash',
  '*.token',
  '*.refreshToken',
  '*.signingSecret',
  '*.sealedSecret',
  '*.email',
  // preserve Error.cause chain for diagnostic context
  // (cause.tenantId, cause.siteId, cause.errorCode, ...) while
  // censoring sensitive nested fields. Pino does not support
  // recursive wildcards, so we list explicit paths covering the
  // realistic surface where credentials might leak through cause.
  // Note: pino's default `err` serializer drops `cause` from Error
  // instances, so `err.cause.*` paths would never match — app code
  // logs cause via `logger.{info,error}({ cause }, msg)` directly
  // (Categoría A bound to ServerErrorWithCode.details, Categoría B
  // helpers wrapping a plain object literal under `cause`).
  'cause.password',
  'cause.passwordHash',
  'cause.pin',
  'cause.staffPinHash',
  'cause.staff_pin_hash',
  'cause.token',
  'cause.refreshToken',
  'cause.email',
  'cause.jwtSecret',
  'cause.signingSecret',
  'cause.sealedSecret',
  'cause.authorization',
  'cause.*.password',
  'cause.*.passwordHash',
  'cause.*.pin',
  'cause.*.staffPinHash',
  'cause.*.staff_pin_hash',
  'cause.*.token',
  'cause.*.refreshToken',
  'cause.*.email',
  'cause.*.jwtSecret',
  'cause.*.authorization',
];

function resolveLevel(): string {
  const explicit = process.env.PUNTOVIVO_LOG_LEVEL;
  if (explicit) return explicit;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

export interface ExpectedTestLog {
  level: 'warn' | 'error' | 'fatal';
  module: string;
  message: string;
  count?: number;
}

interface ExpectedTestLogState {
  remaining: Array<Required<ExpectedTestLog>>;
}

const expectedTestLogs = new AsyncLocalStorage<ExpectedTestLogState>();
const expectedTestLogStack: ExpectedTestLogState[] = [];
const PINO_LEVELS = {
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

function resolveLogMessage(args: unknown[]): string | null {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const candidate = args[index];
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return null;
}

/**
 * Test-only scoped acknowledgement for an operational log that a negative-path
 * test deliberately triggers. Matching records are consumed instead of written
 * to stdout; missing records fail the wrapper, while any unlisted warning/error
 * remains visible and therefore cannot be hidden by the harness.
 */
export async function __withExpectedTestLogs<T>(
  expectations: ExpectedTestLog[],
  callback: () => T | Promise<T>
): Promise<T> {
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
    throw new Error('__withExpectedTestLogs is available only in a test process');
  }
  if (expectedTestLogStack.length > 0) {
    throw new Error('Expected-test-log scopes cannot overlap or nest within one test worker');
  }
  const state: ExpectedTestLogState = {
    remaining: expectations.map(expectation => ({
      ...expectation,
      count: expectation.count ?? 1,
    })),
  };

  let result: T | undefined;
  let callbackError: unknown;
  expectedTestLogStack.push(state);
  try {
    result = await expectedTestLogs.run(state, callback);
  } catch (error) {
    callbackError = error;
  }

  const popped = expectedTestLogStack.pop();
  if (popped !== state) {
    throw new Error('Expected-test-log scope stack was corrupted', {
      cause: callbackError,
    });
  }

  const missing = state.remaining.filter(expectation => expectation.count > 0);
  if (missing.length > 0) {
    throw new Error(`Expected test logs were not emitted: ${JSON.stringify(missing)}`, {
      cause: callbackError,
    });
  }
  if (callbackError !== undefined) {
    throw callbackError;
  }
  return result as T;
}

/**
 * The shared pino instance. Callers should almost always reach for
 * `createModuleLogger(...)` instead of using this directly, so every
 * record carries a `module` field.
 */
export const rootLogger: PuntovivoLogger = pino({
  level: resolveLevel(),
  redact: {
    paths: [...REDACT_PATHS],
    censor: '[Redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  hooks: {
    logMethod(args, method, level) {
      // Fastify's inject harness creates its own AsyncResource and does not
      // preserve the caller's AsyncLocalStorage store. Vitest runs ordinary
      // tests serially inside each worker, so the scoped stack is the precise
      // fallback for HTTP-inject callbacks. Overlapping and nested scopes are
      // rejected at entry so an out-of-context record cannot satisfy the wrong
      // active wrapper.
      const state = expectedTestLogs.getStore() ?? expectedTestLogStack.at(-1);
      if (state) {
        const message = resolveLogMessage(args);
        const module = this.bindings().module;
        const match = state.remaining.find(
          expectation =>
            expectation.count > 0 &&
            PINO_LEVELS[expectation.level] === level &&
            expectation.module === module &&
            expectation.message === message
        );
        if (match) {
          match.count -= 1;
          return;
        }
      }
      method.apply(this, args);
    },
  },
});

/**
 * Return a pino child logger tagged with `{ module }`. Every server
 * module (`auth`, `db`, `sync`, `sales`, `cash-session`, `security`,
 * etc.) should create its own child on module load and reuse it.
 *
 * @example
 * const log = createModuleLogger('sync');
 * log.info({ triggeredBy: 'user' }, 'sync cycle started');
 */
export function createModuleLogger(module: string): PuntovivoLogger {
  return rootLogger.child({ module });
}

/**
 * Exposed for tests. Production code must not mutate the redact list.
 */
export const __REDACT_PATHS_FOR_TESTS: readonly string[] = REDACT_PATHS;
