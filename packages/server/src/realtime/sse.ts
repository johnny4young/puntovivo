/**
 * Server-Sent Events (SSE) Module
 *
 * Provides real-time updates to connected clients using SSE.
 * This is a simpler alternative to WebSockets for one-way server-to-client communication.
 *
 * Features:
 * - Client subscription management
 * - Collection-filtered subscriptions
 * - Broadcast events to all clients or filtered by collection
 *
 * Usage:
 * - Clients subscribe via GET /api/realtime/subscribe?collections=products,sales
 * - Server broadcasts via app.sse.broadcast('products.create', data)
 *
 * @module realtime/sse
 */

import { randomBytes } from 'node:crypto';
import { FastifyReply, FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { createModuleLogger } from '../logging/logger.js';
import {
  REALTIME_COOKIE_NAME,
  REALTIME_TOKEN_REFRESH_NEEDED_INTERVAL_MS,
  verifyRealtimeToken,
} from '../security/authTokens.js';

const sseLog = createModuleLogger('sse');

/**
 * SSE Client connection
 */
export interface SseClient {
  id: string;
  reply: FastifyReply;
  collections: string[];
  tenantId: string | null;
  connectedAt: Date;
}

/**
 * SSE Event
 */
export interface SseEvent {
  event: string;
  data: unknown;
  id?: string;
  retry?: number;
}

interface SsePluginOptions {
  corsOrigins?: string[];
}

/**
 * SSE Manager - Handles client connections and broadcasts
 */
export class SseManager {
  private clients: Map<string, SseClient> = new Map();
  private eventId = 0;

  /**
   * Add a new client connection
   */
  addClient(client: SseClient): void {
    this.clients.set(client.id, client);
    sseLog.debug({ clientId: client.id, totalClients: this.clients.size }, 'client connected');
  }

  /**
   * Remove a client connection
   */
  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    sseLog.debug({ clientId, totalClients: this.clients.size }, 'client disconnected');
  }

  /**
   * Get all connected clients
   */
  getClients(): SseClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Broadcast an event to all subscribed clients
   *
   * @param eventName - Event name (e.g., 'products.create', 'sales.update')
   * @param data - Event data to send
   * @param tenantId - Optional tenant ID to filter recipients
   */
  broadcast(eventName: string, data: unknown, tenantId?: string): void {
    const collection = eventName.split('.')[0];
    const eventId = ++this.eventId;

    const message = formatSseMessage({
      event: eventName,
      data,
      id: String(eventId),
    });

    let sentCount = 0;

    for (const client of this.clients.values()) {
      // Tenant-scoped events must never fan out to anonymous clients.
      if (tenantId && client.tenantId !== tenantId) {
        continue;
      }

      // Filter by collection subscription
      if (
        client.collections.length > 0 &&
        !client.collections.includes(collection) &&
        !client.collections.includes('*')
      ) {
        continue;
      }

      try {
        client.reply.raw.write(message);
        sentCount++;
      } catch {
        // Client probably disconnected
        this.removeClient(client.id);
      }
    }

    if (sentCount > 0) {
      sseLog.debug({ eventName, sentCount }, 'broadcast delivered');
    }
  }

  /**
   * Send an event to a specific client
   */
  sendTo(clientId: string, event: SseEvent): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    try {
      const message = formatSseMessage(event);
      client.reply.raw.write(message);
      return true;
    } catch {
      this.removeClient(clientId);
      return false;
    }
  }
}

/**
 * Format an SSE message according to the spec
 */
function formatSseMessage(event: SseEvent): string {
  let message = '';

  if (event.id) {
    message += `id: ${event.id}\n`;
  }

  if (event.event) {
    message += `event: ${event.event}\n`;
  }

  if (event.retry) {
    message += `retry: ${event.retry}\n`;
  }

  const dataStr = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);

  // Split data by newlines for proper SSE format
  const lines = dataStr.split('\n');
  for (const line of lines) {
    message += `data: ${line}\n`;
  }

  message += '\n';
  return message;
}

/**
 * Generate a unique client ID using crypto-strong entropy (ENG-166).
 *
 * Replaces the legacy `Date.now()` + `Math.random()` recipe — both
 * components were predictable enough for an attacker who could guess a
 * recent connection to attempt channel hijack. `randomBytes(16)` yields
 * 128 bits of unguessable entropy, encoded as 32 hex chars.
 */
export function generateClientId(): string {
  return `sse_${randomBytes(16).toString('hex')}`;
}

function getCorsHeaders(
  originHeader: string | undefined,
  allowedOrigins: readonly string[]
): Record<string, string> {
  if (!originHeader || !allowedOrigins.includes(originHeader)) {
    return {};
  }
  return {
    'Access-Control-Allow-Origin': originHeader,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

/**
 * Fastify plugin for SSE support
 */
const ssePluginCallback: FastifyPluginCallback<SsePluginOptions> = (fastify, opts, done) => {
  const manager = new SseManager();
  const allowedOrigins = opts.corsOrigins ?? [];

  async function resolveTenantId(requestCookie: string | undefined): Promise<string | null> {
    const payload = await verifyRealtimeToken(fastify, requestCookie ?? null);
    return payload?.tenantId ?? null;
  }

  // Decorate fastify instance with SSE manager
  fastify.decorate('sse', manager);

  // SSE subscribe endpoint
  fastify.get<{
    Querystring: { collections?: string };
  }>('/api/realtime/subscribe', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          collections: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const clientId = generateClientId();
      const collections = request.query.collections?.split(',').map(c => c.trim()) || [];
      const tenantId = await resolveTenantId(request.cookies[REALTIME_COOKIE_NAME]);
      const corsHeaders = getCorsHeaders(request.headers.origin, allowedOrigins);

      if (!tenantId) {
        return reply
          .code(401)
          .headers(corsHeaders)
          .send({ error: 'Realtime subscription requires authentication' });
      }

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
        ...corsHeaders,
      });

      // Send initial connection message
      const connectMessage = formatSseMessage({
        event: 'connected',
        data: {
          clientId,
          collections,
          timestamp: new Date().toISOString(),
        },
      });
      reply.raw.write(connectMessage);

      // Add client to manager
      const client: SseClient = {
        id: clientId,
        reply,
        collections,
        tenantId,
        connectedAt: new Date(),
      };
      manager.addClient(client);

      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
      let tokenRefreshInterval: ReturnType<typeof setInterval> | null = null;

      const cleanupConnection = () => {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        if (tokenRefreshInterval) {
          clearInterval(tokenRefreshInterval);
          tokenRefreshInterval = null;
        }
        manager.removeClient(clientId);
      };

      // Send heartbeat every 30 seconds to keep connection alive
      heartbeatInterval = setInterval(() => {
        try {
          const heartbeat = formatSseMessage({
            event: 'heartbeat',
            data: { timestamp: new Date().toISOString() },
          });
          reply.raw.write(heartbeat);
        } catch {
          cleanupConnection();
        }
      }, 30000);

      // ENG-168 — emit `token-refresh-needed` on a 10-minute cadence so
      // the client can mint a fresh realtime cookie before the 15-minute
      // TTL elapses. The client listens for this event and calls
      // `auth.realtimeToken.mutate()` without dropping the SSE socket —
      // the cookie is replaced on the same origin and the next
      // reconnect (if it ever happens) already carries the fresh value.
      tokenRefreshInterval = setInterval(() => {
        try {
          const refresh = formatSseMessage({
            event: 'token-refresh-needed',
            data: { timestamp: new Date().toISOString() },
          });
          reply.raw.write(refresh);
        } catch {
          cleanupConnection();
        }
      }, REALTIME_TOKEN_REFRESH_NEEDED_INTERVAL_MS);

      // Handle client disconnect
      request.raw.on('close', cleanupConnection);

      // Keep connection open (don't call reply.send())
      // The response is managed manually via reply.raw
    },
  });

  // SSE status endpoint
  fastify.get('/api/realtime/status', async () => {
    return {
      clients: manager.getClientCount(),
      timestamp: new Date().toISOString(),
    };
  });

  done();
};

export const ssePlugin = fp(ssePluginCallback, {
  name: 'sse',
  fastify: '5.x',
});

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    sse: SseManager;
  }
}
