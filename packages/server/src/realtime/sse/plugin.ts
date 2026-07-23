import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { verifyAccessToken } from '../../security/authTokens.js';
import type { SseClient } from './contracts.js';
import { SseManager } from './manager.js';
import { generateClientId, getCorsHeaders, resolveLastEventId } from './protocol.js';

interface SsePluginOptions {
  corsOrigins?: string[];
}

/** Resolve the tenant from the canonical access session on every stream check. */
export async function resolveRealtimeTenantId(request: FastifyRequest): Promise<string | null> {
  const payload = await verifyAccessToken(request);
  return payload?.tenantId ?? null;
}

/**
 * Fastify plugin for SSE support
 */
const ssePluginCallback: FastifyPluginCallback<SsePluginOptions> = (fastify, opts, done) => {
  const manager = new SseManager();
  const allowedOrigins = opts.corsOrigins ?? [];

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
          collections: {
            type: 'string',
            maxLength: 256,
            pattern: '^[a-z][a-z0-9_-]*(,[a-z][a-z0-9_-]*)*$',
          },
          lastEventId: { type: 'string', maxLength: 20, pattern: '^\\d+$' },
        },
      },
    },
    handler: async (request, reply) => {
      const clientId = generateClientId();
      const collections = request.query.collections?.split(',').map(c => c.trim()) || [];
      const tenantId = await resolveRealtimeTenantId(request);
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
      let authCheckInFlight = false;

      const cleanupConnection = () => {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        manager.removeClient(clientId);
      };
      const endConnection = () => {
        cleanupConnection();
        try {
          reply.raw.end();
        } catch {
          // The peer may already have closed while auth was being checked.
        }
      };

      // Re-verify the same Bearer session before every heartbeat. Access-token
      // expiry, logout, device revocation, user deactivation, or tenant
      // deactivation all close the stream; the client reconnect path then uses
      // the canonical refresh flow or routes back to login.
      heartbeatInterval = setInterval(() => {
        if (authCheckInFlight) return;
        authCheckInFlight = true;
        void resolveRealtimeTenantId(request)
          .then(activeTenantId => {
            if (activeTenantId !== tenantId) {
              endConnection();
              return;
            }
            if (
              !manager.sendTo(clientId, {
                event: 'heartbeat',
                data: { timestamp: new Date().toISOString() },
              })
            ) {
              cleanupConnection();
            }
          })
          .catch(() => {
            endConnection();
          })
          .finally(() => {
            authCheckInFlight = false;
          });
      }, 30000);

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
