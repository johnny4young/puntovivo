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
 * The stable entry point keeps manager state, wire-protocol helpers, and the
 * Fastify adapter in focused modules while preserving existing import paths.
 *
 * @module realtime/sse
 */
export {
  SSE_CLIENT_QUEUE_LIMIT_BYTES,
  SSE_REPLAY_GAP_EVENT,
  SSE_REPLAY_LIMIT,
  type SseClient,
  type SseEvent,
  type SseReplayResult,
} from './sse/contracts.js';
export { SseManager } from './sse/manager.js';
export { generateClientId, resolveLastEventId } from './sse/protocol.js';
export { ssePlugin } from './sse/plugin.js';
