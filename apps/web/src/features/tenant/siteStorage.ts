import { getStoredAuthTenantId } from '@/features/auth/authStorage';

const ACTIVE_SITE_STORAGE_PREFIX = 'active_site_id:';

function getStorageKey(tenantId: string) {
  return `${ACTIVE_SITE_STORAGE_PREFIX}${tenantId}`;
}

export function getStoredSiteId(tenantId?: string | null): string | null {
  const resolvedTenantId = tenantId ?? getStoredAuthTenantId();
  if (!resolvedTenantId) {
    return null;
  }

  return window.localStorage.getItem(getStorageKey(resolvedTenantId));
}

export function persistSiteId(siteId: string, tenantId?: string | null): void {
  const resolvedTenantId = tenantId ?? getStoredAuthTenantId();
  if (!resolvedTenantId) {
    return;
  }

  window.localStorage.setItem(getStorageKey(resolvedTenantId), siteId);
}

export function clearStoredSiteId(tenantId?: string | null): void {
  const resolvedTenantId = tenantId ?? getStoredAuthTenantId();
  if (!resolvedTenantId) {
    return;
  }

  window.localStorage.removeItem(getStorageKey(resolvedTenantId));
}
