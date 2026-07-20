/**
 * Puntovivo Server - Main Entry Point (barrel)
 *
 * Fastify server with Drizzle ORM and SQLite for the POS system.
 * Can run embedded in Electron or standalone.
 *
 * The server implementation lives in focused modules under `server/`
 * ( Slice 18):
 * - `create-server.ts` — the `createServer` lifecycle orchestrator
 * - `config.ts` — pre-Fastify config resolution (runtime, JWT, site_hub)
 * - `plugins.ts` — the HTTP plugin + security-hook stack (ordered)
 * - `workers.ts` — the outbox/cleanup worker registration
 * - `types.ts` / `constants.ts` / `jwt-secret.ts` / `request-logger.ts`
 *
 * This barrel preserves the exact public surface so all importers + the
 * `@puntovivo/server` package entry resolve through `index.js` unchanged.
 *
 * @module server
 */

export { createServer } from './server/create-server.js';
export type { PuntovivoServer, ServerOptions } from './server/types.js';
export {
  SERVER_BODY_LIMIT_BYTES,
  SERVER_HEADERS_TIMEOUT_MS,
  SERVER_KEEP_ALIVE_TIMEOUT_MS,
  SERVER_REQUEST_TIMEOUT_MS,
  SERVER_SOCKET_TIMEOUT_MS,
} from './server/constants.js';
export { buildRequestScopedLoggerBindings } from './server/request-logger.js';

// Re-export types and utilities
export * from './db/schema.js';
// The desktop main queries the embedded DB with the schema tables above,
// so it must use Drizzle operators from the SAME drizzle-orm instance
// that typed those columns. Importing 'drizzle-orm' directly in
// apps/desktop is a phantom dependency (it is not in that package.json)
// that can resolve to a different module identity (root hoist vs the
// .pnpm peer instance) and break its typecheck. Consume these instead.
export { and, eq, inArray, sql } from 'drizzle-orm';
export { getDatabase, type DatabaseInstance } from './db/index.js';
// the embedded Electron main records restore-drill evidence in
// the same immutable audit table as server-side sensitive operations.
export { writeAuditLog, type WriteAuditLogArgs } from './services/audit-logs.js';
export { SseManager, type SseClient } from './realtime/sse.js';
export type { AppRouter } from './trpc/router.js';
// `desktopSession` (apps/desktop/src/main) imports this to
// validate the renderer's access token without a FastifyRequest.
export { verifyTokenWithServer, type AuthTokenPayload } from './security/authTokens.js';
// the Electron main imports createModuleLogger via this
// barrel so app-level logs from both the embedded server and the
// desktop shell flow through the same pino instance.
export { createModuleLogger, rootLogger, type PuntovivoLogger } from './logging/logger.js';
// Authority Node runtime config. The Electron main process
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
// the Electron main installs process crash handlers
// (apps/desktop/src/main/crash-telemetry.ts) and forwards through
// these: captureProcessCrash invokes the active telemetry sink
// directly (tenant-less app diagnostics, redacted, DSN-gated), and
// flushServerTelemetry drains the SDK buffer before app.exit(1).
export { captureProcessCrash, flushServerTelemetry } from './observability/index.js';
// ESC/POS transport resolver. The Electron main imports
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
