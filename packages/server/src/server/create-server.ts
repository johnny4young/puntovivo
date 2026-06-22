/**
 * Puntovivo server lifecycle orchestrator.
 *
 * `createServer` resolves the boot config, opens the DB, builds the
 * Fastify instance, registers the HTTP plugin/security stack and the
 * background workers in the boot-critical order, and returns the
 * `PuntovivoServer` handle (listen / close / getUrl). The per-concern
 * blocks live in the sibling `server/*` modules; this file is the
 * ordered wiring + the listen-time runtime-port refresh closure.
 *
 * @module server/create-server
 */

import Fastify, { type FastifyBaseLogger } from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { setActiveRuntimeConfig, type RuntimeConfig } from '../config/runtime.js';
import { closeDatabase, type DatabaseInstance, initDatabase } from '../db/index.js';
import {
  countActiveDevices,
  fingerprintDbPath,
  getCurrentSchemaVersion,
} from '../lib/runtimeMetadata.js';
import { createModuleLogger, rootLogger } from '../logging/logger.js';
import { initServerTelemetryAdapter } from '../observability/index.js';
import { warmCacheFromDb } from '../security/loginRateLimit.js';
import { warmUpPasswordSecurity } from '../security/passwords.js';
import { startProcedureRateLimitSweeper } from '../trpc/middleware/procedureRateLimit.js';
import { createContext } from '../trpc/context.js';
import { appRouter } from '../trpc/router.js';
import { resolveServerConfig } from './config.js';
import {
  SERVER_BODY_LIMIT_BYTES,
  SERVER_HEADERS_TIMEOUT_MS,
  SERVER_KEEP_ALIVE_TIMEOUT_MS,
  SERVER_REQUEST_TIMEOUT_MS,
  SERVER_SOCKET_TIMEOUT_MS,
} from './constants.js';
import { registerHttpPlugins } from './plugins.js';
import type { PuntovivoServer, ServerOptions } from './types.js';
import { registerWorkers } from './workers.js';

/**
 * Create and configure the Puntovivo server
 */
export async function createServer(options: ServerOptions): Promise<PuntovivoServer> {
  const { dbPath, verbose = false, migrationsFolder, appVersion = 'unknown' } = options;

  // Resolve the pre-Fastify configuration (verbose-prod guard, JWT
  // secret, Authority Node runtime + bind host/port, site_hub LAN
  // hardening, effective CORS). Owns the setActiveRuntimeConfig side
  // effect.
  const { jwtSecret, resolvedRuntime, bindHost, bindPort, effectiveCorsOrigins } =
    resolveServerConfig(options);

  // Initialize database
  const db = await initDatabase({
    dbPath,
    runMigrations: true,
    seedData: true,
    verbose,
    migrationsFolder,
    encryptionKey: options.encryptionKey,
    sqliteBusyTimeoutMs: options.sqliteBusyTimeoutMs,
  });

  // ENG-008b — prime the loginRateLimit in-memory cache from the persisted
  // `login_attempts` table so the first post-restart check hits the cache
  // instead of paying a DB round-trip. `warmCacheFromDb` is safe to call
  // against an adopted DB missing migration 0006 (no-op + warn).
  warmCacheFromDb(db);

  // ENG-166 — pre-compute the dummy Argon2 hash used by `auth.login` to
  // equalise response time on the not-found branch. Without this the
  // first not-found login attempt pays an extra 50-100 ms (a small but
  // real timing leak); warming once at boot amortises the cost.
  await warmUpPasswordSecurity();

  // ENG-166 — schedule the periodic sweep of the in-memory rate-limit
  // bucket map so a long-running Electron session (or hub) does not
  // accumulate entries indefinitely. The handle is released via the
  // server's onClose hook below so tests do not leak timers.
  const stopRateLimitSweep = startProcedureRateLimitSweeper();

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
    // ENG-040a uploads invoice photos through tRPC. The OCR service caps
    // decoded documents at 10 MB; JSON/base64 transport needs ~4/3 overhead
    // plus a small data-URL prefix allowance, otherwise Fastify rejects
    // valid OCR inputs before Zod can return the localized error code.
    bodyLimit: SERVER_BODY_LIMIT_BYTES,
    // tRPC batch URLs encode comma-separated procedure names as a single route param.
    // The default limit (100) is too short for multi-procedure batches on this router.
    // Use routerOptions per Fastify v5 API (top-level maxParamLength is deprecated).
    routerOptions: {
      maxParamLength: 1024,
    },
    // ENG-166 — only trust X-Forwarded-* headers when the server is
    // running as a site_hub (the only deployment shape that legitimately
    // sits behind a reverse proxy). On the device_local loopback the
    // renderer could otherwise inject a spoofed X-Forwarded-For and
    // dodge the IP-keyed rate-limit buckets. See docs/SECURITY.md for
    // the deployment contract.
    trustProxy: resolvedRuntime.authorityMode === 'site_hub',
  });
  app.server.keepAliveTimeout = SERVER_KEEP_ALIVE_TIMEOUT_MS;
  app.server.headersTimeout = SERVER_HEADERS_TIMEOUT_MS;
  app.server.requestTimeout = SERVER_REQUEST_TIMEOUT_MS;
  app.server.setTimeout(SERVER_SOCKET_TIMEOUT_MS);

  // ENG-135b — wire the centralized telemetry adapter (Sentry /
  // GlitchTip) when the operator provisioned PUNTOVIVO_SENTRY_DSN.
  // Without the DSN this is a single env read — the SDK is never
  // imported and the noopSink stays active. The adapter never
  // throws, so a malformed DSN can never block a boot (a telemetry
  // failure must never block a sale — same stance as ENG-020/054).
  await initServerTelemetryAdapter({ appVersion });

  // Register the HTTP plugin + security-hook stack (helmet -> cors ->
  // cookie -> jwt -> request-logger hook -> CSRF hook -> rate-limit ->
  // SSE) in the boot-critical order.
  await registerHttpPlugins(app, { effectiveCorsOrigins, jwtSecret });

  // Decorate request with database instance
  app.decorate('db', db);

  // Register tRPC
  const trpcLog = createModuleLogger('trpc');
  await app.register(fastifyTRPCPlugin, {
    prefix: '/api/trpc',
    trpcOptions: {
      router: appRouter,
      createContext,
      // ENG-179b — `path?: string | undefined` matches the trpc plugin
      // contract under `exactOptionalPropertyTypes`.
      onError({ path, error }: { path?: string | undefined; error: unknown }) {
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

  // Boot the outbox + cleanup worker daemons and wire their onClose
  // teardown (fiscal, rate-limit sweep, hardware, payment, login
  // cleanup). The periodic timers arm inside listen() below.
  const { fiscalWorker, hardwareWorker, paymentWorker, loginAttemptsCleanup } = registerWorkers(
    app,
    db,
    { stopRateLimitSweep }
  );

  const serverLog = createModuleLogger('server');
  return {
    app,
    db,
    fiscalWorker,
    hardwareWorker,
    paymentWorker,
    loginAttemptsCleanup,
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
      paymentWorker.start();
      // ENG-168 — sweep stale login_attempts rows on a 1 h cadence;
      // the boot-time `tickOnce` runs the first pass synchronously so
      // a freshly-restarted POS that accumulated rows during downtime
      // clears them immediately.
      (loginAttemptsCleanup as { start: () => void }).start();
      try {
        loginAttemptsCleanup.tickOnce();
      } catch (err) {
        serverLog.warn(
          { err: err instanceof Error ? { message: err.message } : err },
          'login_attempts cleanup boot tick failed; will retry next interval'
        );
      }
      // ENG-038c — kick the boot catch-up sweep after the timers
      // are armed so a long-offline POS reconciles missed statement
      // windows before the first regular Timer B tick fires.
      void paymentWorker.catchUpOnBoot();
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

// Type augmentations for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    db: DatabaseInstance;
  }
}
