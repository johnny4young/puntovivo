/**
 * Server public type surface.
 *
 * `ServerOptions` (the createServer input contract) and `PuntovivoServer`
 * (the handle it returns). Kept in a leaf so create-server, standalone,
 * and the Electron main can reference them without importing the
 * lifecycle module.
 *
 * @module server/types
 */

import type { FastifyInstance } from 'fastify';
import type { RuntimeConfig } from '../config/runtime.js';
import type { DatabaseInstance } from '../db/index.js';

export interface ServerOptions {
  // ENG-179b — explicit `| undefined` on every optional field so
  // callers can pass `field: process.env.X` (where the env-var read is
  // `string | undefined`) without violating `exactOptionalPropertyTypes`.
  /** Path to the SQLite database file */
  dbPath: string;
  /** Port to listen on (default: 8090) */
  port?: number | undefined;
  /** Host to bind to (default: '127.0.0.1') */
  host?: string | undefined;
  /** JWT secret for authentication (default: auto-generated) */
  jwtSecret?: string | undefined;
  /** Enable verbose logging (default: false) */
  verbose?: boolean | undefined;
  /** CORS origins (default: ['http://localhost:3000', 'http://localhost:5173']) */
  corsOrigins?: string[] | undefined;
  /**
   * Override the folder that holds the generated Drizzle SQL migrations.
   * Defaults to the `migrations/` directory next to the compiled server
   * module. Packaged Electron builds pass `process.resourcesPath/migrations`
   * because the `.sql` files ship alongside the bundle via Forge
   * `extraResource`, not inside the Vite output.
   */
  migrationsFolder?: string | undefined;
  /**
   * ENG-072 — resolved Authority Node runtime config. Standalone and
   * Electron callers resolve this via `resolveRuntimeConfig` and pass
   * it in. When omitted (typical in tests), `createServer` synthesizes
   * a `device_local` runtime from `host`/`port` so existing tests stay
   * unchanged.
   */
  runtime?: RuntimeConfig | undefined;
  /**
   * ENG-073 — installed app version surfaced on `/api/health`.
   * Standalone reads from `process.env.npm_package_version`; Electron
   * passes `app.getVersion()`. Defaults to `'unknown'` when omitted
   * so tests do not need to wire it.
   */
  appVersion?: string | undefined;
  /**
   * ENG-167 — 64-char hex SQLCipher key forwarded to `initDatabase`.
   * Electron resolves it through `safeStorage` (see
   * `apps/desktop/src/main/db-key-store.ts`); the standalone server
   * accepts `process.env.PUNTOVIVO_DB_KEY` as a parity escape hatch.
   * Tests omit it (in-memory and unkeyed file fixtures both opt out).
   * See `DatabaseOptions.encryptionKey` for the wire format.
   */
  encryptionKey?: string | undefined;
  /**
   * Optional override for SQLite's `busy_timeout` PRAGMA. The default
   * remains owned by `initDatabase`; standalone/E2E callers can raise it
   * when many independent processes intentionally contend for the same
   * local DB.
   */
  sqliteBusyTimeoutMs?: number | undefined;
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
  fiscalWorker: import('../services/fiscal/fiscal-worker.js').FiscalWorker;
  /**
   * ENG-062 — Hardware worker daemon registered to drain
   * `hardware_outbox`. Mirrors the fiscal worker; tests inject a
   * fast retry policy via `createHardwareWorker` directly when they
   * need to assert dead-letter transitions in tight loops.
   */
  hardwareWorker: import('../services/peripherals/hardware-worker.js').HardwareWorker;
  /**
   * ENG-038c — Payment worker daemon registered to drain
   * `payment_outbox` (housekeeping today; live charge dispatch lands
   * with rail-specific API clients) and run statement-import +
   * reconciliation. Tests pass a stub `fetchStatement` via
   * `createPaymentWorker` to drive deterministic imports.
   */
  paymentWorker: import('../services/payments/payment-worker.js').PaymentWorker;
  /**
   * ENG-168 — login_attempts cleanup worker. Sweeps rate-limit
   * buckets whose `expires_at` is older than 24 h on a 1 h cadence.
   * Tests call `.tickOnce()` to assert delete counts without waiting
   * for the periodic interval.
   */
  loginAttemptsCleanup: import('../services/cleanup/loginAttemptsCleanup.js').LoginAttemptsCleanupHandle;
  /** Start listening for requests */
  listen: () => Promise<string>;
  /** Stop the server and close database */
  close: () => Promise<void>;
  /** Get the server URL */
  getUrl: () => string;
}
