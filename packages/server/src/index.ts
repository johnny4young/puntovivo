/**
 * Puntovivo Server - Main Entry Point
 *
 * Fastify server with Drizzle ORM and SQLite for the POS system.
 * Can run embedded in Electron or standalone.
 *
 * @module server
 */

import { randomBytes } from 'crypto';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { initDatabase, closeDatabase, type DatabaseInstance } from './db/index.js';
import { createModuleLogger, rootLogger } from './logging/logger.js';
import { ssePlugin } from './realtime/sse.js';
import { REFRESH_COOKIE_NAME } from './security/authTokens.js';
import { warmCacheFromDb } from './security/loginRateLimit.js';
import {
  CSRF_HEADER_NAME,
  ensureCsrfCookie,
  getCsrfHeader,
  isUnsafeMethod,
} from './security/csrf.js';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';

export interface ServerOptions {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Port to listen on (default: 8090) */
  port?: number;
  /** Host to bind to (default: '127.0.0.1') */
  host?: string;
  /** JWT secret for authentication (default: auto-generated) */
  jwtSecret?: string;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
  /** CORS origins (default: ['http://localhost:3000', 'http://localhost:5173']) */
  corsOrigins?: string[];
  /**
   * Override the folder that holds the generated Drizzle SQL migrations.
   * Defaults to the `migrations/` directory next to the compiled server
   * module. Packaged Electron builds pass `process.resourcesPath/migrations`
   * because the `.sql` files ship alongside the bundle via Forge
   * `extraResource`, not inside the Vite output.
   */
  migrationsFolder?: string;
}

export interface PuntovivoServer {
  /** The Fastify instance */
  app: FastifyInstance;
  /** The database instance */
  db: DatabaseInstance;
  /** Start listening for requests */
  listen: () => Promise<string>;
  /** Stop the server and close database */
  close: () => Promise<void>;
  /** Get the server URL */
  getUrl: () => string;
}

/**
 * Create and configure the Puntovivo server
 */
export async function createServer(options: ServerOptions): Promise<PuntovivoServer> {
  const {
    dbPath,
    port = 8090,
    host = '127.0.0.1',
    jwtSecret = generateSecret(),
    verbose = false,
    corsOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
    ],
    migrationsFolder,
  } = options;

  // Initialize database
  const db = await initDatabase({
    dbPath,
    runMigrations: true,
    seedData: true,
    verbose,
    migrationsFolder,
  });

  // ENG-008b — prime the loginRateLimit in-memory cache from the persisted
  // `login_attempts` table so the first post-restart check hits the cache
  // instead of paying a DB round-trip. `warmCacheFromDb` is safe to call
  // against an adopted DB missing migration 0006 (no-op + warn).
  warmCacheFromDb(db);

  // ENG-006 — Fastify adopts the shared pino rootLogger so HTTP request
  // logs and application logs share one NDJSON stream with the same
  // redact config. Kept behind the existing `verbose` toggle so
  // production stays silent (matching the pre-ENG-006 posture) while
  // dev/test runs get structured HTTP logs that automatically mask
  // credentials. App-level logging via createModuleLogger is always on
  // regardless of this flag.
  // Fastify 5.8 split the `logger` option into two:
  //   - `logger`: accepts booleans and plain-object config only
  //   - `loggerInstance`: accepts a pre-constructed logger (pino, etc.)
  // Passing a pino instance to `logger` now throws
  // `FST_ERR_LOG_INVALID_LOGGER_CONFIG`. Keep `logger: false` as the
  // disabled-logging signal and use `loggerInstance` for the verbose
  // path so fastify/lib/logger-factory.js routes through
  // createPinoLogger({ logger: rootLogger, ... }) as intended.
  // Cast the pino instance to FastifyBaseLogger so the resulting
  // FastifyInstance keeps the default logger type — otherwise TS widens
  // it to `PuntovivoLogger` (our pino subtype carrying `msgPrefix`) and
  // collides with the `FastifyInstance` surface declared on
  // `PuntovivoServer`. pino.Logger implements the full FastifyBaseLogger
  // contract, so the cast is safe at runtime.
  const fastifyLoggerOption = verbose
    ? { loggerInstance: rootLogger as unknown as FastifyBaseLogger }
    : { logger: false as const };
  const app = Fastify({
    ...fastifyLoggerOption,
    // tRPC batch URLs encode comma-separated procedure names as a single route param.
    // The default limit (100) is too short for multi-procedure batches on this router.
    // Use routerOptions per Fastify v5 API (top-level maxParamLength is deprecated).
    routerOptions: {
      maxParamLength: 1024,
    },
  });

  // Register CORS
  await app.register(cors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-site-id', CSRF_HEADER_NAME],
    credentials: true,
  });

  await app.register(cookie);

  // Register JWT
  await app.register(jwt, {
    secret: jwtSecret,
    sign: {
      expiresIn: '7d',
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) {
      return;
    }

    const csrfToken = ensureCsrfCookie(request, reply);
    const hasRefreshCookie = typeof request.cookies[REFRESH_COOKIE_NAME] === 'string';

    if (!hasRefreshCookie || !isUnsafeMethod(request.method)) {
      return;
    }

    const csrfHeader = getCsrfHeader(request);
    if (csrfHeader === csrfToken) {
      return;
    }

    reply.code(403).send({
      error: 'CSRF_VALIDATION_FAILED',
      message: 'Missing or invalid CSRF token',
    });
  });

  // ENG-025 vector 2 — global rate-limit on every HTTP surface
  // (tRPC, SSE, /api/health). Previously registered with
  // `global: false`, which meant nothing on the wire was throttled —
  // `auth.refresh`, `auth.changePassword`, and every mutation were
  // open to brute-force. Switched to global: true with a generous
  // 100/min/IP cap; the fastify-trpc plugin registers a single
  // wildcard route (`/api/trpc/:path`) so per-procedure distinction
  // is not possible at the Fastify level — the cap is uniform and
  // intentionally permissive to leave normal session traffic
  // untouched while still catching brute-force.
  //
  // `auth.login` keeps its custom DB-backed dual bucket from
  // `loginRateLimit.ts` (per-IP 10/60s + per-username 5/15min) which
  // is stricter than 100/min and fires before this global bucket
  // would; the two coexist cleanly because the custom bucket throws
  // TRPCError before the Fastify plugin's counter increments.
  //
  // Per-procedure stricter buckets (e.g. `auth.changePassword`
  // tightened to 5/15min) need a tRPC-layer middleware similar to
  // `loginRateLimit.ts`. Captured as a follow-up; the 100/min cap
  // closes the bulk of the SEC-2 finding.
  const rateLimit = await import('@fastify/rate-limit');
  await app.register(rateLimit.default, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
  });

  // Register SSE plugin
  await app.register(ssePlugin);

  // Decorate request with database instance
  app.decorate('db', db);

  // Register tRPC
  const trpcLog = createModuleLogger('trpc');
  await app.register(fastifyTRPCPlugin, {
    prefix: '/api/trpc',
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ path, error }: { path?: string; error: unknown }) {
        trpcLog.error({ path: path ?? 'unknown', err: error }, 'tRPC procedure error');
      },
    },
  });

  // Keep the legacy health endpoint as a compatibility surface while
  // `health.check` on `/api/trpc` remains the canonical health procedure.
  app.get('/api/health', async (_request, reply) => {
    reply.header('x-puntovivo-compat', 'legacy-health');
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      compatibility: true,
      canonicalProcedure: 'health.check',
      canonicalPath: '/api/trpc/health.check',
    };
  });

  let serverUrl = `http://${host}:${port}`;

  const serverLog = createModuleLogger('server');
  return {
    app,
    db,
    listen: async () => {
      const address = await app.listen({ port, host });
      serverUrl = address;
      serverLog.info({ address }, 'server listening');
      return address;
    },
    close: async () => {
      await app.close();
      closeDatabase();
    },
    getUrl: () => serverUrl,
  };
}

/**
 * Generate a cryptographically secure random JWT secret
 */
function generateSecret(): string {
  // Use crypto.randomBytes for cryptographically secure random generation
  return randomBytes(32).toString('base64');
}

// Type augmentations for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    db: DatabaseInstance;
  }
}

// Re-export types and utilities
export * from './db/schema.js';
export { getDatabase, type DatabaseInstance } from './db/index.js';
export { SseManager, type SseClient } from './realtime/sse.js';
export type { AppRouter } from './trpc/router.js';
// ENG-025 — `desktopSession` (apps/desktop/src/main) imports this to
// validate the renderer's access token without a FastifyRequest.
export {
  verifyTokenWithServer,
  type AuthTokenPayload,
} from './security/authTokens.js';
// ENG-006 — the Electron main imports createModuleLogger via this
// barrel so app-level logs from both the embedded server and the
// desktop shell flow through the same pino instance.
export {
  createModuleLogger,
  rootLogger,
  type PuntovivoLogger,
} from './logging/logger.js';
