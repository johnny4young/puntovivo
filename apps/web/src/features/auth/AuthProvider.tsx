import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { TRPCClientError } from '@trpc/client';
import type { User, Tenant, LoginCredentials } from '@/types';
import {
  clearAccessToken,
  setAccessToken,
  setAuthSessionExpiredHandler,
  vanillaClient,
} from '@/lib/trpc';
import { clearAuthSession, persistAuthSession } from './authStorage';
import { getDefaultRouteForRole } from './roleAccess';

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

const DEFAULT_TENANT_SETTINGS: Tenant['settings'] = {
  currency: 'USD',
  timezone: 'UTC',
  dateFormat: 'YYYY-MM-DD',
  taxRate: 0,
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

  const clearLocalSession = () => {
    clearAccessToken();
    clearAuthSession();
    setUser(null);
    setTenant(null);
    setError(null);
  };

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
  }, [handleAuthSessionExpired]);

  // Check for existing auth on mount
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        await vanillaClient.health.check.query();
        const refreshResult = await vanillaClient.auth.refresh.mutate();
        setAccessToken(refreshResult.token);
        const session = mapSession(await vanillaClient.auth.me.query());
        persistAuthSession(session);

        if (!isMounted) {
          return;
        }

        setUser(session.user);
        setTenant(session.tenant);
        setError(null);
      } catch (err) {
        const isUnauthorized =
          err instanceof TRPCClientError &&
          (err.data?.code === 'UNAUTHORIZED' ||
            err.message === 'You must be logged in to perform this action');

        if (!isUnauthorized) {
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
  }, []);

  const login = async (credentials: LoginCredentials) => {
    setIsLoading(true);
    setError(null);

    try {
      const authData = await vanillaClient.auth.login.mutate({
        email: credentials.email,
        password: credentials.password,
      });
      setAccessToken(authData.token);

      const session = mapSession(await vanillaClient.auth.me.query());

      persistAuthSession(session);
      setUser(session.user);
      setTenant(session.tenant);

      navigate(getDefaultRouteForRole(session.user.role));
    } catch (err) {
      // Store the raw error so consumers can translate it against the active
      // locale via `translateServerError`. The provider itself stays
      // locale-agnostic.
      setError(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await vanillaClient.auth.logout.mutate();
    } catch {
      // Ignore errors on logout — clear local state regardless
    } finally {
      clearLocalSession();
      setIsLoading(false);
      navigate('/login');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        tenant,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        error,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
