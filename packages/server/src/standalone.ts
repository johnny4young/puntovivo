/**
 * Standalone Server Entry Point
 *
 * Run the Puntovivo server as a standalone process (for development or web deployment).
 *
 * Usage:
 *   npm run dev        - Development with hot reload
 *   npm run start      - Production
 *
 * Environment variables:
 *   PUNTOVIVO_AUTHORITY_MODE   - device_local | site_hub | hub_client (default: device_local; ENG-072)
 *   PUNTOVIVO_BIND_HOST        - Bind host (preferred; falls back to HOST). Default: 127.0.0.1
 *   PUNTOVIVO_BIND_PORT        - Bind port (preferred; falls back to PORT). Default: 8090
 *   PUNTOVIVO_HUB_URL          - Hub URL when authorityMode=hub_client (ENG-074 plumbing)
 *   PUNTOVIVO_SITE_ID          - Operator-supplied site identifier
 *   PUNTOVIVO_DEVICE_ID        - Operator-supplied device identifier
 *   PUNTOVIVO_ALLOWED_LAN_ORIGINS - CSV of CORS origins for site_hub LAN bind (ENG-073)
 *   PORT               - Legacy alias for PUNTOVIVO_BIND_PORT (default: 8090)
 *   HOST               - Legacy alias for PUNTOVIVO_BIND_HOST (default: 127.0.0.1)
 *   DATABASE_URL       - SQLite database path (default: ./data/local.db)
 *   JWT_SECRET         - JWT signing secret (auto-generated if not set)
 *   PUNTOVIVO_SQLITE_BUSY_TIMEOUT_MS - Optional SQLite writer-lock wait override
 *   VERBOSE            - Enable verbose logging (default: false)
 *   ANTHROPIC_API_KEY  - Required for AI features (ENG-030 onwards). See
 *                        `.env.example` for the full list.
 *
 * `.env` (at repo root) is auto-loaded via `./loadEnv.ts` — that import
 * MUST stay first so its side effect runs before any module that
 * reads `process.env.*` at evaluation time.
 *
 * @module standalone
 */

// MUST be the first import: side-effect module that runs
// `process.loadEnvFile()` for the standard `.env` locations before
// any downstream module evaluates and reads env vars.
import './loadEnv.js';

import { createServer, createModuleLogger } from './index.js';
import { resolveRuntimeConfig } from './config/runtime.js';
import { createGracefulShutdownHandler } from './lifecycle/gracefulShutdown.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = createModuleLogger('standalone');

/**
 * Operator-facing banner text. Kept on `process.stdout.write` instead of
 * the pino stream on purpose — it is one-shot CLI UX, not structured
 * telemetry, so turning it into NDJSON would destroy readability at the
 * command line and does not help any log aggregator downstream.
 */
function banner(line: string = ''): void {
  process.stdout.write(`${line}\n`);
}

function parseOptionalBusyTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 60_000) {
    throw new Error('PUNTOVIVO_SQLITE_BUSY_TIMEOUT_MS must be an integer from 0 to 60000');
  }
  return parsed;
}

async function main(): Promise<void> {
  // ENG-072 — Resolve the Authority Node runtime config first. The
  // resolver throws on invalid env (bad mode, bad port) so a
  // misconfigured boot dies here with an actionable message instead
  // of silently sliding into defaults.
  const runtime = resolveRuntimeConfig({ env: process.env });
  const dbPath = process.env.DATABASE_URL || join(__dirname, '..', 'data', 'local.db');
  const jwtSecret = process.env.JWT_SECRET;
  const verbose = process.env.VERBOSE === 'true' || process.env.NODE_ENV === 'development';
  // ENG-167 — optional SQLCipher key. Electron resolves it through
  // `safeStorage`; the standalone binary accepts it via env so the
  // standalone dev workflow (`npm run dev:server`) can exercise the
  // encrypted code path without booting Electron. Omitted by default,
  // which keeps the legacy cleartext dev DB working until ENG-167b
  // ships the one-shot migration UX.
  const encryptionKey = process.env.PUNTOVIVO_DB_KEY;
  const sqliteBusyTimeoutMs = parseOptionalBusyTimeoutMs(
    process.env.PUNTOVIVO_SQLITE_BUSY_TIMEOUT_MS
  );
  process.env.PUNTOVIVO_RUNTIME_ENV ??= process.env.NODE_ENV === 'production' ? 'production' : 'development';

  banner('==========================================');
  banner('  Puntovivo Server - Standalone Mode');
  banner('==========================================');
  banner();

  try {
    const server = await createServer({
      dbPath,
      port: runtime.bindPort,
      host: runtime.bindHost,
      jwtSecret,
      verbose,
      runtime,
      // ENG-073 — Node populates `npm_package_version` when launched
      // via `npm run start` / `npm run dev`. Falls through to
      // `'unknown'` inside createServer when this is undefined (e.g.
      // a direct `node dist/standalone.js` invocation).
      appVersion: process.env.npm_package_version,
      encryptionKey,
      sqliteBusyTimeoutMs,
    });

    const shutdown = createGracefulShutdownHandler({
      close: server.close,
      log,
      exit: code => process.exit(code),
    });

    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
    process.on('unhandledRejection', reason => {
      log.fatal({ err: reason }, 'unhandled rejection');
      void shutdown('unhandledRejection');
    });
    process.on('uncaughtException', err => {
      log.fatal({ err }, 'uncaught exception');
      void shutdown('uncaughtException');
    });

    // Start server
    const address = await server.listen();

    banner();
    banner(`[Server] ✓ Server started at ${address}`);
    banner(`[Server] ✓ Database: ${dbPath}`);
    banner(`[Server] ✓ Authority mode: ${runtime.authorityMode}`);
    banner();
    banner('  API Surfaces:');
    banner(`  - tRPC:        ${address}/api/trpc`);
    banner(`  - Health:      ${address}/api/health (compatibility endpoint)`);
    banner(`  - Realtime:    ${address}/api/realtime/subscribe`);
    banner();
    banner('  Default admin account:');
    banner('  - Email: admin@localhost');
    banner(
      process.env.NODE_ENV === 'production'
        ? '  - Password: (generated on first run, shown once in seed output)'
        : '  - Password: Admin123!Dev (or PUNTOVIVO_DEV_ADMIN_PASSWORD if set before first seed)'
    );
    banner('  - See docs/LOGIN_GUIDE.md for details');
    banner();
    banner('  Press Ctrl+C to stop');
    banner('==========================================');
  } catch (err) {
    log.fatal({ err }, 'server failed to start');
    process.exit(1);
  }
}

main();
