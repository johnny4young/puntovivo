import type { Tenant, User } from '@/types';

const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USER_KEY = 'auth_user';
const AUTH_TENANT_KEY = 'auth_tenant';

export interface StoredAuthSnapshot {
  user: User;
  tenant: Tenant | null;
}

export function getStoredAuthToken(): string | null {
  return window.localStorage.getItem(AUTH_TOKEN_KEY);
}

export function getStoredAuthTenant(): Tenant | null {
  const serializedTenant = window.localStorage.getItem(AUTH_TENANT_KEY);
  if (!serializedTenant) {
    return null;
  }

  try {
    return JSON.parse(serializedTenant) as Tenant;
  } catch {
    return null;
  }
}

export function getStoredAuthTenantId(): string | null {
  return getStoredAuthTenant()?.id ?? null;
}

export function persistAuthToken(token: string): void {
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function persistAuthSession(token: string, snapshot: StoredAuthSnapshot): void {
  persistAuthToken(token);
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(snapshot.user));

  if (snapshot.tenant) {
    window.localStorage.setItem(AUTH_TENANT_KEY, JSON.stringify(snapshot.tenant));
    return;
  }

  window.localStorage.removeItem(AUTH_TENANT_KEY);
}

export function clearAuthSession(): void {
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_USER_KEY);
  window.localStorage.removeItem(AUTH_TENANT_KEY);
}
