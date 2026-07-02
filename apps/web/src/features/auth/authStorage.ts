import type { Tenant, User } from '@/types';

// Legacy key — full `User` objects (name, email, role) were persisted here
// through 1.2.x. Nothing ever read it back (AuthProvider rehydrates via
// `auth.me`), so it was pure offline-PII exposure under XSS or a shared
// terminal. It is now only ever removed, so upgraded installs get cleaned.
const AUTH_USER_KEY = 'auth_user';
const AUTH_TENANT_KEY = 'auth_tenant';

export interface StoredAuthSnapshot {
  user: User;
  tenant: Tenant | null;
}

interface StoredTenantRef {
  id: string;
}

export function getStoredAuthTenant(): StoredTenantRef | null {
  const serializedTenant = window.localStorage.getItem(AUTH_TENANT_KEY);
  if (!serializedTenant) {
    return null;
  }

  try {
    const parsed = JSON.parse(serializedTenant) as Partial<StoredTenantRef> | null;
    return parsed && typeof parsed.id === 'string' ? { id: parsed.id } : null;
  } catch {
    return null;
  }
}

export function getStoredAuthTenantId(): string | null {
  return getStoredAuthTenant()?.id ?? null;
}

/**
 * Persist the minimum the app reads back across reloads: the tenant id
 * (site storage + offline sync scope keys). The user identity is NEVER
 * persisted — `auth.me` is the single rehydration source — so localStorage
 * carries no name/email PII.
 */
export function persistAuthSession(snapshot: StoredAuthSnapshot): void {
  window.localStorage.removeItem(AUTH_USER_KEY);

  if (snapshot.tenant) {
    window.localStorage.setItem(
      AUTH_TENANT_KEY,
      JSON.stringify({ id: snapshot.tenant.id })
    );
    return;
  }

  window.localStorage.removeItem(AUTH_TENANT_KEY);
}

export function clearAuthSession(): void {
  window.localStorage.removeItem(AUTH_USER_KEY);
  window.localStorage.removeItem(AUTH_TENANT_KEY);
}
