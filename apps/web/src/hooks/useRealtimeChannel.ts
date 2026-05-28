/**
 * ENG-098 — `useRealtimeChannel` SSE subscription hook.
 *
 * Lightweight React wrapper around the browser-native `EventSource`
 * API targetting the server's `/api/realtime/subscribe` endpoint
 * (declared in `packages/server/src/realtime/sse.ts`). The hook is
 * intentionally narrow: it does not handle reconnection state in a
 * Redux-style store and it does not buffer events — every event is
 * surfaced as a callback fire so the consumer can invalidate its
 * own React Query cache.
 *
 * Reconnect strategy:
 *   - `EventSource` reconnects automatically when the network drops
 *     mid-stream, with the server-sent `retry:` interval (defaults
 *     to ~3s on most browsers).
 *   - On a hard close (server restart) we close and re-open with a
 *     5-second exponential backoff capped at 30s.
 *   - On `visibilitychange` (tab becomes visible after being hidden
 *     for a while), we force a fresh subscribe so the board picks
 *     up missed events on the next `list` refetch.
 *
 * Sandbox: `EventSource` is a browser-native API. No Node imports,
 * no preload bridge. The Electron sandboxed renderer reaches the
 * in-process Fastify SSE endpoint via the same HTTP path as `/api/trpc`.
 *
 * @module hooks/useRealtimeChannel
 */

import { useEffect, useRef } from 'react';
import { resolveApiBaseUrl } from '@/lib/runtimeConfigClient';
import { vanillaClient } from '@/lib/trpc';

// ENG-179b — explicit `| undefined` on optional fields.
export interface RealtimeEvent {
  /** Event name from the SSE stream (e.g. `kds.order.created`). */
  type: string;
  /** Parsed JSON data; raw string when the payload is not JSON. */
  data: unknown;
  /** Monotonic event id sent by the server. */
  id?: string | undefined;
}

export interface UseRealtimeChannelOptions {
  /** Collection prefix to subscribe to (e.g. `kds`). */
  collection: string;
  /** Fires for every event matching the subscribed collections. */
  onEvent: (event: RealtimeEvent) => void;
  /** Optional connection-state callback for debugging. */
  onStateChange?: (state: 'connecting' | 'open' | 'closed') => void;
  /** Override the API base URL (used in tests). */
  apiBaseUrl?: string;
  /** Override the realtime authorization step (used in tests). */
  authorize?: () => Promise<void>;
  /** Disable the subscription (e.g. when the module is off). */
  enabled?: boolean;
}

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 5_000;

async function authorizeRealtimeSubscription(): Promise<void> {
  await vanillaClient.auth.realtimeToken.mutate();
}

export function useRealtimeChannel(options: UseRealtimeChannelOptions): void {
  const {
    collection,
    onEvent,
    onStateChange,
    apiBaseUrl,
    authorize = authorizeRealtimeSubscription,
    enabled = true,
  } = options;

  const onEventRef = useRef(onEvent);
  const onStateRef = useRef(onStateChange);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    onStateRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    if (typeof EventSource === 'undefined') return;

    const baseUrl = apiBaseUrl ?? resolveApiBaseUrl(
      import.meta.env.VITE_API_URL || 'http://localhost:8090'
    );

    let source: EventSource | null = null;
    let backoffMs = INITIAL_BACKOFF_MS;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let openGeneration = 0;

    function dispatchEvent(rawEvent: MessageEvent, eventName: string): void {
      if (eventName === 'heartbeat' || eventName === 'connected') return;
      let parsed: unknown = rawEvent.data;
      if (typeof rawEvent.data === 'string') {
        try {
          parsed = JSON.parse(rawEvent.data);
        } catch {
          parsed = rawEvent.data;
        }
      }
      onEventRef.current({
        type: eventName,
        data: parsed,
        id: rawEvent.lastEventId || undefined,
      });
    }

    async function open(): Promise<void> {
      if (disposed) return;
      const generation = ++openGeneration;
      onStateRef.current?.('connecting');

      try {
        await authorize();
      } catch {
        if (!disposed && generation === openGeneration) {
          scheduleRetry();
        }
        return;
      }
      if (disposed || generation !== openGeneration) return;

      const url = new URL(`${baseUrl}/api/realtime/subscribe`);
      url.searchParams.set('collections', collection);

      const next = new EventSource(url.toString(), { withCredentials: true });
      source = next;
      next.addEventListener('open', () => {
        backoffMs = INITIAL_BACKOFF_MS;
        onStateRef.current?.('open');
      });
      next.addEventListener('error', () => {
        // Browser will auto-reconnect for transient errors; if the
        // server hard-closes we'll hit a flap loop. Trigger our own
        // backoff after a short window so we don't spam the server.
        if (disposed) return;
        if (next.readyState === EventSource.CLOSED) {
          scheduleRetry();
        }
      });
      // The server tags events with explicit names (e.g.
      // `kds.order.created`). `addEventListener('message')` only
      // fires for the default channel; we register a listener per
      // event name we care about. Since the server may add new
      // event names later, also bind the wildcard `message`
      // channel so unnamed events still flow through.
      const namedEvents = [
        'kds.order.created',
        'kds.order.updated',
        'kds.order.removed',
        'kds.order.ready',
        'kds.order.recalled',
      ];
      for (const name of namedEvents) {
        next.addEventListener(name, ev => dispatchEvent(ev as MessageEvent, name));
      }
      next.addEventListener('message', ev => dispatchEvent(ev as MessageEvent, 'message'));
      // ENG-168 — the server emits `token-refresh-needed` every 10
      // minutes (under the 15-minute realtime cookie TTL) so a long-
      // lived SSE connection can rotate its bearer without dropping.
      // The mutation refreshes the puntovivo_realtime cookie on the
      // same origin; the next EventSource reconnect (if one ever
      // happens) automatically carries the fresh value. Errors are
      // swallowed because a single refresh failure does not warrant
      // tearing down the channel — the next interval retries, and an
      // actually expired session surfaces via a regular API call.
      next.addEventListener('token-refresh-needed', () => {
        void authorize().catch(() => {});
      });
    }

    function scheduleRetry(): void {
      if (retryTimer) return;
      onStateRef.current?.('closed');
      try {
        source?.close();
      } catch {
        /* ignore */
      }
      source = null;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        void open();
      }, backoffMs);
    }

    function handleVisibility(): void {
      if (document.visibilityState !== 'visible') return;
      if (!source || source.readyState === EventSource.CLOSED) {
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        backoffMs = INITIAL_BACKOFF_MS;
        void open();
      }
    }

    void open();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      try {
        source?.close();
      } catch {
        /* ignore */
      }
      source = null;
      onStateRef.current?.('closed');
    };
  }, [apiBaseUrl, authorize, collection, enabled]);
}
