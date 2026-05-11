/**
 * ENG-074 — useHubReachability hook tests.
 *
 * Drives the hook with a fake `fetch` and asserts the state
 * transitions across success / non-2xx / network error / abort
 * timeout. Also pins the no-op contract for non-hub_client modes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __resetRuntimeConfigCacheForTests } from '@/lib/runtimeConfigClient';
import { useHubReachability } from './useHubReachability';

const ORIGINAL_ELECTRON = (window as unknown as { electron?: unknown }).electron;

function setBridge(authorityMode: 'device_local' | 'site_hub' | 'hub_client', hubUrl: string | null): void {
  (window as unknown as { electron?: { runtime?: { getConfigSync: () => unknown } } }).electron = {
    runtime: {
      getConfigSync: () => ({
        authorityMode,
        hubUrl,
        siteId: null,
        deviceId: null,
      }),
    },
  };
  __resetRuntimeConfigCacheForTests();
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  (window as unknown as { electron?: unknown }).electron = ORIGINAL_ELECTRON;
  __resetRuntimeConfigCacheForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useHubReachability', () => {
  it('returns the no-op state in device_local mode and never calls fetch', async () => {
    setBridge('device_local', null);
    const fetchSpy = vi.fn();
    const { result } = renderHook(() =>
      useHubReachability({ intervalMs: 5_000, timeoutMs: 1_000, fetchImpl: fetchSpy as typeof fetch })
    );
    expect(result.current).toEqual({
      reachable: null,
      lastChecked: null,
      lastError: null,
    });
    // Wait one event-loop tick to confirm no fetch fires.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the no-op state in site_hub mode (the hub IS the local server)', async () => {
    setBridge('site_hub', null);
    const fetchSpy = vi.fn();
    const { result } = renderHook(() =>
      useHubReachability({ intervalMs: 5_000, timeoutMs: 1_000, fetchImpl: fetchSpy as typeof fetch })
    );
    expect(result.current.reachable).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the no-op state in hub_client mode when hubUrl is missing', async () => {
    setBridge('hub_client', null);
    const fetchSpy = vi.fn();
    renderHook(() =>
      useHubReachability({ intervalMs: 5_000, timeoutMs: 1_000, fetchImpl: fetchSpy as typeof fetch })
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fires the first poll immediately and reports reachable=true on a 200 response', async () => {
    setBridge('hub_client', 'http://hub.local:8090');
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const { result } = renderHook(() =>
      useHubReachability({ intervalMs: 60_000, timeoutMs: 1_000, fetchImpl: fetchSpy as typeof fetch })
    );
    await waitFor(() => expect(result.current.reachable).toBe(true));
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://hub.local:8090/api/health',
      expect.objectContaining({ method: 'GET', credentials: 'omit' })
    );
    expect(result.current.lastChecked).toMatch(/T/);
    expect(result.current.lastError).toBeNull();
  });

  it('reports reachable=false with the HTTP status when the hub returns 5xx', async () => {
    setBridge('hub_client', 'http://hub.local:8090');
    const fetchSpy = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    const { result } = renderHook(() =>
      useHubReachability({ intervalMs: 60_000, timeoutMs: 1_000, fetchImpl: fetchSpy as typeof fetch })
    );
    await waitFor(() => expect(result.current.reachable).toBe(false));
    expect(result.current.lastError).toBe('HTTP 503');
  });

  it('reports reachable=false on a network error', async () => {
    setBridge('hub_client', 'http://hub.local:8090');
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError('Network unreachable'));
    const { result } = renderHook(() =>
      useHubReachability({ intervalMs: 60_000, timeoutMs: 1_000, fetchImpl: fetchSpy as typeof fetch })
    );
    await waitFor(() => expect(result.current.reachable).toBe(false));
    expect(result.current.lastError).toBe('Network unreachable');
  });

  it('reports reachable=false with a timeout message when the abort controller fires', async () => {
    setBridge('hub_client', 'http://hub.local:8090');
    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const { result } = renderHook(() =>
      useHubReachability({ intervalMs: 60_000, timeoutMs: 50, fetchImpl: fetchSpy as typeof fetch })
    );
    await waitFor(
      () => {
        expect(result.current.reachable).toBe(false);
      },
      { timeout: 1_000 }
    );
    expect(result.current.lastError).toBe('timeout after 50ms');
  });

  it('strips a trailing slash from hubUrl before composing the health URL', async () => {
    setBridge('hub_client', 'http://hub.local:8090/');
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    renderHook(() =>
      useHubReachability({ intervalMs: 60_000, timeoutMs: 1_000, fetchImpl: fetchSpy as typeof fetch })
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://hub.local:8090/api/health');
  });

  it('clears the interval when the component unmounts', async () => {
    setBridge('hub_client', 'http://hub.local:8090');
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const { unmount } = renderHook(() =>
      useHubReachability({ intervalMs: 50, timeoutMs: 1_000, fetchImpl: fetchSpy as typeof fetch })
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const callsBeforeUnmount = fetchSpy.mock.calls.length;
    act(() => {
      unmount();
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    // No further calls after unmount.
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(callsBeforeUnmount + 1);
  });

  it('ignores stale poll results after the fetch dependency changes', async () => {
    setBridge('hub_client', 'http://hub.local:8090');
    let resolveFirstPoll: ((response: Response) => void) | undefined;
    const staleFetch = vi.fn().mockImplementation(() => {
      return new Promise<Response>(resolve => {
        resolveFirstPoll = resolve;
      });
    });
    const freshFetch = vi.fn().mockResolvedValue(new Response('', { status: 503 }));

    const { result, rerender } = renderHook(
      ({ fetchImpl }: { fetchImpl: typeof fetch }) =>
        useHubReachability({
          intervalMs: 60_000,
          timeoutMs: 1_000,
          fetchImpl,
        }),
      { initialProps: { fetchImpl: staleFetch as typeof fetch } }
    );

    await waitFor(() => expect(staleFetch).toHaveBeenCalled());
    rerender({ fetchImpl: freshFetch as typeof fetch });
    await waitFor(() => expect(result.current.lastError).toBe('HTTP 503'));

    act(() => {
      resolveFirstPoll?.(new Response('{}', { status: 200 }));
    });
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(result.current.reachable).toBe(false);
    expect(result.current.lastError).toBe('HTTP 503');
  });
});
