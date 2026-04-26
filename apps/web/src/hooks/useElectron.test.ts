import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useElectron } from './useElectron';

function setElectronStubs(stubs: {
  electron?: Record<string, unknown> | undefined;
  sync?: Record<string, unknown> | undefined;
  db?: Record<string, unknown> | undefined;
}) {
  const win = window as unknown as Record<string, unknown>;
  if ('electron' in stubs) win.electron = stubs.electron;
  if ('sync' in stubs) win.sync = stubs.sync;
  if ('db' in stubs) win.db = stubs.db;
}

afterEach(() => {
  const win = window as unknown as Record<string, unknown>;
  delete win.electron;
  delete win.sync;
  delete win.db;
  vi.restoreAllMocks();
});

describe('useElectron — non-Electron environment', () => {
  it('reports inElectron=false and exposes nullable bridges when window.electron is missing', async () => {
    setElectronStubs({ electron: undefined, sync: undefined, db: undefined });
    const { result } = renderHook(() => useElectron());
    // jsdom has no microtask schedule that would change the flag — assert
    // the synchronous initial state.
    expect(result.current.isElectron).toBe(false);
    expect(result.current.appInfo).toBeNull();
    expect(result.current.electron).toBeNull();
    expect(result.current.sync).toBeNull();
    expect(result.current.db).toBeNull();
  });
});

describe('useElectron — Electron environment', () => {
  it('flips inElectron=true and resolves appInfo from the IPC bridge', async () => {
    const electronStub = {
      getAppVersion: vi.fn().mockResolvedValue('1.2.3'),
      getServerUrl: vi.fn().mockResolvedValue('http://127.0.0.1:8090'),
    };
    const syncStub = { onSyncEvent: vi.fn() };
    const dbStub = { exec: vi.fn() };
    setElectronStubs({
      electron: electronStub,
      sync: syncStub,
      db: dbStub,
    });

    const { result } = renderHook(() => useElectron());

    await waitFor(() => {
      expect(result.current.isElectron).toBe(true);
      expect(result.current.appInfo).toEqual({
        version: '1.2.3',
        serverUrl: 'http://127.0.0.1:8090',
      });
    });

    expect(electronStub.getAppVersion).toHaveBeenCalledOnce();
    expect(electronStub.getServerUrl).toHaveBeenCalledOnce();
    expect(result.current.electron).toBe(electronStub);
    expect(result.current.sync).toBe(syncStub);
    expect(result.current.db).toBe(dbStub);
  });

  it('keeps appInfo=null and logs when the IPC bridge throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('boom from IPC');
    setElectronStubs({
      electron: {
        getAppVersion: vi.fn().mockRejectedValue(error),
        getServerUrl: vi.fn().mockResolvedValue('http://127.0.0.1:8090'),
      },
    });

    const { result } = renderHook(() => useElectron());

    await waitFor(() => {
      expect(result.current.isElectron).toBe(true);
    });
    // appInfo never updates on the failure branch.
    expect(result.current.appInfo).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to load Electron app info:',
      error
    );
  });
});
