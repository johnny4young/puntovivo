import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { TRPCClientError } from '@trpc/client';
import type { User, Tenant, LoginCredentials } from '@/types';
import { vanillaClient } from '@/lib/trpc';
import { clearAuthSession, persistAuthSession } from './authStorage';
import { getDefaultRouteForRole } from './roleAccess';

interface AuthContextType {
  user: User | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const clearLocalSession = () => {
    clearAuthSession();
    setUser(null);
    setTenant(null);
    setError(null);
  };

  // Check for existing auth on mount
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
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
      await vanillaClient.auth.login.mutate({
        email: credentials.email,
        password: credentials.password,
      });

      const session = mapSession(await vanillaClient.auth.me.query());

      persistAuthSession(session);
      setUser(session.user);
      setTenant(session.tenant);

      navigate(getDefaultRouteForRole(session.user.role));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
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
