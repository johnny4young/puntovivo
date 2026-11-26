/** Regression coverage for desktop sync authority loss during renderer recovery. */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  push: vi.fn(),
  getStatus: vi.fn(),
  trigger: vi.fn(),
  tenantId: 'desktop-tenant',
}));
vi.mock('@/lib/trpc', () => ({
  vanillaClient: {
    sync: {
      status: { query: mocks.status },
      push: { mutate: mocks.push },
    },
  },
}));
vi.mock('@/features/auth/authStorage', () => ({ getStoredAuthTenantId: () => mocks.tenantId }));
import { useOfflineSync } from './useOfflineSync';

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.tenantId = 'desktop-tenant';
  await i18n.changeLanguage('en');
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      sync: { getStatus: mocks.getStatus, triggerSync: mocks.trigger },
    },
  });
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  mocks.status.mockResolvedValue({ lastSyncAt: null, pendingCount: 0, conflictsCount: 0 });
  mocks.getStatus.mockResolvedValue({ lastSync: null, pendingItems: 0, conflicts: 0 });
});
afterEach(async () => {
  cleanup();
  Object.defineProperty(window, 'api', { configurable: true, value: undefined });
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('desktop sync session rejection', () => {
  it.each([
    [
      'en',
      'SESSION_NOT_REGISTERED',
      'Your session is no longer active on this device. Sign in again and retry.',
    ],
    [
      'es',
      'SESSION_NOT_REGISTERED',
      'Su sesión ya no está activa en este equipo. Inicie sesión de nuevo y vuelva a intentarlo.',
    ],
    [
      'en',
      'SESSION_ROLE_FORBIDDEN',
      'Your role does not allow this action on this device. Ask an administrator to perform it.',
    ],
    [
      'en',
      'STORE_HUB_LOCAL_SESSION_ERROR',
      'Your session is no longer active on this device. Sign in again and retry.',
    ],
    [
      'en',
      "Error invoking remote method 'sync:get-status': Error: SESSION_NOT_REGISTERED",
      'Your session is no longer active on this device. Sign in again and retry.',
    ],
  ])('shows bounded %s copy for %s without a transport fallback', async (locale, code, message) => {
    await i18n.changeLanguage(locale);
    const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getStatus.mockRejectedValue(new Error(code));
    const { result } = renderHook(() => useOfflineSync());
    await waitFor(() => expect(result.current.error).toBe(message));
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.trigger).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it('retains queue counts on denial, stops auto-sync and recovers after registration', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    mocks.getStatus.mockResolvedValue({
      lastSync: '2026-10-01T12:00:00Z',
      pendingItems: 4,
      conflicts: 0,
    });
    const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useOfflineSync());
    await waitFor(() => expect(result.current.pendingItems).toBe(4));
    const priorSync = result.current.lastSync;
    mocks.getStatus.mockRejectedValueOnce(new Error('SESSION_NOT_REGISTERED'));
    await act(async () => {
      await result.current.refreshStatus();
    });
    act(() => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.error).toBe(i18n.t('errors:server.desktopSessionRequired'));
    expect(result.current.pendingItems).toBe(4);
    expect(result.current.lastSync).toEqual(priorSync);
    expect(mocks.trigger).not.toHaveBeenCalled();
    mocks.getStatus.mockResolvedValue({
      lastSync: '2026-10-01T12:05:00Z',
      pendingItems: 0,
      conflicts: 0,
    });
    await act(async () => {
      await result.current.refreshStatus();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.pendingItems).toBe(0);
    expect(mocks.status).not.toHaveBeenCalled();
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it('does not suppress a diagnostic merely quoting the session code', async () => {
    const error = new Error('unexpected payload mentions SESSION_NOT_REGISTERED');
    mocks.getStatus.mockRejectedValue(error);
    const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useOfflineSync());
    await waitFor(() => expect(mocks.status).toHaveBeenCalledOnce());
    expect(diagnostics).toHaveBeenCalledExactlyOnceWith('Failed to get sync status:', error);
    expect(result.current.error).toBeNull();
  });
  it.each([
    ['en', 'SESSION_NOT_REGISTERED', 'errors:server.desktopSessionRequired'],
    ['es', 'SESSION_NOT_REGISTERED', 'errors:server.desktopSessionRequired'],
    ['en', 'SESSION_ROLE_FORBIDDEN', 'errors:server.desktopRoleForbidden'],
  ])('keeps manual sync rejection localized in %s for %s', async (locale, code, key) => {
    await i18n.changeLanguage(locale);
    mocks.trigger.mockRejectedValue(new Error(code));
    const { result } = renderHook(() => useOfflineSync());
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledOnce());
    await act(async () => {
      await result.current.triggerSync();
    });
    expect(result.current.error).toBe(i18n.t(key));
    expect(result.current.isSyncing).toBe(false);
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('coalesces simultaneous hook mounts onto a single getStatus poll and single triggerSync flight', async () => {
    let resolveSync: (() => void) | undefined;
    mocks.trigger.mockImplementation(
      () =>
        new Promise<{ syncedCount: number; failedCount: number; conflictCount: number }>(
          resolve => {
            resolveSync = () => resolve({ syncedCount: 1, failedCount: 0, conflictCount: 0 });
          }
        )
    );

    const first = renderHook(() => useOfflineSync());
    const second = renderHook(() => useOfflineSync());

    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1));

    let p1: Promise<void>;
    let p2: Promise<void>;
    act(() => {
      p1 = first.result.current.triggerSync();
      p2 = second.result.current.triggerSync();
    });
    expect(mocks.trigger).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSync?.();
      await Promise.all([p1!, p2!]);
    });
    expect(first.result.current.isSyncing).toBe(false);
    expect(second.result.current.isSyncing).toBe(false);
  });

  it('still fetches once when the scheduling subscriber unmounts before the first fetch', async () => {
    const first = renderHook(() => useOfflineSync());
    renderHook(() => useOfflineSync());
    first.unmount();
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1));
  });

  it('drops the previous tenant status when the store key changes', async () => {
    mocks.getStatus.mockResolvedValue({ lastSync: null, pendingItems: 5, conflicts: 0 });
    const { result, rerender } = renderHook(() => useOfflineSync());
    await waitFor(() => expect(result.current.pendingItems).toBe(5));
    mocks.getStatus.mockReturnValue(new Promise(() => undefined));
    mocks.tenantId = 'other-tenant';
    rerender();
    expect(result.current.pendingItems).toBe(0);
  });

  it('keeps the shared store alive when the language changes', async () => {
    renderHook(() => useOfflineSync());
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1));
    await act(async () => {
      await i18n.changeLanguage('es');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);
  });

  it('refreshes again after a push instead of reusing a pre-push refresh', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    mocks.getStatus
      .mockImplementationOnce(() => new Promise(resolve => (resolveFirst = resolve)))
      .mockResolvedValue({ lastSync: null, pendingItems: 0, conflicts: 0 });
    mocks.trigger.mockResolvedValue({ success: true, syncedCount: 3 });
    const { result } = renderHook(() => useOfflineSync());
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(1));
    let sync: Promise<void>;
    act(() => {
      sync = result.current.triggerSync();
    });
    await act(async () => {
      resolveFirst?.({ lastSync: null, pendingItems: 3, conflicts: 0 });
      await sync!;
    });
    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
    expect(result.current.pendingItems).toBe(0);
  });
});
