import { createModuleLogger } from '../../logging/logger.js';
import {
  SSE_CLIENT_QUEUE_LIMIT_BYTES,
  SSE_REPLAY_GAP_EVENT,
  SSE_REPLAY_LIMIT,
  type SseClient,
  type SseEvent,
  type SseReplayResult,
} from './contracts.js';
import { formatSseMessage, parseEventId } from './protocol.js';

const sseLog = createModuleLogger('sse');

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
