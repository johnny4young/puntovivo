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
 *   PORT          - Server port (default: 8090)
 *   HOST          - Server host (default: 127.0.0.1)
 *   DATABASE_URL  - SQLite database path (default: ./data/local.db)
 *   JWT_SECRET    - JWT signing secret (auto-generated if not set)
 *   VERBOSE       - Enable verbose logging (default: false)
 *
 * @module standalone
 */

import { createServer } from './index.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT || '8090', 10);
  const host = process.env.HOST || '127.0.0.1';
  const dbPath = process.env.DATABASE_URL || join(__dirname, '..', 'data', 'local.db');
  const jwtSecret = process.env.JWT_SECRET;
  const verbose = process.env.VERBOSE === 'true' || process.env.NODE_ENV === 'development';
  process.env.PUNTOVIVO_RUNTIME_ENV ??= process.env.NODE_ENV === 'production' ? 'production' : 'development';

  console.log('==========================================');
  console.log('  Puntovivo Server - Standalone Mode');
  console.log('==========================================');
  console.log();

  try {
    const server = await createServer({
      dbPath,
      port,
      host,
      jwtSecret,
      verbose,
    });

    // Handle graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n[Server] Received ${signal}, shutting down...`);
      await server.close();
      console.log('[Server] Goodbye!');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Start server
    const address = await server.listen();

    console.log();
    console.log(`[Server] ✓ Server started at ${address}`);
    console.log(`[Server] ✓ Database: ${dbPath}`);
    console.log();
    console.log('  API Surfaces:');
    console.log(`  - tRPC:        ${address}/api/trpc`);
    console.log(`  - Health:      ${address}/api/health (compatibility endpoint)`);
    console.log(`  - Realtime:    ${address}/api/realtime/subscribe`);
    console.log();
    console.log('  Default admin account:');
    console.log('  - Email: admin@localhost');
    console.log(
      process.env.NODE_ENV === 'production'
        ? '  - Password: (generated on first run, shown once in seed output)'
        : '  - Password: Admin123!Dev (or PUNTOVIVO_DEV_ADMIN_PASSWORD if set before first seed)'
    );
    console.log('  - See docs/LOGIN_GUIDE.md for details');
    console.log();
    console.log('  Press Ctrl+C to stop');
    console.log('==========================================');
  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
}

main();
