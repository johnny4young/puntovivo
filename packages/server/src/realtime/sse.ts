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
 * - Per-tenant replay buffers for reconnecting clients
 * - Bounded queues for slow-consumer backpressure
 *
 * Usage:
 * - Clients subscribe via GET /api/realtime/subscribe?collections=products,sales
 * - Server broadcasts via app.sse.broadcast('products.create', data, tenantId)
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
export const SSE_REPLAY_LIMIT = 500;
export const SSE_CLIENT_QUEUE_LIMIT_BYTES = 256 * 1024;
export const SSE_REPLAY_GAP_EVENT = 'realtime.replay_gap';

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

interface BufferedSseEvent {
  id: string;
  collection: string;
  message: string;
}

interface SseClientState {
  client: SseClient;
  pendingMessages: string[];
  pendingBytes: number;
  waitingForDrain: boolean;
  drainListener: (() => void) | null;
}

export interface SseReplayResult {
  replayed: number;
  gap: boolean;
  reason?: 'cursor-invalid' | 'cursor-ahead' | 'history-evicted' | 'history-unavailable';
}

/**
 * SSE Manager - Handles client connections and broadcasts
 */
export class SseManager {
  private clients: Map<string, SseClientState> = new Map();
  private eventIdsByTenant: Map<string, number> = new Map();
  private replayByTenant: Map<string, BufferedSseEvent[]> = new Map();

  /**
   * Add a new client connection
   */
  addClient(client: SseClient): void {
    this.clients.set(client.id, {
      client,
      pendingMessages: [],
      pendingBytes: 0,
      waitingForDrain: false,
      drainListener: null,
    });
    sseLog.debug({ clientId: client.id, totalClients: this.clients.size }, 'client connected');
  }

  /**
   * Remove a client connection
   */
  removeClient(clientId: string): void {
    const state = this.clients.get(clientId);
    if (state?.drainListener && typeof state.client.reply.raw.off === 'function') {
      state.client.reply.raw.off('drain', state.drainListener);
    }
    this.clients.delete(clientId);
    sseLog.debug({ clientId, totalClients: this.clients.size }, 'client disconnected');
  }

  /**
   * Get all connected clients
   */
  getClients(): SseClient[] {
    return Array.from(this.clients.values(), state => state.client);
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
   * @param tenantId - Tenant ID that owns the event and its replay history
   */
  broadcast(eventName: string, data: unknown, tenantId: string): void {
    // String.prototype.split always returns a non-empty array (even an
    // empty input yields ['']), so the first element is guaranteed to
    // be a string. The `?? eventName` is a no-op defensive fallback that
    // satisfies `noUncheckedIndexedAccess` without an assertion.
    const collection = eventName.split('.')[0] ?? eventName;
    const eventId = (this.eventIdsByTenant.get(tenantId) ?? 0) + 1;
    this.eventIdsByTenant.set(tenantId, eventId);
    const event: SseEvent = {
      event: eventName,
      data,
      id: String(eventId),
    };
    const message = formatSseMessage(event);
    this.appendReplayEvent(tenantId, {
      id: event.id ?? String(eventId),
      collection,
      message,
    });

    let sentCount = 0;

    for (const state of this.clients.values()) {
      const { client } = state;
      if (client.tenantId !== tenantId) {
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

      if (this.writeToClient(state, message)) {
        sentCount++;
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
    const state = this.clients.get(clientId);
    return state ? this.writeToClient(state, formatSseMessage(event)) : false;
  }

  /** Replay buffered tenant events newer than the reconnect cursor. */
  replayTo(clientId: string, lastEventId: string | null): SseReplayResult {
    const state = this.clients.get(clientId);
    if (!state || !lastEventId) return { replayed: 0, gap: false };

    const cursor = parseEventId(lastEventId);
    const history = state.client.tenantId
      ? (this.replayByTenant.get(state.client.tenantId) ?? [])
      : [];
    const gapReason = this.resolveReplayGap(cursor, history);
    if (gapReason) {
      const oldestAvailableId = history[0]?.id ?? null;
      const latestAvailableId = history.at(-1)?.id ?? null;
      this.sendTo(clientId, {
        event: SSE_REPLAY_GAP_EVENT,
        data: {
          reason: gapReason,
          requestedId: lastEventId,
          oldestAvailableId,
          latestAvailableId,
        },
      });
    }

    if (cursor === null) {
      return { replayed: 0, gap: true, reason: 'cursor-invalid' };
    }

    let replayed = 0;
    for (const event of history) {
      if (Number(event.id) <= cursor || !this.clientAccepts(state.client, event.collection)) {
        continue;
      }
      if (!this.writeToClient(state, event.message)) break;
      replayed += 1;
    }

    return gapReason ? { replayed, gap: true, reason: gapReason } : { replayed, gap: false };
  }

  private appendReplayEvent(tenantId: string, event: BufferedSseEvent): void {
    const history = this.replayByTenant.get(tenantId) ?? [];
    history.push(event);
    if (history.length > SSE_REPLAY_LIMIT) {
      history.splice(0, history.length - SSE_REPLAY_LIMIT);
    }
    this.replayByTenant.set(tenantId, history);
  }

  private resolveReplayGap(
    cursor: number | null,
    history: readonly BufferedSseEvent[]
  ): SseReplayResult['reason'] | undefined {
    if (cursor === null) return 'cursor-invalid';
    if (history.length === 0) return cursor > 0 ? 'history-unavailable' : undefined;

    const oldest = Number(history[0]?.id);
    const latest = Number(history.at(-1)?.id);
    if (cursor > latest) return 'cursor-ahead';
    if (cursor < oldest - 1) return 'history-evicted';
    return undefined;
  }

  private clientAccepts(client: SseClient, collection: string): boolean {
    return (
      client.collections.length === 0 ||
      client.collections.includes(collection) ||
      client.collections.includes('*')
    );
  }

  private writeToClient(state: SseClientState, message: string): boolean {
    if (!this.clients.has(state.client.id)) return false;
    if (state.waitingForDrain) return this.queueMessage(state, message);

    try {
      const writable = state.client.reply.raw.write(message);
      if (!writable) this.waitForDrain(state);
      return true;
    } catch {
      this.removeClient(state.client.id);
      return false;
    }
  }

  private queueMessage(state: SseClientState, message: string): boolean {
    const messageBytes = Buffer.byteLength(message);
    if (state.pendingBytes + messageBytes > SSE_CLIENT_QUEUE_LIMIT_BYTES) {
      sseLog.warn(
        { clientId: state.client.id, pendingBytes: state.pendingBytes },
        'disconnecting slow SSE client'
      );
      try {
        state.client.reply.raw.end();
      } catch {
        // The connection may already be gone; removal is still required.
      }
      this.removeClient(state.client.id);
      return false;
    }

    state.pendingMessages.push(message);
    state.pendingBytes += messageBytes;
    return true;
  }

  private waitForDrain(state: SseClientState): void {
    if (state.waitingForDrain) return;
    state.waitingForDrain = true;
    const listener = () => {
      state.drainListener = null;
      if (this.clients.get(state.client.id) !== state) return;
      state.waitingForDrain = false;
      this.flushPending(state);
    };
    state.drainListener = listener;
    state.client.reply.raw.once('drain', listener);
  }

  private flushPending(state: SseClientState): void {
    while (!state.waitingForDrain && state.pendingMessages.length > 0) {
      const message = state.pendingMessages.shift();
      if (!message) continue;
      state.pendingBytes -= Buffer.byteLength(message);
      if (!this.writeToClient(state, message)) return;
    }
  }
}

function parseEventId(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function resolveLastEventId(
  header: string | string[] | undefined,
  queryFallback: string | undefined
): string | null {
  return (Array.isArray(header) ? header[0] : header)?.trim() || queryFallback?.trim() || null;
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
