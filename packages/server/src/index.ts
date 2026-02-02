/**
 * Open Yojob Server - Main Entry Point
 *
 * Fastify server with Drizzle ORM and SQLite for the POS system.
 * Can run embedded in Electron or standalone.
 *
 * @module server
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { initDatabase, closeDatabase, type DatabaseInstance } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { collectionsRoutes } from './routes/collections.js';
import { syncRoutes } from './routes/sync.js';
import { ssePlugin } from './realtime/sse.js';

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
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
            },
          },
        }
      : false,
  });

  // Register CORS
  await app.register(cors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
    credentials: true,
  });

  // Register JWT
  await app.register(jwt, {
    secret: jwtSecret,
    sign: {
      expiresIn: '7d',
    },
  });

  // Register SSE plugin
  await app.register(ssePlugin);

  // Decorate request with database instance
  app.decorate('db', db);

  // Add tenant context to request
  app.decorateRequest('tenantId', null);
  app.addHook('preHandler', async request => {
    // Extract tenant ID from header or JWT token
    const tenantIdHeader = request.headers['x-tenant-id'];
    if (typeof tenantIdHeader === 'string') {
      request.tenantId = tenantIdHeader;
    }
  });

  // Health check endpoint
  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Register routes
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(collectionsRoutes, { prefix: '/api/collections' });
  await app.register(syncRoutes, { prefix: '/api/sync' });

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
 * Generate a random JWT secret
 */
function generateSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Type augmentations for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    db: DatabaseInstance;
  }
  interface FastifyRequest {
    tenantId: string | null;
  }
}

// Re-export types and utilities
export * from './db/schema.js';
export { getDatabase, type DatabaseInstance } from './db/index.js';
export { SseManager, type SseClient } from './realtime/sse.js';
