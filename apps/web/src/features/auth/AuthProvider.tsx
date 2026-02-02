import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User, Tenant, LoginCredentials } from '@/types';
import api from '@/services/api/client';

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
        // Restore auth from localStorage
        if (api.restoreAuth()) {
          const currentUser = api.getUser();
          const currentTenant = api.getTenant();

          if (currentUser) {
            setUser({
              id: currentUser.id,
              email: currentUser.email,
              name: currentUser.name,
              role: currentUser.role,
              tenantId: currentUser.tenantId,
            } as User);
          }

          if (currentTenant) {
            setTenant({
              id: currentTenant.id,
              name: currentTenant.name,
              slug: currentTenant.slug,
              settings: currentTenant.settings as unknown as Tenant['settings'],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        console.error('Auth init error:', err);
        api.logout();
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
      const authData = await api.login(credentials.email, credentials.password);
      const userData = authData.user;
      setUser({
        id: userData.id,
        email: userData.email,
        name: userData.name,
        role: userData.role,
        tenantId: userData.tenantId,
      } as User);

      // Set tenant context
      if (authData.tenant) {
        setTenant({
          id: authData.tenant.id,
          name: authData.tenant.name,
          slug: authData.tenant.slug,
          settings: authData.tenant.settings as unknown as Tenant['settings'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

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
      await api.logout();
      setUser(null);
      setTenant(null);
      navigate('/login');
    } finally {
      setIsLoading(false);
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
