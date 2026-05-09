/**
 * ENG-074 — Hub reachability poll for cashier terminals running in
 * `authorityMode === 'hub_client'`.
 *
 * Polls `${hubUrl}/api/health` (unauthenticated, CORS-enabled per
 * ENG-073) on a configurable interval with an abort timer. Returns
 * `{reachable, lastChecked, lastError}`. The hook is a no-op when
 * the runtime is NOT `hub_client` so existing `device_local` boots
 * pay zero overhead.
 *
 * The poll only checks reachability of the hub HTTP endpoint — it
 * does NOT validate auth or per-tenant access. Auth lives in the
 * tRPC + Bearer-token path; this hook is a light "is the hub box
 * still on the LAN?" signal that drives the `OfflineStatusBanner`
 * variant + the checkout-button gate.
 *
 * @module hooks/useHubReachability
 */

import { useEffect, useRef, useState } from 'react';
import { getRuntimeConfigSync } from '@/lib/runtimeConfigClient';

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

/**
 * Polls the hub's `/api/health` endpoint and exposes a reachability
 * signal. No-ops in `device_local` and `site_hub` runtimes.
 *
 * The hook intentionally relies on the runtime config resolved at
 * module init (`getRuntimeConfigSync()`). It does NOT subscribe to
 * config changes because runtime config is immutable per ADR-0008.
 */
export function useHubReachability(
  options: UseHubReachabilityOptions = {}
): HubReachabilityState {
  const cfg = getRuntimeConfigSync();
  const isHubClient = cfg.authorityMode === 'hub_client' && Boolean(cfg.hubUrl);
  const [state, setState] = useState<HubReachabilityState>(DEFAULT_STATE);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!isHubClient || !cfg.hubUrl) {
      return;
    }

    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchImpl = options.fetchImpl ?? fetch;
    const healthUrl = `${cfg.hubUrl.replace(/\/+$/, '')}/api/health`;

    cancelledRef.current = false;

    async function pollOnce(): Promise<void> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = new Date().toISOString();
      try {
        const response = await fetchImpl(healthUrl, {
          method: 'GET',
          signal: controller.signal,
          // Hub /api/health is unauthenticated per ENG-073, but we
          // omit credentials anyway — the cookies belong to the hub
          // origin and are not needed for this status check.
          credentials: 'omit',
        });
        if (cancelledRef.current) return;
        if (response.ok) {
          setState({
            reachable: true,
            lastChecked: startedAt,
            lastError: null,
          });
        } else {
          setState({
            reachable: false,
            lastChecked: startedAt,
            lastError: `HTTP ${response.status}`,
          });
        }
      } catch (err) {
        if (cancelledRef.current) return;
        const message =
          err instanceof Error
            ? err.name === 'AbortError'
              ? `timeout after ${timeoutMs}ms`
              : err.message
            : 'unknown error';
        setState({
          reachable: false,
          lastChecked: startedAt,
          lastError: message,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    // Fire immediately so the UI converges on the first paint cycle
    // instead of waiting `intervalMs` for the first signal.
    void pollOnce();
    const interval = setInterval(() => {
      void pollOnce();
    }, intervalMs);

    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
    // The runtime config is module-init-stable (ADR-0008); the deps
    // here are the test-only overrides + the derived isHubClient
    // flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHubClient, options.intervalMs, options.timeoutMs, options.fetchImpl]);

  return state;
}
