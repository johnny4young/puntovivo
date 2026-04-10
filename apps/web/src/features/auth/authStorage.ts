import type { Tenant, User } from '@/types';

const AUTH_USER_KEY = 'auth_user';
const AUTH_TENANT_KEY = 'auth_tenant';

export interface StoredAuthSnapshot {
  user: User;
  tenant: Tenant | null;
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

export function persistAuthSession(snapshot: StoredAuthSnapshot): void {
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(snapshot.user));

  if (snapshot.tenant) {
    window.localStorage.setItem(AUTH_TENANT_KEY, JSON.stringify(snapshot.tenant));
    return;
  }

  window.localStorage.removeItem(AUTH_TENANT_KEY);
}

export function clearAuthSession(): void {
  window.localStorage.removeItem(AUTH_USER_KEY);
  window.localStorage.removeItem(AUTH_TENANT_KEY);
}
