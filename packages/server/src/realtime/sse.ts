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

import { FastifyReply, FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { createModuleLogger } from '../logging/logger.js';

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
      // Filter by tenant if specified
      if (tenantId && client.tenantId && client.tenantId !== tenantId) {
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
 * Generate a unique client ID
 */
function generateClientId(): string {
  return `sse_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Fastify plugin for SSE support
 */
const ssePluginCallback: FastifyPluginCallback = (fastify, _opts, done) => {
  const manager = new SseManager();

  async function resolveTenantId(request: FastifyRequest): Promise<string | null> {
    try {
      await request.jwtVerify();
      const payload = request.user as { tenantId?: unknown };
      return typeof payload.tenantId === 'string' ? payload.tenantId : null;
    } catch {
      return null;
    }
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
      const tenantId = await resolveTenantId(request);

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
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

      // Send heartbeat every 30 seconds to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          const heartbeat = formatSseMessage({
            event: 'heartbeat',
            data: { timestamp: new Date().toISOString() },
          });
          reply.raw.write(heartbeat);
        } catch {
          clearInterval(heartbeatInterval);
          manager.removeClient(clientId);
        }
      }, 30000);

      // Handle client disconnect
      request.raw.on('close', () => {
        clearInterval(heartbeatInterval);
        manager.removeClient(clientId);
      });

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
