import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeChannel, type RealtimeEvent } from '@/hooks/useRealtimeChannel';

export const SALES_INVALIDATION_THROTTLE_MS = 10_000;

export type LiveState = 'connecting' | 'open' | 'closed' | 'stale' | 'offline';

/** What changed: a sale, an approval or handoff, or everything (day sealed, replay gap). */
export type RefreshScope = 'sales' | 'operations' | 'all';

interface CompanionLiveOptions {
  /** Refetch what the current screen shows for that change; rejects when the read fails. */
  refresh: (scope: RefreshScope) => Promise<unknown>;
  /** Drop cached operational data so a reconnect reads from the network. */
  reset: () => void;
}

function isCompanionInvalidation(
  value: unknown
): value is { scope: 'sales' | 'operations' | 'day_close'; changedAt: string } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.scope === 'sales' ||
      candidate.scope === 'operations' ||
      candidate.scope === 'day_close') &&
    typeof candidate.changedAt === 'string'
  );
}

function useOnlineStatus(onOffline: () => void): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => {
      onOffline();
      setOnline(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [onOffline]);
  return online;
}

/** Companion invalidations, replay gaps and connectivity, shared by every tab. */
export function useCompanionLive({ refresh, reset }: CompanionLiveOptions) {
  const [replayGap, setReplayGap] = useState(false);
  const clearReplayGap = useCallback(() => setReplayGap(false), []);
  const online = useOnlineStatus(clearReplayGap);
  const [connection, setConnection] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const lastSalesRefresh = useRef(0);
  const trailingRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const replayGapRef = useRef(false);
  const actions = useRef({ refresh, reset });
  useEffect(() => {
    actions.current = { refresh, reset };
  }, [refresh, reset]);

  const invalidateNow = useCallback(async (requested: RefreshScope) => {
    // While a replay gap is open only a full refresh may clear it.
    const scope = replayGapRef.current ? 'all' : requested;
    // An approval refresh does not cover a sale, so a queued sales refresh keeps its turn.
    if (scope !== 'operations') {
      if (trailingRefresh.current !== null) {
        clearTimeout(trailingRefresh.current);
        trailingRefresh.current = null;
      }
      lastSalesRefresh.current = Date.now();
    }
    const started = generation.current;
    try {
      await actions.current.refresh(scope);
      if (generation.current === started) {
        replayGapRef.current = false;
        setReplayGap(false);
      }
    } catch {
      // Keep the stale/closed state visible until a later poll or event succeeds.
    }
  }, []);

  const scheduleSalesRefresh = useCallback(() => {
    const elapsed = Date.now() - lastSalesRefresh.current;
    if (replayGapRef.current || elapsed >= SALES_INVALIDATION_THROTTLE_MS) {
      void invalidateNow('sales');
      return;
    }
    if (trailingRefresh.current === null) {
      trailingRefresh.current = setTimeout(() => {
        trailingRefresh.current = null;
        void invalidateNow('sales');
      }, SALES_INVALIDATION_THROTTLE_MS - elapsed);
    }
  }, [invalidateNow]);

  useEffect(
    () => () => {
      generation.current += 1;
      if (trailingRefresh.current !== null) clearTimeout(trailingRefresh.current);
    },
    []
  );

  useEffect(() => {
    if (online) return;
    generation.current += 1;
    replayGapRef.current = false;
    lastSalesRefresh.current = 0;
    if (trailingRefresh.current !== null) {
      clearTimeout(trailingRefresh.current);
      trailingRefresh.current = null;
    }
    // Remove authenticated operational data, not merely hide it.
    actions.current.reset();
  }, [online]);

  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type === 'realtime.replay_gap') {
        generation.current += 1;
        replayGapRef.current = true;
        setReplayGap(true);
        void invalidateNow('all');
        return;
      }
      if (event.type !== 'companion.invalidated' || !isCompanionInvalidation(event.data)) return;
      if (event.data.scope === 'sales') scheduleSalesRefresh();
      else void invalidateNow(event.data.scope === 'operations' ? 'operations' : 'all');
    },
    [invalidateNow, scheduleSalesRefresh]
  );

  useRealtimeChannel({
    collection: 'companion',
    onEvent,
    onStateChange: setConnection,
    enabled: online,
  });

  const liveState: LiveState = !online
    ? 'offline'
    : replayGap && connection === 'open'
      ? 'stale'
      : connection;

  return { online, liveState };
}
