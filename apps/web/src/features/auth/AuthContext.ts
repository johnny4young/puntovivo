import { createContext, useContext } from 'react';
import type { LoginCredentials, Tenant, User } from '@/types';

export interface AuthContextType {
  user: User | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  switchStaff: (input: { targetUserId: string; pin: string }) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * The raw error from the most recent failed auth operation, or null when
   * the last call succeeded. Locale-agnostic so consumers can render it via
   * `translateServerError` against the active i18n locale.
   */
  error: unknown;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

/** Stable tenant/user key for client state that must never cross operators. */
export function useAuthOwnerKey(): string | null {
  const { user } = useAuth();
  return user ? `${user.tenantId}:${user.id}` : null;
}
