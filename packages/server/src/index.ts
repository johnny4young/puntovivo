/**
 * Open Yojob Server - Main Entry Point
 *
 * Fastify server with Drizzle ORM and SQLite for the POS system.
 * Can run embedded in Electron or standalone.
 *
 * @module server
 */

import { randomBytes } from 'crypto';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { initDatabase, closeDatabase, type DatabaseInstance } from './db/index.js';
import { ssePlugin } from './realtime/sse.js';
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
}

export interface OpenYojobServer {
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
 * Create and configure the Open Yojob server
 */
export async function createServer(options: ServerOptions): Promise<OpenYojobServer> {
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
  } = options;

  // Initialize database
  const db = await initDatabase({
    dbPath,
    runMigrations: true,
    seedData: true,
    verbose,
  });

  // Create Fastify instance
  const app = Fastify({
    logger: verbose
      ? {
          level: 'info',
          // Skip pino-pretty in bundled/electron environment (causes module resolution issues)
          // Use basic logging instead
        }
      : false,
  });

  // Register CORS
  await app.register(cors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-site-id'],
    credentials: true,
  });

  // Register JWT
  await app.register(jwt, {
    secret: jwtSecret,
    sign: {
      expiresIn: '7d',
    },
  });

  // Register rate limiting (must be registered before routes that use it)
  const rateLimit = await import('@fastify/rate-limit');
  await app.register(rateLimit.default, {
    global: false, // Don't apply to all routes
    max: 100, // Default max for other routes
    timeWindow: '1 minute',
  });

  // Register SSE plugin
  await app.register(ssePlugin);

  // Decorate request with database instance
  app.decorate('db', db);

  // Register tRPC
  await app.register(fastifyTRPCPlugin, {
    prefix: '/api/trpc',
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ path, error }: { path?: string; error: any }) {
        if (verbose) {
          console.error(`[tRPC] Error in ${path ?? 'unknown'}:`, error);
        }
      },
    },
  });

  // Keep the legacy health endpoint as a compatibility surface while
  // `health.check` on `/api/trpc` remains the canonical health procedure.
  app.get('/api/health', async (_request, reply) => {
    reply.header('x-open-yojob-compat', 'legacy-health');
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      compatibility: true,
      canonicalProcedure: 'health.check',
      canonicalPath: '/api/trpc/health.check',
    };
  });

  let serverUrl = `http://${host}:${port}`;

  return {
    app,
    db,
    listen: async () => {
      const address = await app.listen({ port, host });
      serverUrl = address;
      if (verbose) {
        console.log(`[Server] Listening at ${address}`);
      }
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
