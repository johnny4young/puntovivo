import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  customerDisplayStorageKey,
  CustomerDisplayBus,
  CUSTOMER_DISPLAY_MAX_FUTURE_SKEW_MS,
  CUSTOMER_DISPLAY_STALE_AFTER_MS,
  type CustomerDisplayProjection,
} from './customerDisplayProjection';

export type CustomerDisplayConnectionState = 'waiting' | 'live' | 'offline';
const CUSTOMER_DISPLAY_DIRECTORY_RETENTION_MS = CUSTOMER_DISPLAY_STALE_AFTER_MS * 3;

/**
 * Discover active checkout publishers from the same-origin local mirror.
 * No authentication token, server query, employee identity or cash balance is
 * required by the public-facing renderer.
 */
export function useCustomerDisplayFeed(
  accessId: string | null,
  requestedCashSessionId: string | null
): {
  projections: CustomerDisplayProjection[];
  selectedSessionId: string | null;
  projection: CustomerDisplayProjection | null;
  connection: CustomerDisplayConnectionState;
  reconnect: () => void;
} {
  const [projections, setProjections] = useState<Record<string, CustomerDisplayProjection>>({});
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [clock, setClock] = useState(() => Date.now());
  const [requestNonce, setRequestNonce] = useState(0);

  useEffect(() => {
    if (!accessId) return;
    const bus = new CustomerDisplayBus();
    const accept = (candidate: CustomerDisplayProjection) => {
      if (candidate.accessId !== accessId) return;
      const key = customerDisplayStorageKey(candidate);
      setProjections(current => {
        const existing = current[key];
        return existing && existing.revision > candidate.revision
          ? current
          : { ...current, [key]: candidate };
      });
      setClock(Date.now());
    };
    const unsubscribe = bus.subscribe(message => {
      if (message.kind === 'projection') accept(message.projection);
      if (message.kind === 'clear-all') setProjections({});
      if (message.kind === 'clear') {
        const key = customerDisplayStorageKey(message.scope);
        setProjections(current => {
          if (!(key in current)) return current;
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    });
    bus.requestAccess(accessId);

    return () => {
      unsubscribe();
      bus.close();
    };
  }, [accessId, requestNonce]);

  useEffect(() => {
    const refreshClock = window.setInterval(() => setClock(Date.now()), 1_000);
    const handleOnline = () => {
      setOnline(true);
      setRequestNonce(value => value + 1);
    };
    const handleOffline = () => {
      setOnline(false);
      setProjections({});
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.clearInterval(refreshClock);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const visibleProjections = useMemo(
    () =>
      Object.values(projections)
        .filter(candidate => {
          if (candidate.accessId !== accessId) return false;
          const publishedAt = Date.parse(candidate.publishedAt);
          const age = clock - publishedAt;
          return (
            Number.isFinite(publishedAt) &&
            age >= -CUSTOMER_DISPLAY_MAX_FUTURE_SKEW_MS &&
            age <= CUSTOMER_DISPLAY_DIRECTORY_RETENTION_MS
          );
        })
        .sort(
          (left, right) =>
            left.registerName.localeCompare(right.registerName) ||
            left.cashSessionId.localeCompare(right.cashSessionId)
        ),
    [accessId, clock, projections]
  );
  const selected =
    visibleProjections.find(candidate => candidate.cashSessionId === requestedCashSessionId) ??
    visibleProjections[0] ??
    null;
  const selectedPublishedAt = selected ? Date.parse(selected.publishedAt) : Number.NaN;
  const selectedAge = clock - selectedPublishedAt;
  const freshProjection =
    online &&
    selected &&
    Number.isFinite(selectedPublishedAt) &&
    selectedAge >= -CUSTOMER_DISPLAY_MAX_FUTURE_SKEW_MS &&
    selectedAge <= CUSTOMER_DISPLAY_STALE_AFTER_MS
      ? selected
      : null;

  return {
    projections: visibleProjections,
    selectedSessionId: selected?.cashSessionId ?? null,
    projection: freshProjection,
    connection: !online ? 'offline' : freshProjection ? 'live' : 'waiting',
    reconnect: useCallback(() => setRequestNonce(value => value + 1), []),
  };
}
