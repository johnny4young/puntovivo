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
 *   PORT               - Server port (default: 8090)
 *   HOST               - Server host (default: 127.0.0.1)
 *   DATABASE_URL       - SQLite database path (default: ./data/local.db)
 *   JWT_SECRET         - JWT signing secret (auto-generated if not set)
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

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT || '8090', 10);
  const host = process.env.HOST || '127.0.0.1';
  const dbPath = process.env.DATABASE_URL || join(__dirname, '..', 'data', 'local.db');
  const jwtSecret = process.env.JWT_SECRET;
  const verbose = process.env.VERBOSE === 'true' || process.env.NODE_ENV === 'development';
  process.env.PUNTOVIVO_RUNTIME_ENV ??= process.env.NODE_ENV === 'production' ? 'production' : 'development';

  banner('==========================================');
  banner('  Puntovivo Server - Standalone Mode');
  banner('==========================================');
  banner();

  try {
    const server = await createServer({
      dbPath,
      port,
      host,
      jwtSecret,
      verbose,
    });

    // Handle graceful shutdown. Signals are operational events, so they
    // flow through the structured log stream.
    const shutdown = async (signal: string) => {
      log.info({ signal }, 'shutdown requested');
      await server.close();
      log.info('shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Start server
    const address = await server.listen();

    banner();
    banner(`[Server] ✓ Server started at ${address}`);
    banner(`[Server] ✓ Database: ${dbPath}`);
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
