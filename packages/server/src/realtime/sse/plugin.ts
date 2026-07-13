import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

import {
  REALTIME_COOKIE_NAME,
  REALTIME_TOKEN_REFRESH_NEEDED_INTERVAL_MS,
  verifyRealtimeToken,
} from '../../security/authTokens.js';
import type { SseClient } from './contracts.js';
import { SseManager } from './manager.js';
import { generateClientId, getCorsHeaders, resolveLastEventId } from './protocol.js';

interface SsePluginOptions {
  corsOrigins?: string[];
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
    Querystring: { collections?: string; lastEventId?: string };
  }>('/api/realtime/subscribe', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          collections: { type: 'string' },
          lastEventId: { type: 'string' },
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

      // Add the client before writes so connected/replay traffic shares the
      // same backpressure path as ordinary broadcasts.
      const client: SseClient = {
        id: clientId,
        reply,
        collections,
        tenantId,
        connectedAt: new Date(),
      };
      manager.addClient(client);

      manager.sendTo(clientId, {
        event: 'connected',
        data: {
          clientId,
          collections,
          timestamp: new Date().toISOString(),
        },
      });
      const lastEventId = resolveLastEventId(
        request.headers['last-event-id'],
        request.query.lastEventId
      );
      manager.replayTo(clientId, lastEventId);

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
        if (
          !manager.sendTo(clientId, {
            event: 'heartbeat',
            data: { timestamp: new Date().toISOString() },
          })
        ) {
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
        if (
          !manager.sendTo(clientId, {
            event: 'token-refresh-needed',
            data: { timestamp: new Date().toISOString() },
          })
        ) {
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
