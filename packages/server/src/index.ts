/**
 * Puntovivo Server - Main Entry Point
 *
 * Fastify server with Drizzle ORM and SQLite for the POS system.
 * Can run embedded in Electron or standalone.
 *
 * @module server
 */

import { randomBytes } from 'crypto';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { initDatabase, closeDatabase, type DatabaseInstance } from './db/index.js';
import {
  setActiveRuntimeConfig,
  type RuntimeConfig,
} from './config/runtime.js';
import {
  countActiveDevices,
  fingerprintDbPath,
  getCurrentSchemaVersion,
} from './lib/runtimeMetadata.js';
import { createModuleLogger, rootLogger } from './logging/logger.js';
import {
  createFiscalWorker,
  setDefaultFiscalWorker,
} from './services/fiscal/fiscal-worker.js';
import {
  createHardwareWorker,
  setDefaultHardwareWorker,
} from './services/peripherals/hardware-worker.js';
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
  /**
   * ENG-072 — resolved Authority Node runtime config. Standalone and
   * Electron callers resolve this via `resolveRuntimeConfig` and pass
   * it in. When omitted (typical in tests), `createServer` synthesizes
   * a `device_local` runtime from `host`/`port` so existing tests stay
   * unchanged.
   */
  runtime?: RuntimeConfig;
  /**
   * ENG-073 — installed app version surfaced on `/api/health`.
   * Standalone reads from `process.env.npm_package_version`; Electron
   * passes `app.getVersion()`. Defaults to `'unknown'` when omitted
   * so tests do not need to wire it.
   */
  appVersion?: string;
}

export interface PuntovivoServer {
  /** The Fastify instance */
  app: FastifyInstance;
  /** The database instance */
  db: DatabaseInstance;
  /**
   * ENG-057 — Fiscal worker daemon registered to drain `fiscal_outbox`.
   * Tests call `fiscalWorker.tickOnce(tenantId)` directly to drive the
   * lifecycle synchronously without waiting for the periodic interval.
   */
  fiscalWorker: import('./services/fiscal/fiscal-worker.js').FiscalWorker;
  /**
   * ENG-062 — Hardware worker daemon registered to drain
   * `hardware_outbox`. Mirrors the fiscal worker; tests inject a
   * fast retry policy via `createHardwareWorker` directly when they
   * need to assert dead-letter transitions in tight loops.
   */
  hardwareWorker: import('./services/peripherals/hardware-worker.js').HardwareWorker;
  /** Start listening for requests */
  listen: () => Promise<string>;
  /** Stop the server and close database */
  close: () => Promise<void>;
  /** Get the server URL */
  getUrl: () => string;
}

/**
 * ENG-052b — Build the request-scoped child logger bindings used by
 * the `onRequest` hook below. Extracted so unit tests can call it
 * with a stub request without spinning up the full Fastify server.
 *
 * Pulled into module scope (not a closure inside `createServer`) so
 * the test file can import it directly without hitting the full
 * server lifecycle.
 */
export function buildRequestScopedLoggerBindings(
  request: Pick<FastifyRequest, 'id' | 'headers'>
): Record<string, string> {
  const headerValue = request.headers['x-device-id'];
  const deviceId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const bindings: Record<string, string> = { requestId: request.id };
  if (typeof deviceId === 'string' && deviceId.length > 0) {
    bindings.deviceId = deviceId;
  }
  return bindings;
}

function buildRequestScopedLogger(request: FastifyRequest): FastifyRequest['log'] {
  return request.log.child(buildRequestScopedLoggerBindings(request));
}

const SITE_HUB_JWT_SECRET_MIN_LENGTH = 32;
const SITE_HUB_JWT_SECRET_MIN_UNIQUE_CHARS = 8;
const BLOCKED_JWT_SECRET_PLACEHOLDERS = [
  'admin',
  'changeme',
  'development',
  'devsecret',
  'jwtsecret',
  'localhost',
  'password',
  'puntovivo',
  'secret',
  'testsecret',
  'testsecretnonempty',
  'testsecretmustbenonempty',
  '12345678901234567890123456789012',
] as const;

function normalizeJwtSecretForPolicy(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isPlaceholderJwtSecret(value: string): boolean {
  const normalized = normalizeJwtSecretForPolicy(value);
  if (normalized.length === 0) return true;

  return BLOCKED_JWT_SECRET_PLACEHOLDERS.some(placeholder => {
    if (normalized === placeholder) return true;
    const repeated = placeholder.repeat(
      Math.ceil(normalized.length / placeholder.length)
    );
    return repeated.slice(0, normalized.length) === normalized;
  });
}

function getSiteHubJwtSecretPolicyFailures(secret: string | undefined): string[] {
  if (secret === undefined || secret.length === 0) return ['JWT_SECRET'];

  const failures: string[] = [];
  if (secret.length < SITE_HUB_JWT_SECRET_MIN_LENGTH) {
    failures.push(`minimum ${SITE_HUB_JWT_SECRET_MIN_LENGTH} characters`);
  }
  if (new Set(secret).size < SITE_HUB_JWT_SECRET_MIN_UNIQUE_CHARS) {
    failures.push(
      `at least ${SITE_HUB_JWT_SECRET_MIN_UNIQUE_CHARS} unique characters`
    );
  }
  if (isPlaceholderJwtSecret(secret)) {
    failures.push('not a common placeholder');
  }
  return failures;
}

function describeSiteHubJwtSecretRequirement(failures: string[]): string {
  if (failures.length === 1 && failures[0] === 'JWT_SECRET') return 'JWT_SECRET';
  return `strong JWT_SECRET (${failures.join('; ')})`;
}

/**
 * Create and configure the Puntovivo server
 */
export async function createServer(options: ServerOptions): Promise<PuntovivoServer> {
  const {
    dbPath,
    port = 8090,
    host = '127.0.0.1',
    jwtSecret: explicitJwtSecret,
    verbose = false,
    corsOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
    ],
    migrationsFolder,
    runtime,
    appVersion = 'unknown',
  } = options;

  // ENG-073 — track whether the operator explicitly supplied the
  // JWT secret. Auto-generated secrets reset on every restart, which
  // is fine on a single device_local cashier (the operator just logs
  // back in once after a desktop relaunch) but unacceptable on a
  // site_hub (every cashier in the store loses their session). The
  // LAN guard below uses this flag to refuse a misconfigured hub
  // boot.
  const normalizedExplicitJwtSecret =
    typeof explicitJwtSecret === 'string' ? explicitJwtSecret.trim() : undefined;
  const jwtSecretWasExplicit =
    normalizedExplicitJwtSecret !== undefined && normalizedExplicitJwtSecret.length > 0;
  const jwtSecret = jwtSecretWasExplicit ? normalizedExplicitJwtSecret : generateSecret();

  // ENG-072 — resolve the Authority Node runtime config. Explicit
  // option wins; otherwise synthesize a `device_local` runtime from
  // the host/port options so callers that predate the runtime field
  // (existing tests, internal tooling) keep working without change.
  const resolvedRuntime: RuntimeConfig = runtime ?? {
    authorityMode: 'device_local',
    bindHost: host,
    bindPort: port,
    hubUrl: null,
    siteId: null,
    deviceId: null,
    allowedLanOrigins: [],
  };
  setActiveRuntimeConfig(resolvedRuntime);
  // Honor the runtime config's bind host/port over the legacy options
  // when an explicit runtime is supplied. Tests passing only host/port
  // hit the synthesized runtime branch above, so this assignment is a
  // no-op for them.
  const bindHost = runtime ? resolvedRuntime.bindHost : host;
  const bindPort = runtime ? resolvedRuntime.bindPort : port;

  // ENG-073 — Store Hub LAN bind hardening. When the operator opts
  // into `site_hub` mode the embedded Fastify becomes reachable to
  // every cashier terminal on the LAN, which widens the trust
  // surface beyond the loopback default. Refuse the boot when:
  //   - JWT_SECRET was not supplied explicitly OR does not meet the
  //     Store Hub strength policy (auto-generated or weak secrets
  //     reset/break cashier sessions or make LAN tokens guessable), OR
  //   - allowedLanOrigins is empty (no operator-defined CORS
  //     surface; we never accept arbitrary origins on a hub).
  // device_local and hub_client modes skip this check — the former
  // is loopback-only, the latter only consumes a remote hub and
  // does not accept LAN traffic on its own.
  if (resolvedRuntime.authorityMode === 'site_hub') {
    const missing: string[] = [];
    const jwtSecretFailures = getSiteHubJwtSecretPolicyFailures(
      jwtSecretWasExplicit ? jwtSecret : undefined
    );
    if (jwtSecretFailures.length > 0) {
      missing.push(describeSiteHubJwtSecretRequirement(jwtSecretFailures));
    }
    if (resolvedRuntime.allowedLanOrigins.length === 0) {
      missing.push('PUNTOVIVO_ALLOWED_LAN_ORIGINS');
    }
    if (missing.length > 0) {
      throw new Error(
        `[runtime-config] site_hub mode requires explicit ` +
          `${missing.join(' and ')}. ` +
          `See docs/AUTHORITY-NODE.md > Store Hub Mode for the operator setup.`
      );
    }
  }

  // ENG-073 — extend the CORS allow-list with operator-configured
  // LAN origins when in site_hub mode. The default dev origins stay
  // intact so an operator setting up a hub can still load the
  // renderer from `localhost:3000` while bringing the LAN
  // configuration online. device_local and hub_client modes leave
  // the list untouched.
  const effectiveCorsOrigins =
    resolvedRuntime.authorityMode === 'site_hub'
      ? Array.from(new Set([...corsOrigins, ...resolvedRuntime.allowedLanOrigins]))
      : corsOrigins;

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
    origin: effectiveCorsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-site-id',
      CSRF_HEADER_NAME,
      // ENG-052 — Command Envelope (ADR-0002) headers.
      'x-device-id',
      'x-puntovivo-envelope',
    ],
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

  // ENG-052b — request-scoped child logger so every log line emitted
  // during a request carries `requestId` (Fastify reqId) plus the
  // best-effort `deviceId` from the Command Envelope header. The
  // tenant + user ids are NOT yet known here (auth runs later in the
  // tRPC layer) — `commandEnvelope` adds them when it has the
  // resolved context. The hook is intentionally cheap (string read +
  // child(), no DB calls) so non-/api/ routes stay unaffected.
  app.addHook('onRequest', async request => {
    request.log = buildRequestScopedLogger(request);
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
  // `loginRateLimit.ts` (per-IP 10/60s + per-username 5/15min), which
  // stays stricter for failed-login traffic. The global bucket still
  // caps aggregate login traffic, matching every other HTTP route
  // until ENG-025's per-procedure follow-up lands.
  //
  // Per-procedure stricter buckets (e.g. `auth.changePassword`
  // tightened to 5/15min) need a tRPC-layer middleware similar to
  // `loginRateLimit.ts`. Captured as a follow-up; the 100/min cap
  // closes the bulk of the SEC-2 finding.
  const rateLimit = await import('@fastify/rate-limit');
  const globalRateLimitMax = Number.parseInt(
    process.env.PUNTOVIVO_GLOBAL_RATE_LIMIT_MAX ?? '',
    10
  );
  await app.register(rateLimit.default, {
    global: true,
    max:
      Number.isFinite(globalRateLimitMax) && globalRateLimitMax > 0
        ? globalRateLimitMax
        : 100,
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

  // ENG-073 — fingerprint the dbPath once at boot. The endpoint
  // re-reads schema version + active device count on every request
  // (cheap point queries), but the fingerprint is deterministic so
  // there is no need to recompute it.
  const dbPathFingerprint = fingerprintDbPath(dbPath);

  // Keep the legacy health endpoint as a compatibility surface while
  // `health.check` on `/api/trpc` remains the canonical health procedure.
  // ENG-073 extends the body with Authority Node identity fields so
  // an operator running `curl /api/health` against a hub can verify
  // the boot mode + active device count + DB lineage without logging
  // in. None of the new fields carry secrets — the dbPath fingerprint
  // is a SHA-256 truncation, not the raw path.
  app.get('/api/health', async (_request, reply) => {
    reply.header('x-puntovivo-compat', 'legacy-health');
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      compatibility: true,
      canonicalProcedure: 'health.check',
      canonicalPath: '/api/trpc/health.check',
      authorityMode: resolvedRuntime.authorityMode,
      appVersion,
      dbSchemaVersion: getCurrentSchemaVersion(db),
      dbPathFingerprint,
      activeDeviceCount: countActiveDevices(db),
    };
  });

  // ENG-072 — initialize from the resolved bind host/port so the
  // pre-listen `getUrl()` matches what the server will bind to. The
  // legacy options destructure (`host`, `port`) only matches when the
  // caller did NOT pass an explicit `runtime`; when they did, the
  // runtime config is the source of truth.
  let serverUrl = `http://${bindHost}:${bindPort}`;

  // ENG-057 — boot the fiscal outbox worker daemon. Registered as the
  // default singleton so `safelyEmitFiscalDocument` can fire-and-forget
  // an immediate tick after enqueue without taking a worker reference
  // through every call site. The periodic interval starts on `listen`
  // (below) so test harnesses that build the server without listening
  // do not accumulate background timers.
  const fiscalWorker = createFiscalWorker({ db });
  setDefaultFiscalWorker(fiscalWorker);
  app.addHook('onClose', async () => {
    await fiscalWorker.stop();
    setDefaultFiscalWorker(null);
  });

  // ENG-062 — boot the hardware outbox worker daemon parallel to the
  // fiscal worker. Same boot/teardown pattern; the periodic interval
  // starts on `listen` so test harnesses that build without listening
  // never accumulate background timers.
  const hardwareWorker = createHardwareWorker({ db });
  setDefaultHardwareWorker(hardwareWorker);
  app.addHook('onClose', async () => {
    await hardwareWorker.stop();
    setDefaultHardwareWorker(null);
  });

  const serverLog = createModuleLogger('server');
  return {
    app,
    db,
    fiscalWorker,
    hardwareWorker,
    listen: async () => {
      const address = await app.listen({ port: bindPort, host: bindHost });
      serverUrl = address;
      // ENG-072 — when callers pass `port: 0` / `bindPort: 0` to let
      // the OS assign a random port, the resolved runtime captured
      // before listen reads `bindPort: 0`. After listen the actual
      // port is known via Fastify's address — refresh the singleton
      // so `getActiveRuntimeConfig()` (read by the diagnostics
      // manifest) reflects the listening port instead of the
      // requested-zero placeholder.
      const actualAddress = app.server.address();
      if (
        actualAddress &&
        typeof actualAddress === 'object' &&
        typeof actualAddress.port === 'number'
      ) {
        const refreshed: RuntimeConfig = {
          ...resolvedRuntime,
          bindPort: actualAddress.port,
        };
        setActiveRuntimeConfig(refreshed);
      }
      fiscalWorker.start();
      hardwareWorker.start();
      serverLog.info(
        {
          address,
          authorityMode: resolvedRuntime.authorityMode,
          bindHost: resolvedRuntime.bindHost,
          bindPort:
            actualAddress && typeof actualAddress === 'object'
              ? actualAddress.port
              : resolvedRuntime.bindPort,
        },
        'server listening'
      );
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
// ENG-072 — Authority Node runtime config. The Electron main process
// resolves the config from env (or its own future config file) before
// calling `createServer({ ..., runtime })`.
export {
  resolveRuntimeConfig,
  getRuntimeDefaults,
  getActiveRuntimeConfig,
  setActiveRuntimeConfig,
  clearActiveRuntimeConfig,
  VALID_AUTHORITY_MODES,
  type AuthorityMode,
  type RuntimeConfig,
  type ResolveRuntimeConfigOptions,
} from './config/runtime.js';
// ENG-074b — ESC/POS transport resolver. The Electron main imports
// this so the hub_client local hardware bridge can dispatch bytes
// returned from `peripherals.buildReceiptBytes` /
// `buildDrawerKickBytes` through the locally-attached printer
// without touching any DB. Per ADR-0008 rule 6 the bridge module
// MUST stay free of operational-table writes.
export {
  resolveTransport,
  EscPosTransportError,
  MockEscPosTransport,
  __setEscPosTransportForTest,
  type EscPosChannel,
  type EscPosTransport,
  type EscPosTransportConfig,
} from './services/peripherals/escpos/transport.js';
