/** Regression coverage for desktop sync authority loss during renderer recovery. */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  push: vi.fn(),
  getStatus: vi.fn(),
  trigger: vi.fn(),
}));
vi.mock('@/lib/trpc', () => ({
  vanillaClient: {
    sync: {
      status: { query: mocks.status },
      push: { mutate: mocks.push },
    },
  },
}));
vi.mock('@/features/auth/authStorage', () => ({ getStoredAuthTenantId: () => 'desktop-tenant' }));
import { useOfflineSync } from './useOfflineSync';

beforeEach(async () => {
  vi.resetAllMocks();
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
      'Tu sesión ya no está activa en este equipo. Inicia sesión de nuevo y vuelve a intentarlo.',
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
});
