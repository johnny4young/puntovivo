const AUTH_TENANT_KEY = 'auth_tenant';
const ACTIVE_SITE_STORAGE_PREFIX = 'active_site_id:';

function getStorageKey(tenantId: string) {
  return `${ACTIVE_SITE_STORAGE_PREFIX}${tenantId}`;
}

function readStoredTenantId(): string | null {
  const serializedTenant = window.localStorage.getItem(AUTH_TENANT_KEY);
  if (!serializedTenant) {
    return null;
  }

  try {
    const tenant = JSON.parse(serializedTenant) as { id?: string };
    return tenant.id ?? null;
  } catch {
    return null;
  }
}

export function getStoredSiteId(tenantId?: string | null): string | null {
  const resolvedTenantId = tenantId ?? readStoredTenantId();
  if (!resolvedTenantId) {
    return null;
  }

  return window.localStorage.getItem(getStorageKey(resolvedTenantId));
}

export function persistSiteId(siteId: string, tenantId?: string | null): void {
  const resolvedTenantId = tenantId ?? readStoredTenantId();
  if (!resolvedTenantId) {
    return;
  }

  window.localStorage.setItem(getStorageKey(resolvedTenantId), siteId);
}

export function clearStoredSiteId(tenantId?: string | null): void {
  const resolvedTenantId = tenantId ?? readStoredTenantId();
  if (!resolvedTenantId) {
    return;
  }

  window.localStorage.removeItem(getStorageKey(resolvedTenantId));
}
