import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { User, Tenant, LoginCredentials, TenantSettings } from '@/types';
import {
  clearAccessToken,
  invalidateAuthSessionWork,
  setAccessToken,
  setAuthSessionExpiredHandler,
  vanillaClient,
} from '@/lib/trpc';
import { ensureApiBootstrap } from '@/lib/apiBootstrap';
import { primeDeviceIdCache, readDeviceId, storeDeviceId } from '@/lib/deviceId';
import { getRuntimeConfigSync } from '@/lib/runtimeConfigClient';
import {
  clearAuthSession,
  persistAuthSession,
  requireExplicitSignIn,
  isExplicitSignInRequired,
  allowSessionResumeAfterSignIn,
} from './authStorage';
import { clearAllCustomerDisplayProjections } from '@/features/surfaces/customerDisplayStorage';
import {
  authBootstrapRecovery,
  isUnauthorizedAuthFailure,
  isDeviceIdentityChanged,
  type AuthBootstrapRecovery,
} from './authBootstrapFailure';
import { refreshSessionOnce } from './bootSessionRefresh';
import {
  getDefaultRouteForRole,
  getDefaultRouteForRoleWithSetup,
  getCompanionLoginDestination,
} from './roleAccess';
import { useCartWorkspaceStore } from '@/features/sales/useCartWorkspaceStore';
import { useQuickCreateStore } from '@/features/sales/useQuickCreateStore';
import { setActiveTenantId } from '@/lib/observability';
import {
  clearHubSession,
  isHubClientAuth,
  loginToHub,
  logoutFromHub,
  refreshHubSession,
  switchHubStaff,
} from './hubAuthTransport';
import { AuthContext, type AuthContextType } from './AuthContext';

/**
 * Cross-document signal for shared-terminal identity handoffs. Access tokens
 * live in module memory, so another tab would otherwise retain the source
 * manager/admin token until its 15-minute expiry.
 */
const STAFF_HANDOFF_STORAGE_KEY = 'puntovivo:staff-handoff';

interface AuthProviderProps {
  children: ReactNode;
}

// `currency`, `timezone`, and `dateFormat` no longer live in the
// tenant JSON blob; they are resolved by `LocaleProvider` against
// `tenant_locale_settings` and the global catalogs. Kept `taxRate` as a
// neutral default because credit-sale / discount flows still key off the
// JSON blob until that feature retires.
// the three locale keys used to be defaulted here anyway, to
// USD / UTC / YYYY-MM-DD. Nothing read them, but the values were wrong for
// every tenant this product sells to, so any future reader would have
// silently priced a Colombian shop in dollars. Removed together with the
// fields on `TenantSettings`: the honest way to say "resolved elsewhere" is
// to not be here at all.
// `restaurant.serviceChargeRate` baseline (0 = disabled)
// so `useTenant().tenantSettings.restaurant?.serviceChargeRate` is
// always readable. Real value flows from the admin Company tab.
const DEFAULT_TENANT_SETTINGS: Tenant['settings'] = {
  taxRate: 0,
  restaurant: {
    serviceChargeRate: 0,
  },
};

type AuthMePayload = Awaited<ReturnType<typeof vanillaClient.auth.me.query>>;

function clearDesktopSession(): Promise<unknown> | undefined {
  return window.api?.session?.clear?.() ?? window.session?.clear?.();
}

function resumeDesktopSession(): Promise<{ token: string | null }> | undefined {
  return window.api?.session?.resume?.() ?? window.session?.resume?.();
}

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
  const [bootstrapRecovery, setBootstrapRecovery] = useState<AuthBootstrapRecovery | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [isChangingAccount, setIsChangingAccount] = useState(false);
  const [accountChangeFailed, setAccountChangeFailed] = useState(false);
  const bootInFlight = useRef(false);
  const bootGeneration = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // stable identity (only stable refs inside: module helpers,
  // store getState, and useState setters) so `logout` can list it as a
  // dependency without invalidating its own useCallback every render.
  const resetIdentityOwnedState = useCallback(
    (options: {
      clearVisibleSession: boolean;
      clearPersistedSession?: boolean;
      preserveWorkspaces?: boolean;
    }) => {
      if (options.clearPersistedSession !== false) {
        try {
          clearAuthSession();
        } catch (error) {
          // Tenant references are not authority. Inaccessible browser storage
          // must never prevent bearer, IPC, visible identity or cache teardown.
          console.warn('Stored auth metadata cleanup failed:', error);
        }
      }
      // After a confirmed server-side park, drop every local workspace so a
      // new cashier never inherits stale cart data. When logout/refresh fails,
      // keep the owner-keyed workspace as recovery evidence: the server could
      // not confirm parking and deleting both copies would strand reserved
      // stock. Other identities still cannot render an owner-mismatched cart.
      if (!options.preserveWorkspaces) {
        try {
          useCartWorkspaceStore.getState().resetAllWorkspaces();
        } catch (error) {
          // Zustand clears memory before persisting. A failed disk write must
          // not leave visible identity, other caches or IPC authority alive.
          console.warn('Parked workspace persistence cleanup failed:', error);
        }
      }
      // The public projection is never recovery evidence. Clear it on every
      // local identity teardown, including failed server logout, while the
      // owner-keyed draft remains available for a later authenticated retry.
      clearAllCustomerDisplayProjections();
      // quick-create requests are one-shot UI intents. Clear
      // them with the session so a different user never inherits an
      // in-flight product/customer modal after logout or token expiry.
      useQuickCreateStore.getState().reset();
      // Authenticated tRPC query keys do not include the current user because
      // identity comes from the access token. Purge every server-derived cache
      // entry on logout/expiry so the next operator cannot briefly inherit the
      // previous user's cash session, sales, or tenant data on a shared POS.
      queryClient.clear();
      if (options.clearVisibleSession) {
        setUser(null);
        setTenant(null);
        setError(null);
        setActiveTenantId(null);
      }
    },
    [queryClient]
  );

  const clearLocalSession = useCallback(
    (options?: { preserveWorkspaces?: boolean; clearDesktop?: boolean }) => {
      setBootstrapRecovery(null);
      clearAccessToken();
      resetIdentityOwnedState({
        clearVisibleSession: true,
        preserveWorkspaces: options?.preserveWorkspaces ?? false,
      });
      // clear the desktop session singleton so the main
      // process IPC handlers reject any subsequent db:* / sync:* call
      // until the next successful login. Best-effort: any failure here
      // does not block the local cleanup. window.api is undefined in
      // pure-browser mode (no IPC bridge to clear).
      if (options?.clearDesktop !== false) {
        void clearDesktopSession()?.catch(err => {
          console.warn('Desktop session clear failed during logout:', err);
        });
      }
    },
    [resetIdentityOwnedState]
  );

  const retryBootstrap = useCallback(() => {
    if (!bootstrapRecovery || bootInFlight.current || Date.now() < bootstrapRecovery.retryAt)
      return;
    bootInFlight.current = true;
    setAccountChangeFailed(false);
    setIsLoading(true);
    setBootAttempt(attempt => attempt + 1);
  }, [bootstrapRecovery]);

  const signInAfterRecovery = useCallback(async () => {
    if (!bootstrapRecovery || bootInFlight.current) return;
    bootInFlight.current = true;
    const generation = ++bootGeneration.current;
    setIsChangingAccount(true);
    setAccountChangeFailed(false);
    try {
      // Hub's sealed refresh credential is separate from the desktop singleton.
      // Forget it only for an explicit account change, not during an outage.
      if (isHubClientAuth()) await clearHubSession();
      else await clearDesktopSession();
      if (generation !== bootGeneration.current) return;
      // The browser's httpOnly cookie cannot be deleted offline by the renderer.
      // Persist only a deny-auto-resume intent until a fresh login is verified.
      requireExplicitSignIn();
      clearLocalSession({ preserveWorkspaces: true, clearDesktop: false });
      setIsLoading(false);
      navigate('/login', { replace: true, state: { from: location } });
    } catch {
      // Do not offer a new login while the old credential may still be resumable.
      if (generation === bootGeneration.current) setAccountChangeFailed(true);
    } finally {
      if (generation === bootGeneration.current) {
        bootInFlight.current = false;
        setIsChangingAccount(false);
      }
    }
  }, [bootstrapRecovery, clearLocalSession, location, navigate]);

  const finishRecoveredNavigation = useEffectEvent((role: User['role']) => {
    if (location.pathname === '/login') {
      navigate(getCompanionLoginDestination(role, location.state) ?? getDefaultRouteForRole(role), {
        replace: true,
      });
    }
  });

  const handleAuthSessionExpired = useEffectEvent(() => {
    bootGeneration.current += 1;
    bootInFlight.current = false;
    setIsChangingAccount(false);
    clearLocalSession({ preserveWorkspaces: true });
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

  useEffect(() => {
    const handleStaffHandoff = (event: StorageEvent) => {
      if (event.key !== STAFF_HANDOFF_STORAGE_KEY || event.newValue === null) {
        return;
      }

      bootGeneration.current += 1;
      bootInFlight.current = false;
      setIsChangingAccount(false);
      setBootstrapRecovery(null);
      // The initiating document does not receive its own storage event and
      // continues installing the target cashier. Other tabs must immediately
      // discard the previous identity, but must not clear Electron's shared
      // main-process singleton or shared persisted auth record: either could
      // race the initiating document while it installs the target cashier.
      clearAccessToken();
      resetIdentityOwnedState({
        clearVisibleSession: true,
        clearPersistedSession: false,
      });
      setIsLoading(false);
      navigate('/login');
    };

    window.addEventListener('storage', handleStaffHandoff);
    return () => window.removeEventListener('storage', handleStaffHandoff);
  }, [navigate, resetIdentityOwnedState]);

  // Check for existing auth on mount
  useEffect(() => {
    let isMounted = true;
    const generation = ++bootGeneration.current;
    const isCurrent = () => isMounted && generation === bootGeneration.current;
    bootInFlight.current = true;

    const initAuth = async () => {
      // restore the cached device id from local storage
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
      if (!isCurrent()) return;
      try {
        if (isExplicitSignInRequired()) {
          clearLocalSession({ preserveWorkspaces: true });
          return;
        }
        await ensureApiBootstrap({ retryAfterFailure: bootAttempt > 0 });
        if (!isCurrent()) return;
        let refreshResult: { token: string };
        if (isHubClientAuth()) {
          refreshResult = await refreshHubSession();
        } else {
          // A packaged or development Electron renderer is intentionally not
          // cookie-same-site with its loopback authority. Resume the already
          // verified, memory-only desktop token across a renderer reload;
          // browsers keep using the httpOnly refresh-cookie path.
          const resumed = await resumeDesktopSession();
          refreshResult =
            resumed?.token !== null && resumed?.token !== undefined
              ? { token: resumed.token }
              : await refreshSessionOnce();
        }
        if (!isCurrent()) return;
        setAccessToken(refreshResult.token);
        // register the rotated access token with the
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
        if (!isCurrent()) return;
        const session = mapSession(await vanillaClient.auth.me.query());
        if (!isCurrent()) return;
        persistAuthSession(session);
        setBootstrapRecovery(null);

        setUser(session.user);
        setTenant(session.tenant);
        setError(null);
        // stamp the tenantId on the observability surface
        // so window-level error listeners can attribute crashes to
        // the right tenant.
        setActiveTenantId(session.user.tenantId);
        if (bootAttempt > 0) finishRecoveredNavigation(session.user.role);
      } catch (err) {
        if (!isCurrent()) return;
        if (isUnauthorizedAuthFailure(err)) {
          clearLocalSession({ preserveWorkspaces: true });
        } else {
          // A transport failure is not revoked authority. Hide all identity-owned
          // data and bearer access, but preserve the refresh credential/verified
          // desktop singleton for an explicit, server-verified retry. Owner-keyed
          // carts remain recovery evidence, never permission to render a sale.
          clearAccessToken();
          resetIdentityOwnedState({ clearVisibleSession: true, preserveWorkspaces: true });
          setBootstrapRecovery(authBootstrapRecovery(err));
        }
      } finally {
        if (isCurrent()) {
          bootInFlight.current = false;
          setIsLoading(false);
        }
      }
    };

    initAuth();

    return () => {
      isMounted = false;
      bootGeneration.current += 1;
    };
    // `clearLocalSession` is now a stable useCallback; listing it
    // keeps the mount-once semantics (stable ref → never re-runs) while
    // satisfying exhaustive-deps.
  }, [bootAttempt, clearLocalSession, resetIdentityOwnedState]);

  const login = useCallback(
    async (credentials: LoginCredentials) => {
      const generation = ++bootGeneration.current;
      const isCurrent = () => generation === bootGeneration.current;
      setIsLoading(true);
      setError(null);

      try {
        // Fail before issuing credentials if reload cannot be kept signed out
        // after a rejected terminal adoption. Teardown must not depend on writes.
        requireExplicitSignIn();
        // Explicit account change can skip auto-resume, but unsafe login still
        // needs the shared safe bootstrap to establish the CSRF cookie first.
        await ensureApiBootstrap({ retryAfterFailure: true });
        if (!isCurrent()) return;
        const authData = isHubClientAuth()
          ? await loginToHub({
              email: credentials.email,
              password: credentials.password,
            })
          : await vanillaClient.auth.login.mutate({
              email: credentials.email,
              password: credentials.password,
            });
        if (!isCurrent()) return;
        setAccessToken(authData.token);
        // bind the access token to the desktop session
        // singleton so subsequent IPC db:*/sync:* calls can derive
        // tenantId server-side. No-op in pure-browser mode.
        try {
          await window.api?.session?.register?.(authData.token);
        } catch (registerErr) {
          console.warn('Desktop session register failed during login:', registerErr);
        }

        if (!isCurrent()) return;
        // register the device with the active tenant before
        // any critical mutation runs. The server-issued id is cached
        // synchronously so `getTrpcHeaders()` ships `x-device-id` on
        // every subsequent request. Failures here only block critical
        // mutations (catalog reads + non-critical writes still work),
        // so we log the warning and keep the login succeeding.
        try {
          const existing = await readDeviceId();
          if (!isCurrent()) return;
          const isElectron =
            typeof window !== 'undefined' &&
            Boolean((window as unknown as { electron?: unknown }).electron);
          // discriminate hub_client terminals so the
          // Operations Center Authority tab () can render
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
          if (!isCurrent()) return;
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
          if (!isCurrent()) return;
          await storeDeviceId(result.deviceId);
        } catch (deviceErr) {
          if (isDeviceIdentityChanged(deviceErr)) throw deviceErr;
          console.warn('Device registration failed during login:', deviceErr);
        }

        if (!isCurrent()) return;
        const session = mapSession(await vanillaClient.auth.me.query());
        if (!isCurrent()) return;

        // Opening /login does not discard the refresh cookie, so boot may have
        // resumed another identity behind this form and cached its tenant reads
        // (sites, modules, pricing, locale). Query keys carry no identity: purge
        // them in the same tick the verified identity renders, or the new tenant
        // starts from the previous tenant's still-fresh cache. Owner-keyed carts
        // stay recovery evidence, and the tenant reference is rewritten below.
        resetIdentityOwnedState({
          clearVisibleSession: false,
          clearPersistedSession: false,
          preserveWorkspaces: true,
        });
        persistAuthSession(session);
        allowSessionResumeAfterSignIn();
        setUser(session.user);
        setTenant(session.tenant);
        // see init path; same tenant attribution applies on
        // an interactive login.
        setActiveTenantId(session.user.tenantId);

        // Post-login routing considers setup readiness so
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
        // Preserve the dedicated read-only entry without briefly mounting the
        // broader dashboard. Accept only this exact internal destination;
        // arbitrary redirect URLs and cashier access remain disallowed.
        if (!isCurrent()) return;
        navigate(getCompanionLoginDestination(session.user.role, location.state) ?? postLoginRoute);
      } catch (err) {
        if (!isCurrent()) return;
        if (isDeviceIdentityChanged(err)) {
          // A new password login does not authorize silently taking over an
          // active terminal. Keep the prior owner's recoverable workspace.
          clearLocalSession({ preserveWorkspaces: true });
          if (isHubClientAuth()) {
            try {
              await clearHubSession();
            } catch (clearError) {
              console.warn('Store Hub clear failed after rejected device adoption:', clearError);
            }
          }
          if (!isCurrent()) return;
        }
        // Store the raw error so consumers can translate it against the active
        // locale via `translateServerError`. The provider itself stays
        // locale-agnostic.
        setError(err);
        throw err;
      } finally {
        if (isCurrent()) setIsLoading(false);
      }
      // The return destination belongs to this login navigation, not to a
      // persisted user preference or an untrusted external redirect URL.
    },
    [navigate, location.state, clearLocalSession, resetIdentityOwnedState]
  );

  const switchStaff = useCallback(
    async (input: { targetUserId: string; pin: string }) => {
      const generation = ++bootGeneration.current;
      const isCurrent = () => generation === bootGeneration.current;
      setError(null);

      // Do not mutate local identity until the server has verified the PIN.
      // A rejected attempt must leave the current operator fully intact.
      const authData = isHubClientAuth()
        ? await switchHubStaff(input)
        : await vanillaClient.auth.switchStaff.mutate(input);

      if (!isCurrent()) return;
      try {
        // Notify every other same-origin tab before this document installs the
        // cashier. The marker carries no credential and is unique per session
        // ceiling; storage events intentionally do not fire in this document.
        window.localStorage.setItem(
          STAFF_HANDOFF_STORAGE_KEY,
          `${input.targetUserId}:${authData.sessionExpiresAt ?? 'standard'}`
        );
        clearAccessToken();
        resetIdentityOwnedState({ clearVisibleSession: false });

        // await the old desktop singleton clear before registering
        // the new token. Fire-and-forget here can race and erase the cashier
        // session we just installed.
        try {
          await clearDesktopSession();
        } catch (clearErr) {
          console.warn('Desktop session clear failed during staff switch:', clearErr);
        }

        if (!isCurrent()) return;
        setAccessToken(authData.token);
        try {
          await window.api?.session?.register?.(authData.token);
        } catch (registerErr) {
          console.warn('Desktop session register failed during staff switch:', registerErr);
        }

        if (!isCurrent()) return;
        const session = mapSession(await vanillaClient.auth.me.query());
        if (!isCurrent()) return;
        persistAuthSession(session);
        setUser(session.user);
        setTenant(session.tenant);
        setActiveTenantId(session.user.tenantId);
        navigate(getDefaultRouteForRole(session.user.role));
      } catch (err) {
        if (!isCurrent()) return;
        // The server already replaced the httpOnly refresh cookie. Keeping the
        // old UI identity after a local adoption failure would create a split
        // brain, so fail closed to the full login screen.
        if (isHubClientAuth()) {
          try {
            await clearHubSession();
          } catch (clearErr) {
            console.warn('Store Hub session clear failed after staff handoff:', clearErr);
          }
        }
        if (!isCurrent()) return;
        clearLocalSession();
        navigate('/login');
        setError(err);
        throw err;
      }
    },
    [clearLocalSession, navigate, resetIdentityOwnedState]
  );

  const logout = useCallback(async () => {
    const generation = ++bootGeneration.current;
    const isCurrent = () => generation === bootGeneration.current;
    // Loading unmounts task screens before the server response. Fence their
    // cleanup work first, but retain the bearer needed to park drafts/logout.
    invalidateAuthSessionWork();
    setIsLoading(true);
    let parkingCommitted = false;
    try {
      if (isHubClientAuth()) {
        await logoutFromHub();
      } else {
        await vanillaClient.auth.logout.mutate();
      }
      parkingCommitted = true;
    } catch (err) {
      if (!isCurrent()) return;
      // Local auth still closes fail-safe, but the owner-keyed workspace (and
      // Hub refresh credential in Electron main) must survive until the same
      // operator can reconnect. The server transaction may have rolled back,
      // leaving an active claim that listDrafts can recover after re-login.
      console.warn('auth.logout server call failed; preserving draft recovery state:', err);
      clearLocalSession({ preserveWorkspaces: true });
      setError(err);
    } finally {
      if (isCurrent()) {
        if (parkingCommitted) clearLocalSession();
        setIsLoading(false);
        navigate('/login');
      }
    }
  }, [clearLocalSession, navigate]);

  const runSessionRevocation = useCallback(
    async (commit: () => Promise<unknown>) => {
      // Capture the initiating identity before the command, not after its
      // response: a late password-change response must not log out a new user.
      const generation = bootGeneration.current;
      await commit();
      if (generation !== bootGeneration.current) return false;
      const closingGeneration = ++bootGeneration.current;
      bootInFlight.current = false;
      setIsChangingAccount(false);
      setIsLoading(true);
      clearLocalSession({ clearDesktop: false });
      try {
        // Other tabs drop the revoked actor without clearing a newer shared
        // main-process identity. This marker never carries credentials or PII.
        window.localStorage.setItem(
          STAFF_HANDOFF_STORAGE_KEY,
          `revoked:${Date.now()}:${closingGeneration}`
        );
      } catch (error) {
        console.warn('Session revocation notification failed:', error);
      }
      try {
        if (isHubClientAuth()) await clearHubSession();
        else await clearDesktopSession();
      } catch (error) {
        // The server has already revoked this credential and parked its work.
        // A local bridge failure cannot undo that confirmed transaction.
        console.warn('Revoked session credential cleanup failed:', error);
      } finally {
        if (closingGeneration === bootGeneration.current) {
          setIsLoading(false);
          navigate('/login');
        }
      }
      return closingGeneration === bootGeneration.current;
    },
    [clearLocalSession, navigate]
  );

  const updateTenantSettings = useCallback((patch: Partial<TenantSettings>) => {
    // This is a read-side mirror only: callers invoke it after the server has
    // committed the corresponding tenant mutation. A reload still rehydrates
    // from auth.me, which remains authoritative.
    setTenant(current =>
      current
        ? {
            ...current,
            settings: {
              ...current.settings,
              ...patch,
            },
          }
        : null
    );
  }, []);

  // memoize the context value so the 52 `useAuth` consumers only
  // re-render when an auth field actually changes, not on every incidental
  // AuthProvider render. `login` + `logout` are now stable useCallbacks.
  const value = useMemo<AuthContextType>(
    () => ({
      user,
      tenant,
      isAuthenticated: !!user,
      isLoading,
      login,
      switchStaff,
      logout,
      runSessionRevocation,
      updateTenantSettings,
      error,
      ...(bootstrapRecovery
        ? {
            bootstrapRecovery: {
              ...bootstrapRecovery,
              isRetrying: isLoading,
              isChangingAccount,
              accountChangeFailed,
              retry: retryBootstrap,
              signIn: signInAfterRecovery,
            },
          }
        : {}),
    }),
    [
      user,
      tenant,
      isLoading,
      login,
      switchStaff,
      logout,
      runSessionRevocation,
      updateTenantSettings,
      error,
      bootstrapRecovery,
      retryBootstrap,
      signInAfterRecovery,
      isChangingAccount,
      accountChangeFailed,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
