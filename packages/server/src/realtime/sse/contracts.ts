import type { FastifyReply } from 'fastify';

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

export interface SseReplayResult {
  replayed: number;
  gap: boolean;
  reason?: 'cursor-invalid' | 'cursor-ahead' | 'history-evicted' | 'history-unavailable';
}
