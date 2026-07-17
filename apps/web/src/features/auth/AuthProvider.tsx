import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { TRPCClientError } from '@trpc/client';
import { useQueryClient } from '@tanstack/react-query';
import type { User, Tenant, LoginCredentials } from '@/types';
import {
  clearAccessToken,
  setAccessToken,
  setAuthSessionExpiredHandler,
  vanillaClient,
} from '@/lib/trpc';
import { isNetworkConnectivityError } from '@/lib/translateServerError';
import { primeDeviceIdCache, readDeviceId, storeDeviceId } from '@/lib/deviceId';
import { getRuntimeConfigSync } from '@/lib/runtimeConfigClient';
import { clearAuthSession, persistAuthSession } from './authStorage';
import { getDefaultRouteForRole, getDefaultRouteForRoleWithSetup } from './roleAccess';
import { useCartWorkspaceStore } from '@/features/sales/useCartWorkspaceStore';
import { useQuickCreateStore } from '@/features/sales/useQuickCreateStore';
import { setActiveTenantId } from '@/lib/observability';

interface AuthContextType {
  user: User | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * The raw error from the most recent failed auth operation, or null when
   * the last call succeeded. Locale-agnostic so consumers can render it via
   * `translateServerError` against the active i18n locale.
   */
  error: unknown;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

// ENG-017 — `currency`, `timezone`, and `dateFormat` no longer live in the
// tenant JSON blob; they are resolved by `LocaleProvider` against
// `tenant_locale_settings` and the global catalogs. Kept `taxRate` as a
// neutral default because credit-sale / discount flows still key off the
// JSON blob until that feature retires.
// ENG-221 — the three locale keys used to be defaulted here anyway, to
// USD / UTC / YYYY-MM-DD. Nothing read them, but the values were wrong for
// every tenant this product sells to, so any future reader would have
// silently priced a Colombian shop in dollars. Removed together with the
// fields on `TenantSettings`: the honest way to say "resolved elsewhere" is
// to not be here at all.
// ENG-039d3 — `restaurant.serviceChargeRate` baseline (0 = disabled)
// so `useTenant().tenantSettings.restaurant?.serviceChargeRate` is
// always readable. Real value flows from the admin Company tab.
const DEFAULT_TENANT_SETTINGS: Tenant['settings'] = {
  taxRate: 0,
  restaurant: {
    serviceChargeRate: 0,
  },
};

type AuthMePayload = Awaited<ReturnType<typeof vanillaClient.auth.me.query>>;

function mapSession(payload: AuthMePayload): { user: User; tenant: Tenant | null } {
  const { user, tenant } = payload;

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    tenant: tenant
      ? {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          settings: {
            ...DEFAULT_TENANT_SETTINGS,
            ...(tenant.settings ?? {}),
          },
          createdAt: tenant.createdAt,
          updatedAt: tenant.updatedAt,
        }
      : null,
  };
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ENG-171 — stable identity (only stable refs inside: module helpers,
  // store getState, and useState setters) so `logout` can list it as a
  // dependency without invalidating its own useCallback every render.
  const clearLocalSession = useCallback(() => {
    clearAccessToken();
    clearAuthSession();
    // ENG-018b — drop any parked multi-cart workspaces so a new cashier
    // signing in on the same machine never sees the previous user's
    // drafts. The ownerKey filter also prevents rendering, but clearing
    // the localStorage entry avoids the stale data sitting on disk.
    useCartWorkspaceStore.getState().resetAllWorkspaces();
    // ENG-105c — quick-create requests are one-shot UI intents. Clear
    // them with the session so a different user never inherits an
    // in-flight product/customer modal after logout or token expiry.
    useQuickCreateStore.getState().reset();
    // Authenticated tRPC query keys do not include the current user because
    // identity comes from the access token. Purge every server-derived cache
    // entry on logout/expiry so the next operator cannot briefly inherit the
    // previous user's cash session, sales, or tenant data on a shared POS.
    queryClient.clear();
    // ENG-025 — clear the desktop session singleton so the main
    // process IPC handlers reject any subsequent db:* / sync:* call
    // until the next successful login. Best-effort: any failure here
    // does not block the local cleanup. window.api is undefined in
    // pure-browser mode (no IPC bridge to clear).
    void window.api?.session?.clear?.().catch(err => {
      console.warn('Desktop session clear failed during logout:', err);
    });
    setUser(null);
    setTenant(null);
    setError(null);
    // ENG-135 — drop the cached tenantId used by window-level error
    // listeners. Anonymous captures from then on emit with
    // `tenantId: null`.
    setActiveTenantId(null);
  }, [queryClient]);

  const handleAuthSessionExpired = useEffectEvent(() => {
    clearLocalSession();
    setIsLoading(false);
    navigate('/login');
  });

  useEffect(() => {
    setAuthSessionExpiredHandler(() => {
      handleAuthSessionExpired();
    });

    return () => {
      setAuthSessionExpiredHandler(null);
    };
  }, []);

  // Check for existing auth on mount
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      // ENG-052 — restore the cached device id from local storage
      // (or Electron userData) before any tRPC call runs. The cache
      // backs `getTrpcHeaders()` synchronously so the first
      // post-refresh request already ships `x-device-id`. Failures
      // here are non-fatal: login() re-runs auth.registerDevice if
      // the cache stays empty, but the operator should know the
      // pre-login id was lost so the next session starts cleanly.
      try {
        await primeDeviceIdCache();
      } catch (err) {
        console.warn('Device id cache prime failed during AuthProvider boot:', err);
      }
      try {
        await vanillaClient.health.check.query();
        const refreshResult = await vanillaClient.auth.refresh.mutate();
        setAccessToken(refreshResult.token);
        // ENG-025 — register the rotated access token with the
        // desktop session singleton so the IPC bridge handlers can
        // derive tenantId server-side. No-op in pure-browser mode.
        // Best-effort: a register failure means the bridge stays
        // closed (handlers throw SESSION_NOT_REGISTERED) but tRPC
        // still works.
        try {
          await window.api?.session?.register?.(refreshResult.token);
        } catch (registerErr) {
          console.warn('Desktop session register failed during init:', registerErr);
        }
        const session = mapSession(await vanillaClient.auth.me.query());
        persistAuthSession(session);

        if (!isMounted) {
          return;
        }

        setUser(session.user);
        setTenant(session.tenant);
        setError(null);
        // ENG-135 — stamp the tenantId on the observability surface
        // so window-level error listeners can attribute crashes to
        // the right tenant.
        setActiveTenantId(session.user.tenantId);
      } catch (err) {
        const isUnauthorized =
          err instanceof TRPCClientError &&
          (err.data?.code === 'UNAUTHORIZED' ||
            err.message === 'You must be logged in to perform this action');

        if (!isUnauthorized && !isNetworkConnectivityError(err)) {
          console.error('Auth init error:', err);
        }

        if (!isMounted) {
          return;
        }

        clearLocalSession();
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initAuth();

    return () => {
      isMounted = false;
    };
    // ENG-171 — `clearLocalSession` is now a stable useCallback; listing it
    // keeps the mount-once semantics (stable ref → never re-runs) while
    // satisfying exhaustive-deps.
  }, [clearLocalSession]);

  const login = useCallback(
    async (credentials: LoginCredentials) => {
      setIsLoading(true);
      setError(null);

      try {
        const authData = await vanillaClient.auth.login.mutate({
          email: credentials.email,
          password: credentials.password,
        });
        setAccessToken(authData.token);
        // ENG-025 — bind the access token to the desktop session
        // singleton so subsequent IPC db:*/sync:* calls can derive
        // tenantId server-side. No-op in pure-browser mode.
        try {
          await window.api?.session?.register?.(authData.token);
        } catch (registerErr) {
          console.warn('Desktop session register failed during login:', registerErr);
        }

        // ENG-052 — register the device with the active tenant before
        // any critical mutation runs. The server-issued id is cached
        // synchronously so `getTrpcHeaders()` ships `x-device-id` on
        // every subsequent request. Failures here only block critical
        // mutations (catalog reads + non-critical writes still work),
        // so we log the warning and keep the login succeeding.
        try {
          const existing = await readDeviceId();
          const isElectron =
            typeof window !== 'undefined' &&
            Boolean((window as unknown as { electron?: unknown }).electron);
          // ENG-074 — discriminate hub_client terminals so the
          // Operations Center Authority tab (ENG-075) can render
          // which devices are hub clients vs full local installs.
          // Reading the runtime config is cheap (cached at module
          // init) and a no-op for the pure-web build (returns
          // device_local).
          const runtimeConfig = getRuntimeConfigSync();
          const runtimeMode = runtimeConfig.authorityMode;
          const kind: 'desktop' | 'web' | 'hub_client' = isElectron
            ? runtimeMode === 'hub_client'
              ? 'hub_client'
              : 'desktop'
            : 'web';
          const friendlyName =
            kind === 'hub_client'
              ? `puntovivo-hub-client-${navigator.platform || 'unknown'}`
              : isElectron
                ? `puntovivo-desktop-${navigator.platform || 'unknown'}`
                : `puntovivo-web-${navigator.platform || navigator.userAgent.slice(0, 40)}`;
          const appVersion = isElectron
            ? await window.api?.getAppVersion?.().catch(() => null)
            : null;
          const result = await vanillaClient.auth.registerDevice.mutate({
            kind,
            name: friendlyName,
            deviceId: existing ?? undefined,
            siteId: runtimeConfig.siteId ?? undefined,
            appVersion,
            metadata: {
              authorityMode: runtimeMode,
              platform: navigator.platform || null,
              ...(isElectron ? {} : { userAgent: navigator.userAgent }),
            },
          });
          await storeDeviceId(result.deviceId);
        } catch (deviceErr) {
          console.warn('Device registration failed during login:', deviceErr);
        }

        const session = mapSession(await vanillaClient.auth.me.query());

        persistAuthSession(session);
        setUser(session.user);
        setTenant(session.tenant);
        // ENG-135 — see init path; same tenant attribution applies on
        // an interactive login.
        setActiveTenantId(session.user.tenantId);

        // ENG-104 — Post-login routing considers setup readiness so
        // admins see the readiness checklist when there are unresolved
        // blockers. Defense in depth: any readiness error collapses to
        // the legacy default — a broken aggregator NEVER traps the
        // operator on a setup screen.
        let postLoginRoute = getDefaultRouteForRole(session.user.role);
        if (session.user.role === 'admin') {
          try {
            const readiness = await vanillaClient.setupReadiness.get.query();
            postLoginRoute = getDefaultRouteForRoleWithSetup({
              role: session.user.role,
              hasBlockers: readiness.blockerCount > 0,
              acknowledgedAt: readiness.acknowledgedAt,
            });
          } catch (readinessErr) {
            // Non-fatal — log + fall back to the role default.
            console.warn(
              'setupReadiness.get failed at login; using role default route',
              readinessErr
            );
          }
        }
        navigate(postLoginRoute);
      } catch (err) {
        // Store the raw error so consumers can translate it against the active
        // locale via `translateServerError`. The provider itself stays
        // locale-agnostic.
        setError(err);
        throw err;
      } finally {
        setIsLoading(false);
      }
      // ENG-171 — `navigate` is the only reactive dependency (react-router
      // returns a stable reference); every other ref is a module helper or a
      // stable useState setter, so the callback identity holds across renders.
    },
    [navigate]
  );

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await vanillaClient.auth.logout.mutate();
    } catch (err) {
      // Ignore the error for the user-facing flow — local state is
      // cleared in `finally` regardless — but log it so the operator
      // can diagnose offline-logout traces. The most common cause is
      // a network outage at logout time, which is a real condition,
      // not a bug.
      console.warn('auth.logout server call failed; clearing local state anyway:', err);
    } finally {
      // ENG-168 — clear the Electron main-process desktopSession
      // singleton so any subsequent `db:*` IPC call from the renderer
      // fails with UNAUTHORIZED. The bridge is exposed by the preload
      // (`apps/desktop/src/preload/index.ts:sessionAPI`) as
      // `window.session.clear()` and dispatches to the
      // `session:clear` handler registered by
      // `apps/desktop/src/main/index.ts`. In the pure web target the
      // bridge is undefined; the optional chain + try/catch keeps the
      // failure silent so a browser logout still completes cleanly.
      try {
        const sessionBridge = (
          window as unknown as {
            session?: { clear?: () => Promise<unknown> };
          }
        ).session;
        await sessionBridge?.clear?.();
      } catch (clearErr) {
        console.warn('session:clear IPC failed; web logout continuing:', clearErr);
      }
      clearLocalSession();
      setIsLoading(false);
      navigate('/login');
    }
  }, [clearLocalSession, navigate]);

  // ENG-171 — memoize the context value so the 52 `useAuth` consumers only
  // re-render when an auth field actually changes, not on every incidental
  // AuthProvider render. `login` + `logout` are now stable useCallbacks.
  const value = useMemo<AuthContextType>(
    () => ({
      user,
      tenant,
      isAuthenticated: !!user,
      isLoading,
      login,
      logout,
      error,
    }),
    [user, tenant, isLoading, login, logout, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
