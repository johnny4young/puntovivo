import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetRuntimeConfigCacheForTests } from '@/lib/runtimeConfigClient';
import {
  loginNative,
  refreshNative,
  clearNative,
  usesNativeAuthCustody,
} from './nativeAuthTransport';

afterEach(() => {
  delete window.api;
  delete window.electron;
  __resetRuntimeConfigCacheForTests();
});

describe('native auth transport', () => {
  it('uses embedded custody without changing the authority mode or browser fetch', async () => {
    const localAuth = {
      login: vi.fn(async () => ({ ok: true, data: { token: 'access-login' } })),
      refresh: vi.fn(async () => ({ ok: true, data: { token: 'access-renewed' } })),
      clear: vi.fn(async () => ({ ok: true })),
    };
    Object.defineProperty(window, 'api', { configurable: true, value: { session: { localAuth } } });
    __resetRuntimeConfigCacheForTests();
    expect(usesNativeAuthCustody()).toBe(true);
    await expect(
      loginNative({ email: 'synthetic@example.test', password: 'fixture' })
    ).resolves.toEqual({ token: 'access-login' });
    await expect(refreshNative()).resolves.toEqual({ token: 'access-renewed' });
    await clearNative();
    expect(localAuth.clear).toHaveBeenCalledOnce();
  });
  it('keeps structured transient and revoked errors across the IPC boundary', async () => {
    const localAuth = {
      refresh: vi.fn(async () => ({
        ok: false,
        error: {
          message: 'Session verification unavailable',
          status: 503,
          trpcCode: 'SERVICE_UNAVAILABLE',
        },
      })),
    };
    Object.defineProperty(window, 'api', { configurable: true, value: { session: { localAuth } } });
    __resetRuntimeConfigCacheForTests();
    await expect(refreshNative()).rejects.toMatchObject({
      data: { code: 'SERVICE_UNAVAILABLE', httpStatus: 503 },
    });
  });
  it('leaves browser-only authentication on its existing cookie transport', () => {
    __resetRuntimeConfigCacheForTests();
    expect(usesNativeAuthCustody()).toBe(false);
  });
});
