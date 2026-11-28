/**
 * Hub reachability poll for cashier terminals running in
 * `authorityMode === 'hub_client'`.
 *
 * Polls `${hubUrl}/api/health` (unauthenticated, CORS-enabled per
 * ) on a configurable interval with an abort timer. Returns
 * `{reachable, lastChecked, lastError}`. The hook is a no-op when
 * the runtime is NOT `hub_client` so existing `device_local` boots
 * pay zero overhead.
 *
 * The poll only checks reachability of the hub HTTP endpoint — it
 * does NOT validate auth or per-tenant access. Auth lives in the
 * tRPC + Bearer-token path; this hook is a light "is the hub box
 * still on the LAN?" signal that drives the `GlobalStatusStrip`
 * variant + the checkout-button gate.
 *
 * @module hooks/useHubReachability
 */

import { useEffect, useMemo, useState } from 'react';
import { getRuntimeConfigSync } from '@/lib/runtimeConfigClient';
import { createHubApiFetch } from '@/features/auth/hubAuthTransport';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;

export interface HubReachabilityState {
  /**
   * `true` when the last poll succeeded (HTTP 2xx within the timeout).
   * `false` when the last poll failed. `null` when the hook is in a
   * mode that does not poll (`device_local` / `site_hub`) or before
   * the first poll completes.
   */
  reachable: boolean | null;
  /** ISO timestamp of the last poll, or `null` before the first poll. */
  lastChecked: string | null;
  /** Last error message when `reachable === false`. */
  lastError: string | null;
}

export interface UseHubReachabilityOptions {
  /** Override the 30s default — useful in tests. */
  intervalMs?: number;
  /** Override the 5s abort timeout — useful in tests. */
  timeoutMs?: number;
  /** Override the resolver for testability. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_STATE: HubReachabilityState = {
  reachable: null,
  lastChecked: null,
  lastError: null,
};

interface SharedHubPoller {
  state: HubReachabilityState;
  listeners: Set<(next: HubReachabilityState) => void>;
  timer: ReturnType<typeof setInterval> | null;
  cancelled: boolean;
}

// Coalesce polls that share the same fetch transport so GlobalStatusStrip and SalesPage
// run a single /api/health interval without leaking state across custom test stubs.
const sharedPollersByFetch = new WeakMap<typeof fetch, Map<string, SharedHubPoller>>();
let defaultHubFetch: typeof fetch | null = null;

function getDefaultHubFetch(): typeof fetch {
  defaultHubFetch ??= createHubApiFetch();
  return defaultHubFetch;
}

function subscribeSharedHubPoller(
  key: string,
  pollUrl: string,
  intervalMs: number,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  onChange: (next: HubReachabilityState) => void
): () => void {
  let byKey = sharedPollersByFetch.get(fetchImpl);
  if (!byKey) {
    byKey = new Map<string, SharedHubPoller>();
    sharedPollersByFetch.set(fetchImpl, byKey);
  }
  let entry = byKey.get(key);
  if (!entry) {
    entry = {
      state: DEFAULT_STATE,
      listeners: new Set(),
      timer: null,
      cancelled: false,
    };
    byKey.set(key, entry);
    const activeEntry = entry;
    const pollOnce = async () => {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = new Date().toISOString();
      try {
        const response = await fetchImpl(pollUrl, {
          method: 'GET',
          signal: controller.signal,
          credentials: 'omit',
        });
        if (activeEntry.cancelled) return;
        activeEntry.state = response.ok
          ? { reachable: true, lastChecked: startedAt, lastError: null }
          : { reachable: false, lastChecked: startedAt, lastError: `HTTP ${response.status}` };
      } catch (err) {
        if (activeEntry.cancelled) return;
        const message =
          err instanceof Error
            ? err.name === 'AbortError'
              ? `timeout after ${timeoutMs}ms`
              : err.message
            : 'unknown error';
        activeEntry.state = { reachable: false, lastChecked: startedAt, lastError: message };
      } finally {
        clearTimeout(abortTimer);
      }
      for (const listener of activeEntry.listeners) listener(activeEntry.state);
    };
    void pollOnce();
    activeEntry.timer = setInterval(() => {
      void pollOnce();
    }, intervalMs);
  }

  entry.listeners.add(onChange);
  onChange(entry.state);

  return () => {
    const bucket = sharedPollersByFetch.get(fetchImpl);
    const current = bucket?.get(key);
    if (!current) return;
    current.listeners.delete(onChange);
    if (current.listeners.size === 0) {
      current.cancelled = true;
      if (current.timer !== null) clearInterval(current.timer);
      bucket?.delete(key);
    }
  };
}

/**
 * Polls the hub's `/api/health` endpoint and exposes a reachability
 * signal. No-ops in `device_local` and `site_hub` runtimes.
 *
 * The hook intentionally relies on the runtime config resolved at
 * module init (`getRuntimeConfigSync()`). It does NOT subscribe to
 * config changes because runtime config is immutable per ADR-0008.
 */
export function useHubReachability(options: UseHubReachabilityOptions = {}): HubReachabilityState {
  const cfg = getRuntimeConfigSync();
  const isHubClient = cfg.authorityMode === 'hub_client' && Boolean(cfg.hubUrl);
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = useMemo(
    () => options.fetchImpl ?? (isHubClient ? getDefaultHubFetch() : fetch),
    [isHubClient, options.fetchImpl]
  );
  const healthUrl =
    isHubClient && cfg.hubUrl ? `${cfg.hubUrl.replace(/\/+$/, '')}/api/health` : null;
  const [state, setState] = useState<HubReachabilityState>(DEFAULT_STATE);

  useEffect(() => {
    if (!healthUrl) {
      return;
    }

    return subscribeSharedHubPoller(
      `${healthUrl}|${intervalMs}|${timeoutMs}`,
      healthUrl,
      intervalMs,
      timeoutMs,
      fetchImpl,
      setState
    );
  }, [fetchImpl, healthUrl, intervalMs, timeoutMs]);

  return state;
}
