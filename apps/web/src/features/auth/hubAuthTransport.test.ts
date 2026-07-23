import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractServerErrorCode } from '@/lib/translateServerError';
import { __resetRuntimeConfigCacheForTests } from '@/lib/runtimeConfigClient';
import {
  createHubApiFetch,
  isHubClientAuth,
  loginToHub,
  logoutFromHub,
  refreshHubSession,
} from './hubAuthTransport';
import type { SessionAPI } from '@/types/electron';

function installHubBridge(session: SessionAPI): void {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      runtime: {
        getConfigSync: () => ({
          authorityMode: 'hub_client',
          hubUrl: 'https://hub.example.test',
          siteId: null,
          deviceId: null,
        }),
      },
    },
  });
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { session },
  });
  __resetRuntimeConfigCacheForTests();
}

function sessionStub(overrides: Partial<SessionAPI> = {}): SessionAPI {
  return {
    register: vi.fn(async () => ({ ok: true as const })),
    clear: vi.fn(async () => ({ ok: true as const })),
    loginHub: vi.fn(async () => ({ ok: true as const, data: { token: 'login-token' } })),
    refreshHub: vi.fn(async () => ({ ok: true as const, data: { token: 'refresh-token' } })),
    switchStaffHub: vi.fn(async () => ({ ok: true as const, data: { token: 'staff-token' } })),
    logoutHub: vi.fn(async () => ({ ok: true as const, data: { ok: true as const } })),
    requestHub: vi.fn(async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"result":{"data":{"ok":true}}}',
    })),
    clearHub: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

beforeEach(() => {
  __resetRuntimeConfigCacheForTests();
});

afterEach(() => {
  delete window.electron;
  delete window.api;
  __resetRuntimeConfigCacheForTests();
});

describe('hubAuthTransport', () => {
  it('routes login, refresh, and logout through the Electron main bridge', async () => {
    const session = sessionStub();
    installHubBridge(session);

    expect(isHubClientAuth()).toBe(true);
    await expect(loginToHub({ email: 'admin@example.test', password: 'secret' })).resolves.toEqual({
      token: 'login-token',
    });
    await expect(refreshHubSession()).resolves.toEqual({ token: 'refresh-token' });
    await expect(logoutFromHub()).resolves.toBeUndefined();
    expect(session.loginHub).toHaveBeenCalledWith({
      email: 'admin@example.test',
      password: 'secret',
    });
    expect(session.refreshHub).toHaveBeenCalledOnce();
    expect(session.logoutHub).toHaveBeenCalledOnce();
  });

  it('rebuilds the stable server error shape after IPC serialization', async () => {
    installHubBridge(
      sessionStub({
        loginHub: vi.fn(async () => ({
          ok: false as const,
          error: {
            message: 'Email or password is incorrect',
            errorCode: 'AUTH_INVALID_CREDENTIALS',
            trpcCode: 'UNAUTHORIZED',
            status: 401,
          },
        })),
      })
    );

    let caught: unknown;
    try {
      await loginToHub({ email: 'admin@example.test', password: 'wrong' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(extractServerErrorCode(caught)).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('routes configured-hub API requests through main without widening browser fetch', async () => {
    const session = sessionStub();
    installHubBridge(session);

    const response = await createHubApiFetch()(
      'https://hub.example.test/api/trpc/auth.me?batch=1',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer short-access-token',
          'x-correlation-id': 'correlation-123',
        },
        body: '{}',
      }
    );

    expect(await response.json()).toEqual({ result: { data: { ok: true } } });
    expect(session.requestHub).toHaveBeenCalledWith({
      path: '/api/trpc/auth.me?batch=1',
      method: 'POST',
      headers: {
        authorization: 'Bearer short-access-token',
        'x-correlation-id': 'correlation-123',
      },
      body: '{}',
    });
    await expect(
      createHubApiFetch()('https://attacker.example.test/api/trpc/auth.me')
    ).rejects.toThrow('does not match the configured hub');
  });
});
