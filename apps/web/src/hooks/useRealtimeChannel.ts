/**
 * Revocable SSE subscription for browser, local authority, and Store Hub modes.
 * The transport carries the canonical access session and the hook owns bounded
 * reconnect, replay cursors, visibility recovery, and React lifecycle cleanup.
 */
import { useEffect, useRef } from 'react';
import { connectRealtime, type RealtimeConnector } from '@/lib/realtimeTransport';
import type { ParsedSseEvent } from '@puntovivo/shared/realtime-sse';

export interface RealtimeEvent {
  type: string;
  data: unknown;
  id?: string | undefined;
}

export interface UseRealtimeChannelOptions {
  collection: string;
  onEvent: (event: RealtimeEvent) => void;
  onStateChange?: (state: 'connecting' | 'open' | 'closed') => void;
  connector?: RealtimeConnector;
  enabled?: boolean;
}

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 5_000;

export function useRealtimeChannel(options: UseRealtimeChannelOptions): void {
  const {
    collection,
    onEvent,
    onStateChange,
    connector = connectRealtime,
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
    if (!enabled || typeof window === 'undefined') return;

    let backoffMs = INITIAL_BACKOFF_MS;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let disposed = false;
    let generation = 0;
    let state: 'connecting' | 'open' | 'closed' = 'closed';
    let lastEventId: string | null = null;

    function reportState(next: typeof state): void {
      state = next;
      onStateRef.current?.(next);
    }

    function dispatchEvent(event: ParsedSseEvent): void {
      if (event.event === 'heartbeat' || event.event === 'connected') return;
      if (event.id) lastEventId = event.id;
      let parsed: unknown = event.data;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        // Non-JSON payloads are a valid SSE contract and remain plain text.
      }
      onEventRef.current({
        type: event.event,
        data: parsed,
        id: event.id,
      });
    }

    function scheduleRetry(expectedGeneration: number): void {
      if (disposed || expectedGeneration !== generation || retryTimer) return;
      controller?.abort();
      controller = null;
      reportState('closed');
      const delay = backoffMs;
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        open();
      }, delay);
    }

    function open(): void {
      if (disposed) return;
      const expectedGeneration = ++generation;
      controller?.abort();
      controller = new AbortController();
      reportState('connecting');
      void connector({
        collections: collection,
        lastEventId,
        signal: controller.signal,
        onOpen: () => {
          if (disposed || expectedGeneration !== generation) return;
          backoffMs = INITIAL_BACKOFF_MS;
          reportState('open');
        },
        onEvent: dispatchEvent,
      }).then(
        () => scheduleRetry(expectedGeneration),
        () => scheduleRetry(expectedGeneration)
      );
    }

    function handleVisibility(): void {
      if (document.visibilityState !== 'visible' || state === 'open') return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      backoffMs = INITIAL_BACKOFF_MS;
      open();
    }

    open();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      disposed = true;
      generation += 1;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort();
      reportState('closed');
    };
  }, [collection, connector, enabled]);
}
