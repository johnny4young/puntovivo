import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { UserRole } from '@puntovivo/shared/roles';

import { verifyAccessToken } from '../../security/authTokens.js';
import {
  isRealtimeSubscriptionStillAuthorized,
  resolveRealtimeSubscription,
} from './authorization.js';
import type { SseClient } from './contracts.js';
import { SseManager } from './manager.js';
import { generateClientId, getCorsHeaders, resolveLastEventId } from './protocol.js';

interface SsePluginOptions {
  corsOrigins?: string[];
}

export interface RealtimeIdentity {
  tenantId: string;
  role: UserRole;
}

/**
 * Resolve tenant AND role from the canonical access session on every stream
 * check. The role is part of the identity because it decides which
 * collections the stream may carry.
 *
 * A mid-shift demotion is already fatal one level down — `verifyAccessToken`
 * rejects a token whose role no longer matches the stored user — so the
 * heartbeat's role comparison below is defense in depth rather than the
 * mechanism: it keeps the stream honest even if that invariant is ever
 * relaxed to let a token outlive a role change.
 */
export async function resolveRealtimeIdentity(
  request: FastifyRequest
): Promise<RealtimeIdentity | null> {
  const payload = await verifyAccessToken(request);
  if (!payload?.tenantId || !payload.role) {
    return null;
  }
  return { tenantId: payload.tenantId, role: payload.role };
}

/** Resolve the tenant from the canonical access session on every stream check. */
export async function resolveRealtimeTenantId(request: FastifyRequest): Promise<string | null> {
  const identity = await resolveRealtimeIdentity(request);
  return identity?.tenantId ?? null;
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
      const requested = request.query.collections?.split(',').map(c => c.trim()) || [];
      const identity = await resolveRealtimeIdentity(request);
      const corsHeaders = getCorsHeaders(request.headers.origin, allowedOrigins);

      if (!identity) {
        return reply
          .code(401)
          .headers(corsHeaders)
          .send({ error: 'Realtime subscription requires authentication' });
      }

      const { tenantId, role } = identity;
      // Authorize BEFORE any stream header is written: a rejected
      // subscription must look like an ordinary JSON error, not a stream
      // that opens and then dies.
      const collections = await resolveRealtimeSubscription({
        db: fastify.db,
        tenantId,
        role,
        requested,
      });

      if (collections.length === 0) {
        return reply
          .code(403)
          .headers(corsHeaders)
          .send({ error: 'Realtime subscription is not authorized for this role' });
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
        void resolveRealtimeIdentity(request)
          .then(async activeIdentity => {
            if (
              !activeIdentity ||
              activeIdentity.tenantId !== tenantId ||
              activeIdentity.role !== role
            ) {
              endConnection();
              return;
            }
            if (
              !(await isRealtimeSubscriptionStillAuthorized({
                db: fastify.db,
                tenantId,
                role,
                granted: collections,
              }))
            ) {
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
