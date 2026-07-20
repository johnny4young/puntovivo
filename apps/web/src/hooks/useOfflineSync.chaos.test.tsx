/**
 * Chaos: intermittent network from the web client.
 *
 * Pins the auto-sync-on-reconnect behavior of `useOfflineSync`.
 * The retail-store failure mode this guards against: the cashier's
 * device drops WiFi for 30 seconds in the middle of a venta, then
 * reconnects. The hook MUST:
 *
 * 1. Reflect navigator.onLine toggles in the `isOnline` field.
 * 2. NOT auto-sync while offline (no spurious calls to
 * `sync.push.mutate` when the network is down).
 * 3. Auto-sync exactly once when transitioning offline → online if
 * `pendingItems > 0`.
 * 4. Recover gracefully when the first sync attempt rejects:
 * `error` surfaces, buffer counts are preserved, and a manual
 * `triggerSync()` retry succeeds.
 *
 * The test uses `renderHook` + a mocked `vanillaClient.sync.{status,push}`
 * to keep the boundary tight — the hook's own state machine is what's
 * under test, not the network layer.
 *
 * @module hooks/useOfflineSync.chaos.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Hoisted mock state — accessible from inside the vi.mock factory.
const statusFn = vi.fn();
const pushFn = vi.fn();
const desktopApi = vi.fn(() => undefined);
const authState = vi.hoisted(() => ({ tenantId: 'chaos-tenant' as string | null }));

vi.mock('@/lib/trpc', () => ({
  vanillaClient: {
    sync: {
      status: { query: () => statusFn() },
      push: { mutate: (args: unknown) => pushFn(args) },
    },
  },
}));

vi.mock('@/features/auth/authStorage', () => ({
  getStoredAuthTenantId: () => authState.tenantId,
}));

import { useOfflineSync } from './useOfflineSync';

function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
  // Fire the matching window event so the hook's listeners react.
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

beforeEach(() => {
  statusFn.mockReset();
  pushFn.mockReset();
  desktopApi.mockReset();
  authState.tenantId = 'chaos-tenant';
  // Default status: nothing pending, no conflicts, never synced.
  statusFn.mockResolvedValue({
    lastSyncAt: null,
    pendingCount: 0,
    conflictsCount: 0,
  });
  pushFn.mockResolvedValue({
    success: true,
    pendingCount: 0,
    conflictsCount: 0,
    lastSyncAt: new Date('2026-05-06T12:00:00.000Z').toISOString(),
    errors: [],
    processedIds: [],
    conflictIds: [],
  });
  // Force `window.api` undefined so the hook takes the web (vanilla
  // client) path, not the Electron desktop bridge.
  Object.defineProperty(window, 'api', {
    configurable: true,
    get: () => undefined,
  });
  setNavigatorOnline(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useOfflineSync chaos: intermittent network', () => {
  it('reflects navigator.onLine toggles in the isOnline state', async () => {
    const { result } = renderHook(() => useOfflineSync());
    await waitFor(() => expect(statusFn).toHaveBeenCalled());
    expect(result.current.isOnline).toBe(true);

    act(() => setNavigatorOnline(false));
    expect(result.current.isOnline).toBe(false);

    act(() => setNavigatorOnline(true));
    expect(result.current.isOnline).toBe(true);
  });

  it('does NOT auto-sync while navigator is offline', async () => {
    statusFn.mockResolvedValue({
      lastSyncAt: null,
      pendingCount: 5,
      conflictsCount: 0,
    });
    setNavigatorOnline(false);

    renderHook(() => useOfflineSync());
    await waitFor(() => expect(statusFn).toHaveBeenCalled());

    // Push must NOT fire while offline even though pendingCount > 0.
    expect(pushFn).not.toHaveBeenCalled();
  });

  it('auto-syncs the queue on reconnect when pending > 0', async () => {
    statusFn.mockResolvedValue({
      lastSyncAt: null,
      pendingCount: 3,
      conflictsCount: 0,
    });
    pushFn.mockResolvedValue({
      success: true,
      pendingCount: 0,
      conflictsCount: 0,
      lastSyncAt: new Date('2026-05-06T12:00:00.000Z').toISOString(),
      errors: [],
      processedIds: [],
      conflictIds: [],
    });

    setNavigatorOnline(false);
    const { result } = renderHook(() => useOfflineSync());
    await waitFor(() => expect(statusFn).toHaveBeenCalled());
    expect(pushFn).not.toHaveBeenCalled();

    // Reconnect — the hook should fire push exactly once.
    act(() => setNavigatorOnline(true));
    await waitFor(() => expect(pushFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pendingItems).toBe(0));
    expect(result.current.error).toBeNull();
  });

  it('does not auto-sync without an authenticated tenant', async () => {
    authState.tenantId = null;
    statusFn.mockResolvedValue({
      lastSyncAt: null,
      pendingCount: 3,
      conflictsCount: 0,
    });

    renderHook(() => useOfflineSync());
    await waitFor(() => expect(statusFn).toHaveBeenCalled());

    expect(pushFn).not.toHaveBeenCalled();
  });

  it('does not auto-sync a queue that requires conflict review', async () => {
    statusFn.mockResolvedValue({
      lastSyncAt: null,
      pendingCount: 3,
      conflictsCount: 1,
    });

    renderHook(() => useOfflineSync());
    await waitFor(() => expect(statusFn).toHaveBeenCalled());

    expect(pushFn).not.toHaveBeenCalled();
  });

  it('preserves the buffer when push rejects, and a manual retry drains it', async () => {
    statusFn.mockResolvedValue({
      lastSyncAt: null,
      pendingCount: 4,
      conflictsCount: 0,
    });
    // First push rejects — simulates a flaky upstream that resolves
    // its own backend issue between attempt 1 and attempt 2.
    pushFn.mockRejectedValueOnce(new Error('network blip')).mockResolvedValueOnce({
      success: true,
      pendingCount: 0,
      conflictsCount: 0,
      lastSyncAt: new Date('2026-05-06T12:05:00.000Z').toISOString(),
      errors: [],
      processedIds: [],
      conflictIds: [],
    });

    const { result } = renderHook(() => useOfflineSync());
    // The hook auto-fires push because navigator.onLine starts at
    // true and pendingItems lands at 4 from the status read.
    await waitFor(() => expect(pushFn).toHaveBeenCalledTimes(1));
    // The first push rejected — error surfaces and pendingItems is
    // preserved (the rejection branch leaves prev values intact).
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.pendingItems).toBe(4);

    // Manual retry — same hook instance, second push resolves.
    await act(async () => {
      await result.current.triggerSync();
    });
    expect(pushFn).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.pendingItems).toBe(0));
    expect(result.current.error).toBeNull();
  });
});
