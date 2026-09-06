import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TRPCClientError } from '@trpc/client';
import { StrictMode, type ReactNode } from 'react';

const {
  navigateMock,
  setAccessTokenMock,
  clearAccessTokenMock,
  invalidateAuthSessionWorkMock,
  setSessionExpiredHandlerMock,
  persistSessionMock,
  clearSessionMock,
  resetWorkspacesMock,
  resetQuickCreateMock,
  clearCustomerDisplayMock,
  refreshMutateMock,
  meQueryMock,
  loginMutateMock,
  switchStaffMutateMock,
  logoutMutateMock,
  registerDeviceMutateMock,
  healthCheckMock,
  queryClientClearMock,
  hubModeMock,
  clearHubMock,
  refreshHubMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  setAccessTokenMock: vi.fn(),
  clearAccessTokenMock: vi.fn(),
  invalidateAuthSessionWorkMock: vi.fn(),
  setSessionExpiredHandlerMock: vi.fn(),
  persistSessionMock: vi.fn(),
  clearSessionMock: vi.fn(),
  resetWorkspacesMock: vi.fn(),
  resetQuickCreateMock: vi.fn(),
  clearCustomerDisplayMock: vi.fn(),
  refreshMutateMock: vi.fn(),
  meQueryMock: vi.fn(),
  loginMutateMock: vi.fn(),
  switchStaffMutateMock: vi.fn(),
  logoutMutateMock: vi.fn(),
  registerDeviceMutateMock: vi.fn(),
  healthCheckMock: vi.fn(),
  queryClientClearMock: vi.fn(),
  hubModeMock: vi.fn(),
  clearHubMock: vi.fn(),
  refreshHubMock: vi.fn(),
}));

const queryClientMock = { clear: queryClientClearMock };

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => queryClientMock,
  };
});

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/lib/trpc', () => ({
  setAccessToken: setAccessTokenMock,
  clearAccessToken: clearAccessTokenMock,
  invalidateAuthSessionWork: invalidateAuthSessionWorkMock,
  setAuthSessionExpiredHandler: setSessionExpiredHandlerMock,
  vanillaClient: {
    setupReadiness: { get: { query: async () => ({ blockerCount: 0, acknowledgedAt: null }) } },
    health: { check: { query: () => healthCheckMock() } },
    auth: {
      refresh: { mutate: () => refreshMutateMock() },
      me: { query: () => meQueryMock() },
      login: { mutate: (input: unknown) => loginMutateMock(input) },
      switchStaff: { mutate: (input: unknown) => switchStaffMutateMock(input) },
      logout: { mutate: () => logoutMutateMock() },
      registerDevice: { mutate: (input: unknown) => registerDeviceMutateMock(input) },
    },
  },
}));

vi.mock('./hubAuthTransport', async () => ({
  ...(await vi.importActual<typeof import('./hubAuthTransport')>('./hubAuthTransport')),
  isHubClientAuth: hubModeMock,
  clearHubSession: clearHubMock,
  refreshHubSession: refreshHubMock,
}));

vi.mock('./authStorage', async () => ({
  ...(await vi.importActual<typeof import('./authStorage')>('./authStorage')),
  persistAuthSession: persistSessionMock,
  clearAuthSession: clearSessionMock,
}));

vi.mock('@/features/sales/useCartWorkspaceStore', () => ({
  useCartWorkspaceStore: {
    getState: () => ({ resetAllWorkspaces: resetWorkspacesMock }),
  },
}));

vi.mock('@/features/sales/useQuickCreateStore', () => ({
  useQuickCreateStore: {
    getState: () => ({ reset: resetQuickCreateMock }),
  },
}));

vi.mock('@/features/surfaces/customerDisplayStorage', () => ({
  clearAllCustomerDisplayProjections: clearCustomerDisplayMock,
}));

import { AuthProvider, useAuth } from './AuthProvider';
import { __resetBootSessionRefreshForTests } from './bootSessionRefresh';
import { __resetApiBootstrapForTests } from '@/lib/apiBootstrap';

const sessionPayload = {
  user: {
    id: 'u1',
    email: 'admin@localhost',
    name: 'Admin',
    role: 'admin' as const,
    tenantId: 't1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  tenant: {
    id: 't1',
    name: 'Demo',
    slug: 'demo',
    settings: { taxRate: 19 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
};

function wrap({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <AuthProvider>{children}</AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  __resetApiBootstrapForTests();
  window.localStorage.removeItem('puntovivo:staff-handoff');
  window.localStorage.removeItem('puntovivo:require-explicit-sign-in:v1');
  navigateMock.mockReset();
  setAccessTokenMock.mockReset();
  clearAccessTokenMock.mockReset();
  invalidateAuthSessionWorkMock.mockReset();
  setSessionExpiredHandlerMock.mockReset();
  persistSessionMock.mockReset();
  clearSessionMock.mockReset();
  resetWorkspacesMock.mockReset();
  resetQuickCreateMock.mockReset();
  clearCustomerDisplayMock.mockReset();
  refreshMutateMock.mockReset();
  meQueryMock.mockReset();
  loginMutateMock.mockReset();
  switchStaffMutateMock.mockReset();
  logoutMutateMock.mockReset();
  registerDeviceMutateMock.mockReset().mockResolvedValue({ deviceId: 'web-test-device' });
  healthCheckMock.mockReset().mockResolvedValue({ ok: true });
  queryClientClearMock.mockReset();
  hubModeMock.mockReset().mockReturnValue(false);
  clearHubMock.mockReset().mockResolvedValue(undefined);
  refreshHubMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.session;
  delete window.api;
});

describe('useAuth — context guard', () => {
  it('throws a clear error when used outside an AuthProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(/useAuth must be used within AuthProvider/);
    consoleSpy.mockRestore();
  });
});

describe('AuthProvider — bootstrap', () => {
  it('issues one refresh when StrictMode mounts the boot effect twice', async () => {
    __resetBootSessionRefreshForTests();
    // Hold the refresh open so both mount invocations are genuinely in
    // flight together: that overlap is what the batch link would
    // otherwise coalesce into auth.refresh,auth.refresh, and what the
    // rotating refresh cookie must never see.
    let releaseRefresh: (value: { token: string }) => void = () => {};
    refreshMutateMock.mockImplementation(
      () =>
        new Promise<{ token: string }>(resolve => {
          releaseRefresh = resolve;
        })
    );
    meQueryMock.mockResolvedValue(sessionPayload);

    function Probe() {
      const auth = useAuth();
      return <span data-testid="auth">{auth.isAuthenticated ? 'yes' : 'no'}</span>;
    }

    render(
      <StrictMode>
        <MemoryRouter>
          <AuthProvider>
            <Probe />
          </AuthProvider>
        </MemoryRouter>
      </StrictMode>
    );

    await waitFor(() => expect(refreshMutateMock).toHaveBeenCalled());
    await act(async () => {
      releaseRefresh({ token: 'tok-boot' });
    });

    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('yes'));
    expect(refreshMutateMock).toHaveBeenCalledTimes(1);
  });

  it('resumes the verified desktop operator without requiring a refresh cookie', async () => {
    const resumeDesktopSessionMock = vi.fn(async () => ({ token: 'tok-desktop-resumed' }));
    const registerDesktopSessionMock = vi.fn(async () => ({ ok: true as const }));
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        session: {
          resume: resumeDesktopSessionMock,
          register: registerDesktopSessionMock,
        },
      },
    });
    meQueryMock.mockResolvedValue(sessionPayload);

    function Probe() {
      const auth = useAuth();
      return <span data-testid="auth">{auth.isAuthenticated ? 'yes' : 'no'}</span>;
    }

    render(wrap({ children: <Probe /> }));
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('yes'));

    expect(resumeDesktopSessionMock).toHaveBeenCalledOnce();
    expect(refreshMutateMock).not.toHaveBeenCalled();
    expect(setAccessTokenMock).toHaveBeenCalledWith('tok-desktop-resumed');
    expect(registerDesktopSessionMock).toHaveBeenCalledWith('tok-desktop-resumed');
  });

  it('initialises with isLoading=true, then resolves to authenticated when refresh + me succeed', async () => {
    refreshMutateMock.mockResolvedValue({ token: 'tok-1' });
    meQueryMock.mockResolvedValue(sessionPayload);

    function Probe() {
      const auth = useAuth();
      return (
        <div>
          <span data-testid="loading">{auth.isLoading ? 'loading' : 'idle'}</span>
          <span data-testid="auth">{auth.isAuthenticated ? 'yes' : 'no'}</span>
          <span data-testid="email">{auth.user?.email ?? '—'}</span>
          <span data-testid="tenant">{auth.tenant?.slug ?? '—'}</span>
        </div>
      );
    }

    render(
      <MemoryRouter>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('idle');
    });
    expect(screen.getByTestId('auth')).toHaveTextContent('yes');
    expect(screen.getByTestId('email')).toHaveTextContent('admin@localhost');
    expect(screen.getByTestId('tenant')).toHaveTextContent('demo');
    expect(setAccessTokenMock).toHaveBeenCalledWith('tok-1');
    expect(persistSessionMock).toHaveBeenCalledOnce();
  });

  it('treats UNAUTHORIZED on refresh as silent unauthenticated (no console.error)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new TRPCClientError('You must be logged in to perform this action');
    refreshMutateMock.mockRejectedValue(err);

    function Probe() {
      const auth = useAuth();
      return <span data-testid="auth">{auth.isAuthenticated ? 'yes' : 'no'}</span>;
    }
    render(
      <MemoryRouter>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByTestId('auth')).toHaveTextContent('no');
    });
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(clearAccessTokenMock).toHaveBeenCalled();
    expect(clearSessionMock).toHaveBeenCalled();
    expect(resetWorkspacesMock).not.toHaveBeenCalled();
    expect(resetQuickCreateMock).toHaveBeenCalled();
    expect(clearCustomerDisplayMock).toHaveBeenCalled();
    expect(queryClientClearMock).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it.each(['health', 'refresh', 'me'] as const)(
    'keeps %s failures locked and retries only after an explicit action',
    async stage => {
      const error = TRPCClientError.from(
        {
          error: {
            code: -32029,
            message: 'internal fixture detail',
            data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429 },
          },
        },
        {
          meta: { response: new Response('{}', { status: 429, headers: { 'retry-after': '30' } }) },
        }
      );
      const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
      refreshMutateMock.mockResolvedValue({ token: 'retry-token' });
      meQueryMock.mockResolvedValue(sessionPayload);
      const stageMock =
        stage === 'health'
          ? healthCheckMock
          : stage === 'refresh'
            ? refreshMutateMock
            : meQueryMock;
      stageMock.mockRejectedValueOnce(error);
      const clearDesktop = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(window, 'api', {
        configurable: true,
        value: { session: { clear: clearDesktop } },
      });
      const { result } = renderHook(() => useAuth(), { wrapper: wrap });
      await waitFor(() => expect(result.current.bootstrapRecovery?.kind).toBe('throttled'));
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(result.current.tenant).toBeNull();
      expect(result.current.error).toBeNull();
      expect(clearAccessTokenMock).toHaveBeenCalled();
      expect(clearSessionMock).toHaveBeenCalled();
      expect(clearDesktop).not.toHaveBeenCalled();
      expect(resetWorkspacesMock).not.toHaveBeenCalled();
      expect(clearCustomerDisplayMock).toHaveBeenCalled();
      const count = stageMock.mock.calls.length;
      act(() => result.current.bootstrapRecovery?.retry());
      expect(stageMock).toHaveBeenCalledTimes(count);
      now.mockReturnValue(130_000);
      act(() => {
        result.current.bootstrapRecovery?.retry();
        result.current.bootstrapRecovery?.retry();
      });
      await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
      expect(stageMock).toHaveBeenCalledTimes(count + 1);
      expect(result.current.bootstrapRecovery).toBeUndefined();
      expect(result.current.user?.id).toBe(sessionPayload.user.id);
      expect(clearDesktop).not.toHaveBeenCalled();
    }
  );

  it.each(
    ['health', 'refresh', 'me'].flatMap(stage =>
      ['network', '503'].map(failure => ({ stage, failure }))
    )
  )(
    'recovers a $stage $failure outage without trusting cached identity',
    async ({ stage, failure }) => {
      refreshMutateMock.mockResolvedValue({ token: 'retry-token' });
      meQueryMock.mockResolvedValue(sessionPayload);
      const stageMock =
        stage === 'health'
          ? healthCheckMock
          : stage === 'refresh'
            ? refreshMutateMock
            : meQueryMock;
      stageMock.mockRejectedValueOnce(
        failure === 'network' ? new TypeError('Failed to fetch') : { data: { httpStatus: 503 } }
      );
      const { result } = renderHook(() => useAuth(), { wrapper: wrap });
      await waitFor(() => expect(result.current.bootstrapRecovery?.kind).toBe('unavailable'));
      expect(result.current.isAuthenticated).toBe(false);
      expect(persistSessionMock).not.toHaveBeenCalled();
      expect(resetWorkspacesMock).not.toHaveBeenCalled();
      act(() => result.current.bootstrapRecovery?.retry());
      await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    }
  );

  it('allows explicit account change without deleting owner-keyed carts', async () => {
    refreshMutateMock.mockRejectedValue(new Error('temporary outage'));
    const clearDesktop = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { session: { clear: clearDesktop } },
    });
    const { result } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(result.current.bootstrapRecovery).toBeDefined());
    await act(async () => {
      await result.current.bootstrapRecovery?.signIn();
    });
    expect(result.current.bootstrapRecovery).toBeUndefined();
    expect(result.current.isAuthenticated).toBe(false);
    expect(clearDesktop).toHaveBeenCalledOnce();
    expect(resetWorkspacesMock).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/login', expect.objectContaining({ replace: true }));
  });

  it('does not auto-resume a browser cookie after choosing another account and reloading', async () => {
    refreshMutateMock
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue({ token: 'previous-user-cookie' });
    meQueryMock.mockResolvedValue(sessionPayload);
    const first = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(first.result.current.bootstrapRecovery).toBeDefined());
    await act(async () => {
      await first.result.current.bootstrapRecovery?.signIn();
    });
    first.unmount();
    const next = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(next.result.current.isLoading).toBe(false));
    expect(next.result.current.isAuthenticated).toBe(false);
    expect(refreshMutateMock).toHaveBeenCalledOnce();
    expect(meQueryMock).not.toHaveBeenCalled();
    loginMutateMock.mockResolvedValue({ token: 'fresh-sign-in' });
    await act(async () => {
      await next.result.current.login({ email: 'new@example.test', password: 'secret' });
    });
    expect(next.result.current.isAuthenticated).toBe(true);
    expect(window.localStorage.getItem('puntovivo:require-explicit-sign-in:v1')).toBeNull();
  });

  it('establishes safe bootstrap before login when auto-resume was explicitly disabled', async () => {
    window.localStorage.setItem('puntovivo:require-explicit-sign-in:v1', '1');
    const bootstrap = createDeferred<{ ok: true }>();
    healthCheckMock.mockReturnValueOnce(bootstrap.promise);
    loginMutateMock.mockResolvedValue({ token: 'fresh-login' });
    meQueryMock.mockResolvedValue(sessionPayload);
    const { result } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.login({ email: 'new@example.test', password: 'secret' });
    });
    expect(healthCheckMock).toHaveBeenCalledOnce();
    expect(loginMutateMock).not.toHaveBeenCalled();
    expect(refreshMutateMock).not.toHaveBeenCalled();
    await act(async () => {
      bootstrap.resolve({ ok: true });
      await pending;
    });
    expect(loginMutateMock).toHaveBeenCalledOnce();
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('retains Hub credentials for retry, but waits for their explicit removal before account change', async () => {
    hubModeMock.mockReturnValue(true);
    refreshHubMock
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue({ token: 'hub-token' });
    meQueryMock.mockResolvedValue(sessionPayload);
    const { result, unmount } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(result.current.bootstrapRecovery).toBeDefined());
    expect(clearHubMock).not.toHaveBeenCalled();
    act(() => result.current.bootstrapRecovery?.retry());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(clearHubMock).not.toHaveBeenCalled();
    unmount();
    refreshHubMock.mockRejectedValue(new TypeError('offline'));
    const clear = createDeferred<void>();
    clearHubMock.mockImplementationOnce(() => clear.promise);
    const next = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(next.result.current.bootstrapRecovery).toBeDefined());
    let change: Promise<void> | undefined;
    act(() => {
      change = next.result.current.bootstrapRecovery?.signIn();
      void next.result.current.bootstrapRecovery?.signIn();
    });
    expect(clearHubMock).toHaveBeenCalledOnce();
    expect(next.result.current.bootstrapRecovery?.isChangingAccount).toBe(true);
    expect(navigateMock).not.toHaveBeenCalled();
    await act(async () => {
      clear.resolve();
      await change;
    });
    expect(next.result.current.bootstrapRecovery).toBeUndefined();
    expect(navigateMock).toHaveBeenCalledWith('/login', expect.objectContaining({ replace: true }));
    expect(resetWorkspacesMock).not.toHaveBeenCalled();
  });

  it('keeps account change blocked if the sealed Hub credential cannot be removed', async () => {
    hubModeMock.mockReturnValue(true);
    refreshHubMock.mockRejectedValue(new TypeError('offline'));
    clearHubMock.mockRejectedValue(new Error('private storage diagnostic'));
    const { result } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(result.current.bootstrapRecovery).toBeDefined());
    await act(async () => {
      await result.current.bootstrapRecovery?.signIn();
    });
    expect(result.current.bootstrapRecovery?.accountChangeFailed).toBe(true);
    expect(result.current.bootstrapRecovery?.isChangingAccount).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(resetWorkspacesMock).not.toHaveBeenCalled();
  });

  it('does not install a late boot result after another tab changes operator', async () => {
    let resolveMe!: (value: typeof sessionPayload) => void;
    refreshMutateMock.mockResolvedValue({ token: 'old-token' });
    meQueryMock.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveMe = resolve;
        })
    );
    const { result } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(meQueryMock).toHaveBeenCalled());
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'puntovivo:staff-handoff', newValue: 'new-operator' })
      )
    );
    await act(async () => resolveMe(sessionPayload));
    expect(result.current.isAuthenticated).toBe(false);
    expect(persistSessionMock).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/login');
  });
});

describe('AuthProvider — interactive identity fences', () => {
  it.each(['login', 'switchStaff', 'logout'] as const)(
    'does not adopt or clear state after a late %s following another-tab handoff',
    async operation => {
      refreshMutateMock.mockResolvedValue({ token: 'original' });
      meQueryMock.mockResolvedValue(sessionPayload);
      const { result } = renderHook(() => useAuth(), { wrapper: wrap });
      await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
      const deferred = createDeferred<{ token: string; sessionExpiresAt: string }>();
      const mutation =
        operation === 'login'
          ? loginMutateMock
          : operation === 'switchStaff'
            ? switchStaffMutateMock
            : logoutMutateMock;
      mutation.mockReturnValueOnce(deferred.promise);
      let pending: Promise<void> | undefined;
      act(() => {
        pending =
          operation === 'login'
            ? result.current.login({ email: 'old@example.test', password: 'secret' })
            : operation === 'switchStaff'
              ? result.current.switchStaff({ targetUserId: 'old', pin: '123456' })
              : result.current.logout();
      });
      await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
      act(() =>
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'puntovivo:staff-handoff', newValue: 'new-operator' })
        )
      );
      const tokensBefore = setAccessTokenMock.mock.calls.length;
      const persistenceBefore = persistSessionMock.mock.calls.length;
      const clearsBefore = clearSessionMock.mock.calls.length;
      await act(async () => {
        deferred.resolve({ token: 'late-old-token', sessionExpiresAt: '2026-09-06T23:00:00Z' });
        await pending;
      });
      expect(result.current.isAuthenticated).toBe(false);
      expect(setAccessTokenMock).toHaveBeenCalledTimes(tokensBefore);
      expect(persistSessionMock).toHaveBeenCalledTimes(persistenceBefore);
      expect(clearSessionMock).toHaveBeenCalledTimes(clearsBefore);
      expect(navigateMock).toHaveBeenLastCalledWith('/login');
    }
  );
});

describe('AuthProvider — login flow', () => {
  it.each(['QuotaExceededError', 'SecurityError'])(
    'does not issue credentials when deny-resume persistence fails with %s',
    async name => {
      refreshMutateMock.mockRejectedValue(
        new TRPCClientError('You must be logged in to perform this action')
      );
      const { result } = renderHook(() => useAuth(), { wrapper: wrap });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      const failure = new DOMException('Storage unavailable', name);
      vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw failure;
      });
      await act(async () => {
        await expect(
          result.current.login({ email: 'other@example.test', password: 'secret' })
        ).rejects.toBe(failure);
      });
      expect(loginMutateMock).not.toHaveBeenCalled();
      expect(setAccessTokenMock).not.toHaveBeenCalled();
      expect(registerDeviceMutateMock).not.toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe(failure);
    }
  );

  it.each(['QuotaExceededError', 'SecurityError'])(
    'rejects partial login despite %s during terminal adoption teardown',
    async name => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      refreshMutateMock.mockRejectedValue(
        new TRPCClientError('You must be logged in to perform this action')
      );
      const failure = { data: { code: 'UNAUTHORIZED', errorCode: 'AUTH_IDENTITY_CHANGED' } };
      loginMutateMock.mockResolvedValue({ token: 'other-user-token' });
      const denyIntentWrites = vi.spyOn(window.localStorage, 'setItem');
      registerDeviceMutateMock.mockImplementation(async () => {
        // Storage may become unavailable after credentials have been issued.
        // Rejected-device teardown must not write the already-persisted intent.
        denyIntentWrites.mockImplementation(() => {
          throw new DOMException('Storage unavailable', name);
        });
        if (name === 'SecurityError') {
          clearSessionMock.mockImplementation(() => {
            throw new DOMException('Storage unavailable', name);
          });
        }
        throw failure;
      });
      const clearDesktop = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(window, 'api', {
        configurable: true,
        value: { session: { clear: clearDesktop } },
      });
      const { result } = renderHook(() => useAuth(), { wrapper: wrap });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await act(async () => {
        await expect(
          result.current.login({ email: 'other@example.test', password: 'secret' })
        ).rejects.toBe(failure);
      });
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(result.current.error).toBe(failure);
      expect(meQueryMock).not.toHaveBeenCalled();
      expect(persistSessionMock).not.toHaveBeenCalled();
      expect(resetWorkspacesMock).not.toHaveBeenCalled();
      expect(clearDesktop).toHaveBeenCalledTimes(2);
      expect(queryClientClearMock).toHaveBeenCalledTimes(2);
      expect(resetQuickCreateMock).toHaveBeenCalledTimes(2);
      expect(clearCustomerDisplayMock).toHaveBeenCalledTimes(2);
      expect(window.localStorage.getItem('puntovivo:require-explicit-sign-in:v1')).toBe('1');
      expect(denyIntentWrites).toHaveBeenCalledExactlyOnceWith(
        'puntovivo:require-explicit-sign-in:v1',
        '1'
      );
      expect(clearAccessTokenMock.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
        setAccessTokenMock.mock.invocationCallOrder.at(-1)!
      );
    }
  );

  it('returns a viewer directly to Companion without a dashboard navigation', async () => {
    refreshMutateMock.mockRejectedValue(
      new TRPCClientError('You must be logged in to perform this action')
    );
    loginMutateMock.mockResolvedValue({ token: 'tok-companion' });
    meQueryMock.mockResolvedValue({
      ...sessionPayload,
      user: { ...sessionPayload.user, role: 'viewer' },
    });
    const { result: auth } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <MemoryRouter
          initialEntries={[{ pathname: '/login', state: { from: { pathname: '/c/' } } }]}
        >
          <AuthProvider>{children}</AuthProvider>
        </MemoryRouter>
      ),
    });
    await waitFor(() => expect(auth.current.isLoading).toBe(false));
    await act(() => auth.current.login({ email: 'viewer@example.test', password: 'pwd' }));
    expect(navigateMock).toHaveBeenLastCalledWith('/c/');
    expect(navigateMock).not.toHaveBeenCalledWith('/dashboard');
  });

  it('on success persists token, fetches the session, and navigates per role', async () => {
    refreshMutateMock.mockRejectedValue(
      new TRPCClientError('You must be logged in to perform this action')
    );
    loginMutateMock.mockResolvedValue({ token: 'tok-login' });
    meQueryMock.mockResolvedValue({
      ...sessionPayload,
      user: { ...sessionPayload.user, role: 'cashier' as const },
    });

    const { result: auth } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(auth.current.isLoading).toBe(false));

    await act(async () => {
      await auth.current.login({ email: 'a@b.com', password: 'pwd' });
    });
    expect(loginMutateMock).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pwd',
    });
    expect(setAccessTokenMock).toHaveBeenCalledWith('tok-login');
    expect(navigateMock).toHaveBeenCalledWith('/sales');
    expect(auth.current.isAuthenticated).toBe(true);
    expect(auth.current.user?.role).toBe('cashier');
  });

  it('on failure stores the error and rethrows so the caller can render translated copy', async () => {
    refreshMutateMock.mockRejectedValue(
      new TRPCClientError('You must be logged in to perform this action')
    );
    const failure = new Error('bad password');
    loginMutateMock.mockRejectedValue(failure);

    const { result: auth } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(auth.current.isLoading).toBe(false));

    let captured: unknown = null;
    await act(async () => {
      try {
        await auth.current.login({ email: 'a@b.com', password: 'pwd' });
      } catch (err) {
        captured = err;
      }
    });
    expect(captured).toBe(failure);
    await waitFor(() => expect(auth.current.error).toBe(failure));
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe('AuthProvider — confirmed tenant settings', () => {
  it('mirrors a committed settings patch without replacing unrelated settings', async () => {
    refreshMutateMock.mockResolvedValue({ token: 'tok-1' });
    meQueryMock.mockResolvedValue(sessionPayload);

    const { result: auth } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(auth.current.isAuthenticated).toBe(true));

    act(() => {
      auth.current.updateTenantSettings({ businessType: 'butchery' });
    });

    expect(auth.current.tenant?.settings).toEqual({
      taxRate: 19,
      restaurant: { serviceChargeRate: 0 },
      businessType: 'butchery',
    });
    expect(auth.current.user).toEqual(sessionPayload.user);
  });
});

describe('AuthProvider — confirmed session revocation', () => {
  async function authenticated() {
    refreshMutateMock.mockResolvedValue({ token: 'tok-1' });
    meQueryMock.mockResolvedValue(sessionPayload);
    const hook = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(hook.result.current.isAuthenticated).toBe(true));
    return hook.result;
  }

  it('closes parked work and desktop authority without calling logout again', async () => {
    const auth = await authenticated();
    const clearDesktop = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'session', {
      configurable: true,
      value: { clear: clearDesktop },
    });
    const commit = vi.fn().mockResolvedValue({ success: true });
    await act(async () => {
      await expect(auth.current.runSessionRevocation(commit)).resolves.toBe(true);
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(logoutMutateMock).not.toHaveBeenCalled();
    expect(clearDesktop).toHaveBeenCalledOnce();
    expect(clearAccessTokenMock).toHaveBeenCalledOnce();
    expect(resetWorkspacesMock).toHaveBeenCalledOnce();
    expect(queryClientClearMock).toHaveBeenCalledOnce();
    expect(clearCustomerDisplayMock).toHaveBeenCalledOnce();
    expect(auth.current.user).toBeNull();
    expect(auth.current.isLoading).toBe(false);
    expect(navigateMock).toHaveBeenLastCalledWith('/login');
    expect(window.localStorage.getItem('puntovivo:staff-handoff')).toMatch(/^revoked:/);
  });

  it('preserves authority and work when the server rejects the password change', async () => {
    const auth = await authenticated();
    const failure = new Error('Current password is incorrect');
    await act(async () => {
      await expect(
        auth.current.runSessionRevocation(async () => {
          throw failure;
        })
      ).rejects.toBe(failure);
    });
    expect(auth.current.user?.id).toBe(sessionPayload.user.id);
    expect(clearAccessTokenMock).not.toHaveBeenCalled();
    expect(resetWorkspacesMock).not.toHaveBeenCalled();
    expect(queryClientClearMock).not.toHaveBeenCalled();
    expect(logoutMutateMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('does not erase a new login when the old revocation response arrives late', async () => {
    const auth = await authenticated();
    let finish = () => {};
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = auth.current.runSessionRevocation(
        () =>
          new Promise<void>(resolve => {
            finish = resolve;
          })
      );
    });
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'puntovivo:staff-handoff',
          newValue: 'new-operator',
        })
      );
    });
    loginMutateMock.mockResolvedValue({ token: 'new-user-token' });
    meQueryMock.mockResolvedValue({
      ...sessionPayload,
      user: { ...sessionPayload.user, id: 'u2', role: 'cashier' },
    });
    await act(() => auth.current.login({ email: 'cashier@example.test', password: 'secret' }));
    const clears = clearAccessTokenMock.mock.calls.length;
    const resets = resetWorkspacesMock.mock.calls.length;
    const navigation = navigateMock.mock.calls.length;
    await act(async () => {
      finish();
      await expect(pending).resolves.toBe(false);
    });
    expect(auth.current.user?.id).toBe('u2');
    expect(clearAccessTokenMock).toHaveBeenCalledTimes(clears);
    expect(resetWorkspacesMock).toHaveBeenCalledTimes(resets);
    expect(navigateMock).toHaveBeenCalledTimes(navigation);
  });

  it('clears renderer authority immediately and awaits sealed Hub cleanup before reentry', async () => {
    const auth = await authenticated();
    hubModeMock.mockReturnValue(true);
    let finish = () => {};
    clearHubMock.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = auth.current.runSessionRevocation(async () => ({ success: true }));
    });
    expect(auth.current.isAuthenticated).toBe(false);
    expect(auth.current.isLoading).toBe(true);
    expect(resetWorkspacesMock).toHaveBeenCalledOnce();
    expect(clearHubMock).toHaveBeenCalledOnce();
    expect(navigateMock).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await pending;
    });
    expect(auth.current.isLoading).toBe(false);
    expect(navigateMock).toHaveBeenLastCalledWith('/login');
    expect(logoutMutateMock).not.toHaveBeenCalled();
  });

  it('finishes local teardown despite storage and revoked-credential bridge failures', async () => {
    const auth = await authenticated();
    hubModeMock.mockReturnValue(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storageError = new DOMException('Storage unavailable', 'SecurityError');
    clearSessionMock.mockImplementation(() => {
      throw storageError;
    });
    resetWorkspacesMock.mockImplementation(() => {
      throw storageError;
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw storageError;
    });
    clearHubMock.mockRejectedValue(new Error('Bridge unavailable'));
    await act(async () => {
      await expect(
        auth.current.runSessionRevocation(async () => ({ success: true }))
      ).resolves.toBe(true);
    });
    expect(auth.current.isAuthenticated).toBe(false);
    expect(auth.current.isLoading).toBe(false);
    expect(clearAccessTokenMock).toHaveBeenCalledOnce();
    expect(queryClientClearMock).toHaveBeenCalledOnce();
    expect(resetWorkspacesMock).toHaveBeenCalledOnce();
    expect(clearCustomerDisplayMock).toHaveBeenCalledOnce();
    expect(clearHubMock).toHaveBeenCalledOnce();
    expect(logoutMutateMock).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenLastCalledWith('/login');
    expect(warn).toHaveBeenCalledTimes(4);
  });
});

describe('AuthProvider — logout flow', () => {
  it('fences unmount work before sending logout without clearing its authority early', async () => {
    refreshMutateMock.mockResolvedValue({ token: 'tok-1' });
    meQueryMock.mockResolvedValue(sessionPayload);
    const committed = createDeferred<void>();
    logoutMutateMock.mockReturnValue(committed.promise);
    const { result: auth } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(auth.current.isAuthenticated).toBe(true));
    clearAccessTokenMock.mockClear();
    let pending!: Promise<void>;
    act(() => {
      pending = auth.current.logout();
    });
    expect(auth.current.isLoading).toBe(true);
    expect(invalidateAuthSessionWorkMock).toHaveBeenCalledOnce();
    expect(invalidateAuthSessionWorkMock.mock.invocationCallOrder[0]).toBeLessThan(
      logoutMutateMock.mock.invocationCallOrder[0]!
    );
    expect(clearAccessTokenMock).not.toHaveBeenCalled();
    await act(async () => {
      committed.resolve();
      await pending;
    });
    expect(clearAccessTokenMock).toHaveBeenCalledOnce();
    expect(auth.current.isAuthenticated).toBe(false);
  });

  it('clears local state and navigates to /login on success', async () => {
    refreshMutateMock.mockResolvedValue({ token: 'tok-1' });
    meQueryMock.mockResolvedValue(sessionPayload);
    logoutMutateMock.mockResolvedValue(undefined);
    const clearDesktopSessionMock = vi.fn(async () => undefined);
    Object.defineProperty(window, 'session', {
      configurable: true,
      value: { clear: clearDesktopSessionMock },
    });
    window.localStorage.setItem('puntovivo:deviceId', 'registered-device-1');

    const { result: auth } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(auth.current.isAuthenticated).toBe(true));

    await act(async () => {
      await auth.current.logout();
    });
    expect(logoutMutateMock).toHaveBeenCalledOnce();
    expect(clearAccessTokenMock).toHaveBeenCalled();
    expect(clearDesktopSessionMock).toHaveBeenCalledOnce();
    expect(resetWorkspacesMock).toHaveBeenCalled();
    expect(resetQuickCreateMock).toHaveBeenCalled();
    expect(clearCustomerDisplayMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenLastCalledWith('/login');
    expect(auth.current.isAuthenticated).toBe(false);
    expect(window.localStorage.getItem('puntovivo:deviceId')).toBe('registered-device-1');
  });

  it('preserves owner-keyed workspaces when the server logout transaction fails', async () => {
    refreshMutateMock.mockResolvedValue({ token: 'tok-1' });
    meQueryMock.mockResolvedValue(sessionPayload);
    const failure = new Error('server down');
    logoutMutateMock.mockRejectedValue(failure);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result: auth } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(auth.current.isAuthenticated).toBe(true));

    await act(async () => {
      await auth.current.logout();
    });
    expect(clearAccessTokenMock).toHaveBeenCalled();
    expect(resetWorkspacesMock).not.toHaveBeenCalled();
    expect(resetQuickCreateMock).toHaveBeenCalled();
    expect(clearCustomerDisplayMock).toHaveBeenCalled();
    expect(queryClientClearMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenLastCalledWith('/login');
    expect(auth.current.isAuthenticated).toBe(false);
    expect(auth.current.error).toBe(failure);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'auth.logout server call failed; preserving draft recovery state:',
      failure
    );
  });
});

describe('AuthProvider — staff switch flow', () => {
  it('purges identity-owned state and installs the cashier only after the PIN succeeds', async () => {
    refreshMutateMock.mockResolvedValue({ token: 'tok-admin' });
    meQueryMock.mockResolvedValueOnce(sessionPayload).mockResolvedValueOnce({
      ...sessionPayload,
      user: {
        ...sessionPayload.user,
        id: 'cashier-2',
        email: 'cashier@example.com',
        name: 'Cashier Two',
        role: 'cashier' as const,
      },
    });
    switchStaffMutateMock.mockResolvedValue({
      token: 'tok-cashier',
      sessionExpiresAt: '2026-07-14T20:00:00.000Z',
    });
    const clearDesktopSessionMock = vi.fn(async () => undefined);
    const registerDesktopSessionMock = vi.fn(async () => ({ ok: true as const }));
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        session: {
          clear: clearDesktopSessionMock,
          register: registerDesktopSessionMock,
        },
      },
    });

    const { result: auth } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(auth.current.user?.role).toBe('admin'));

    await act(async () => {
      await auth.current.switchStaff({ targetUserId: 'cashier-2', pin: '246810' });
    });

    expect(switchStaffMutateMock).toHaveBeenCalledWith({
      targetUserId: 'cashier-2',
      pin: '246810',
    });
    expect(clearAccessTokenMock).toHaveBeenCalled();
    expect(resetWorkspacesMock).toHaveBeenCalled();
    expect(resetQuickCreateMock).toHaveBeenCalled();
    expect(clearCustomerDisplayMock).toHaveBeenCalled();
    expect(queryClientClearMock).toHaveBeenCalled();
    expect(clearDesktopSessionMock).toHaveBeenCalledOnce();
    expect(registerDesktopSessionMock).toHaveBeenLastCalledWith('tok-cashier');
    expect(clearDesktopSessionMock.mock.invocationCallOrder[0]).toBeLessThan(
      registerDesktopSessionMock.mock.invocationCallOrder.at(-1)!
    );
    expect(setAccessTokenMock).toHaveBeenLastCalledWith('tok-cashier');
    expect(window.localStorage.getItem('puntovivo:staff-handoff')).toBe(
      'cashier-2:2026-07-14T20:00:00.000Z'
    );
    expect(auth.current.user).toMatchObject({ id: 'cashier-2', role: 'cashier' });
    expect(navigateMock).toHaveBeenLastCalledWith('/sales');
  });

  it('invalidates the privileged identity in other tabs without racing Electron registration', async () => {
    refreshMutateMock.mockResolvedValue({ token: 'tok-admin' });
    meQueryMock.mockResolvedValue(sessionPayload);
    const clearDesktopSessionMock = vi.fn(async () => undefined);
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { session: { clear: clearDesktopSessionMock } },
    });

    const { result: auth } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(auth.current.user?.role).toBe('admin'));
    clearAccessTokenMock.mockClear();
    clearSessionMock.mockClear();
    clearDesktopSessionMock.mockClear();

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'puntovivo:staff-handoff',
          newValue: 'cashier-2:2026-07-14T20:00:00.000Z',
        })
      );
    });

    expect(clearAccessTokenMock).toHaveBeenCalledOnce();
    expect(auth.current.isAuthenticated).toBe(false);
    expect(queryClientClearMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenLastCalledWith('/login');
    expect(clearSessionMock).not.toHaveBeenCalled();
    expect(clearDesktopSessionMock).not.toHaveBeenCalled();
  });

  it('leaves the current identity and caches intact when PIN verification fails', async () => {
    refreshMutateMock.mockResolvedValue({ token: 'tok-admin' });
    meQueryMock.mockResolvedValue(sessionPayload);
    const failure = new Error('bad PIN');
    switchStaffMutateMock.mockRejectedValue(failure);

    const { result: auth } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(auth.current.user?.role).toBe('admin'));

    let caught: unknown;
    await act(async () => {
      try {
        await auth.current.switchStaff({ targetUserId: 'cashier-2', pin: '111111' });
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBe(failure);
    expect(auth.current.user?.role).toBe('admin');
    expect(clearAccessTokenMock).not.toHaveBeenCalled();
    expect(queryClientClearMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalledWith('/login');
  });
});

describe('AuthProvider — session expiry hook', () => {
  it('registers and unregisters the session-expired handler', async () => {
    refreshMutateMock.mockRejectedValue(
      new TRPCClientError('You must be logged in to perform this action')
    );
    const { unmount } = render(wrap({ children: <span /> }));
    await waitFor(() => {
      expect(setSessionExpiredHandlerMock).toHaveBeenCalled();
    });
    // First registration is the live handler; subsequent ones are
    // implementation details.
    const firstArg = setSessionExpiredHandlerMock.mock.calls[0]?.[0];
    expect(typeof firstArg).toBe('function');
    unmount();
    expect(setSessionExpiredHandlerMock).toHaveBeenLastCalledWith(null);
  });

  it('clears local session and navigates to /login when the handler fires', async () => {
    refreshMutateMock.mockResolvedValue({ token: 'tok-1' });
    meQueryMock.mockResolvedValue(sessionPayload);

    const { result: auth } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(auth.current.isAuthenticated).toBe(true));

    const lastHandler =
      setSessionExpiredHandlerMock.mock.calls[
        setSessionExpiredHandlerMock.mock.calls.length - 1
      ]?.[0];
    expect(typeof lastHandler).toBe('function');
    await act(async () => {
      lastHandler();
    });
    expect(auth.current.isAuthenticated).toBe(false);
    expect(resetWorkspacesMock).not.toHaveBeenCalled();
    expect(resetQuickCreateMock).toHaveBeenCalled();
    expect(clearCustomerDisplayMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenLastCalledWith('/login');
  });
});

describe('AuthProvider — mapSession edge cases', () => {
  it('handles a session payload with tenant=null without crashing', async () => {
    refreshMutateMock.mockResolvedValue({ token: 'tok-1' });
    meQueryMock.mockResolvedValue({
      user: sessionPayload.user,
      tenant: null,
    });

    const { result: auth } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(auth.current.isAuthenticated).toBe(true));
    expect(auth.current.tenant).toBeNull();
  });

  it('merges DEFAULT_TENANT_SETTINGS with the server tenant.settings (server overrides defaults)', async () => {
    refreshMutateMock.mockResolvedValue({ token: 'tok-1' });
    meQueryMock.mockResolvedValue({
      user: sessionPayload.user,
      tenant: {
        ...sessionPayload.tenant,
        settings: { taxRate: 19 },
      },
    });

    const { result: auth } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(auth.current.isAuthenticated).toBe(true));
    // this used to assert currency=USD / timezone=UTC, pinning a
    // default that nothing read and that was wrong for every LATAM tenant.
    // What the merge actually has to guarantee is that the server's blob
    // wins over the local baseline, which taxRate proves.
    expect(auth.current.tenant?.settings.taxRate).toBe(19);
    // And that the surviving baseline key is still readable when the server
    // omits it ( depends on this).
    expect(auth.current.tenant?.settings.restaurant?.serviceChargeRate).toBe(0);
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}
