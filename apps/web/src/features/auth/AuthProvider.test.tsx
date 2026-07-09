import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TRPCClientError } from '@trpc/client';
import type { ReactNode } from 'react';

const {
  navigateMock,
  setAccessTokenMock,
  clearAccessTokenMock,
  setSessionExpiredHandlerMock,
  persistSessionMock,
  clearSessionMock,
  resetWorkspacesMock,
  resetQuickCreateMock,
  refreshMutateMock,
  meQueryMock,
  loginMutateMock,
  logoutMutateMock,
  healthCheckMock,
  queryClientClearMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  setAccessTokenMock: vi.fn(),
  clearAccessTokenMock: vi.fn(),
  setSessionExpiredHandlerMock: vi.fn(),
  persistSessionMock: vi.fn(),
  clearSessionMock: vi.fn(),
  resetWorkspacesMock: vi.fn(),
  resetQuickCreateMock: vi.fn(),
  refreshMutateMock: vi.fn(),
  meQueryMock: vi.fn(),
  loginMutateMock: vi.fn(),
  logoutMutateMock: vi.fn(),
  healthCheckMock: vi.fn(),
  queryClientClearMock: vi.fn(),
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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/lib/trpc', () => ({
  setAccessToken: setAccessTokenMock,
  clearAccessToken: clearAccessTokenMock,
  setAuthSessionExpiredHandler: setSessionExpiredHandlerMock,
  vanillaClient: {
    health: { check: { query: () => healthCheckMock() } },
    auth: {
      refresh: { mutate: () => refreshMutateMock() },
      me: { query: () => meQueryMock() },
      login: { mutate: (input: unknown) => loginMutateMock(input) },
      logout: { mutate: () => logoutMutateMock() },
    },
  },
}));

vi.mock('./authStorage', () => ({
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

import { AuthProvider, useAuth } from './AuthProvider';

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
  navigateMock.mockReset();
  setAccessTokenMock.mockReset();
  clearAccessTokenMock.mockReset();
  setSessionExpiredHandlerMock.mockReset();
  persistSessionMock.mockReset();
  clearSessionMock.mockReset();
  resetWorkspacesMock.mockReset();
  resetQuickCreateMock.mockReset();
  refreshMutateMock.mockReset();
  meQueryMock.mockReset();
  loginMutateMock.mockReset();
  logoutMutateMock.mockReset();
  healthCheckMock.mockReset().mockResolvedValue({ ok: true });
  queryClientClearMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.session;
});

describe('useAuth — context guard', () => {
  it('throws a clear error when used outside an AuthProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(/useAuth must be used within AuthProvider/);
    consoleSpy.mockRestore();
  });
});

describe('AuthProvider — bootstrap', () => {
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
    expect(resetWorkspacesMock).toHaveBeenCalled();
    expect(resetQuickCreateMock).toHaveBeenCalled();
    expect(queryClientClearMock).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('logs to console and clears session for non-UNAUTHORIZED bootstrap failures', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('network down');
    refreshMutateMock.mockRejectedValue(err);

    function Probe() {
      const auth = useAuth();
      return <span data-testid="auth">{auth.isAuthenticated ? 'yes' : 'no'}</span>;
    }
    render(wrap({ children: <Probe /> }));
    await waitFor(() => {
      expect(screen.getByTestId('auth')).toHaveTextContent('no');
    });
    expect(consoleSpy).toHaveBeenCalledWith('Auth init error:', err);
    expect(clearAccessTokenMock).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('AuthProvider — login flow', () => {
  it('on success persists token, fetches the session, and navigates per role', async () => {
    refreshMutateMock.mockRejectedValue(
      new TRPCClientError('You must be logged in to perform this action')
    );
    loginMutateMock.mockResolvedValue({ token: 'tok-login' });
    meQueryMock.mockResolvedValue({
      ...sessionPayload,
      user: { ...sessionPayload.user, role: 'cashier' as const },
    });

    let auth!: ReturnType<typeof useAuth>;
    function Probe() {
      auth = useAuth();
      return null;
    }
    render(wrap({ children: <Probe /> }));
    await waitFor(() => expect(auth.isLoading).toBe(false));

    await act(async () => {
      await auth.login({ email: 'a@b.com', password: 'pwd' });
    });
    expect(loginMutateMock).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pwd',
    });
    expect(setAccessTokenMock).toHaveBeenCalledWith('tok-login');
    expect(navigateMock).toHaveBeenCalledWith('/sales');
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.user?.role).toBe('cashier');
  });

  it('on failure stores the error and rethrows so the caller can render translated copy', async () => {
    refreshMutateMock.mockRejectedValue(
      new TRPCClientError('You must be logged in to perform this action')
    );
    const failure = new Error('bad password');
    loginMutateMock.mockRejectedValue(failure);

    let auth!: ReturnType<typeof useAuth>;
    function Probe() {
      auth = useAuth();
      return null;
    }
    render(wrap({ children: <Probe /> }));
    await waitFor(() => expect(auth.isLoading).toBe(false));

    let captured: unknown = null;
    await act(async () => {
      try {
        await auth.login({ email: 'a@b.com', password: 'pwd' });
      } catch (err) {
        captured = err;
      }
    });
    expect(captured).toBe(failure);
    await waitFor(() => expect(auth.error).toBe(failure));
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe('AuthProvider — logout flow', () => {
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

    let auth!: ReturnType<typeof useAuth>;
    function Probe() {
      auth = useAuth();
      return null;
    }
    render(wrap({ children: <Probe /> }));
    await waitFor(() => expect(auth.isAuthenticated).toBe(true));

    await act(async () => {
      await auth.logout();
    });
    expect(logoutMutateMock).toHaveBeenCalledOnce();
    expect(clearAccessTokenMock).toHaveBeenCalled();
    expect(clearDesktopSessionMock).toHaveBeenCalledOnce();
    expect(resetWorkspacesMock).toHaveBeenCalled();
    expect(resetQuickCreateMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenLastCalledWith('/login');
    expect(auth.isAuthenticated).toBe(false);
    expect(window.localStorage.getItem('puntovivo:deviceId')).toBe('registered-device-1');
  });

  it('clears local state and navigates even when the server logout call fails', async () => {
    refreshMutateMock.mockResolvedValue({ token: 'tok-1' });
    meQueryMock.mockResolvedValue(sessionPayload);
    logoutMutateMock.mockRejectedValue(new Error('server down'));

    let auth!: ReturnType<typeof useAuth>;
    function Probe() {
      auth = useAuth();
      return null;
    }
    render(wrap({ children: <Probe /> }));
    await waitFor(() => expect(auth.isAuthenticated).toBe(true));

    await act(async () => {
      await auth.logout();
    });
    expect(clearAccessTokenMock).toHaveBeenCalled();
    expect(resetQuickCreateMock).toHaveBeenCalled();
    expect(queryClientClearMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenLastCalledWith('/login');
    expect(auth.isAuthenticated).toBe(false);
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

    let auth!: ReturnType<typeof useAuth>;
    function Probe() {
      auth = useAuth();
      return null;
    }
    render(wrap({ children: <Probe /> }));
    await waitFor(() => expect(auth.isAuthenticated).toBe(true));

    const lastHandler =
      setSessionExpiredHandlerMock.mock.calls[
        setSessionExpiredHandlerMock.mock.calls.length - 1
      ]?.[0];
    expect(typeof lastHandler).toBe('function');
    await act(async () => {
      lastHandler();
    });
    expect(auth.isAuthenticated).toBe(false);
    expect(resetQuickCreateMock).toHaveBeenCalled();
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

    let auth!: ReturnType<typeof useAuth>;
    function Probe() {
      auth = useAuth();
      return null;
    }
    render(wrap({ children: <Probe /> }));
    await waitFor(() => expect(auth.isAuthenticated).toBe(true));
    expect(auth.tenant).toBeNull();
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

    let auth!: ReturnType<typeof useAuth>;
    function Probe() {
      auth = useAuth();
      return null;
    }
    render(wrap({ children: <Probe /> }));
    await waitFor(() => expect(auth.isAuthenticated).toBe(true));
    // The ENG-017 default has currency=USD/timezone=UTC; the server's
    // taxRate=19 overrides the default 0.
    expect(auth.tenant?.settings.currency).toBe('USD');
    expect(auth.tenant?.settings.timezone).toBe('UTC');
    expect(auth.tenant?.settings.taxRate).toBe(19);
  });
});
