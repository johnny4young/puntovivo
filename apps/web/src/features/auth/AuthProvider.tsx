import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User, Tenant, LoginCredentials } from '@/types';
import { vanillaClient } from '@/lib/trpc';

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

/** localStorage keys for auth persistence */
const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USER_KEY = 'auth_user';
const AUTH_TENANT_KEY = 'auth_tenant';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Check for existing auth on mount
  useEffect(() => {
    const initAuth = async () => {
      try {
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        const userStr = localStorage.getItem(AUTH_USER_KEY);
        const tenantStr = localStorage.getItem(AUTH_TENANT_KEY);

        if (token && userStr && tenantStr) {
          const storedUser = JSON.parse(userStr);
          const storedTenant = JSON.parse(tenantStr);

          setUser({
            id: storedUser.id,
            email: storedUser.email,
            name: storedUser.name,
            role: storedUser.role,
            tenantId: storedUser.tenantId,
          } as User);

          setTenant({
            id: storedTenant.id,
            name: storedTenant.name,
            slug: storedTenant.slug,
            settings: storedTenant.settings as unknown as Tenant['settings'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('Auth init error:', err);
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
        localStorage.removeItem(AUTH_TENANT_KEY);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const login = async (credentials: LoginCredentials) => {
    setIsLoading(true);
    setError(null);

    try {
      const authData = await vanillaClient.auth.login.mutate({
        email: credentials.email,
        password: credentials.password,
      });

      // Persist to localStorage (the tRPC httpBatchLink reads from localStorage for the token)
      localStorage.setItem(AUTH_TOKEN_KEY, authData.token);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(authData.user));
      localStorage.setItem(AUTH_TENANT_KEY, JSON.stringify(authData.tenant));

      setUser({
        id: authData.user.id,
        email: authData.user.email,
        name: authData.user.name,
        role: authData.user.role,
        tenantId: authData.user.tenantId,
      } as User);

      setTenant({
        id: authData.tenant.id,
        name: authData.tenant.name,
        slug: authData.tenant.slug,
      } as Tenant);

      navigate('/dashboard');
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
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_USER_KEY);
      localStorage.removeItem(AUTH_TENANT_KEY);
      setUser(null);
      setTenant(null);
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
