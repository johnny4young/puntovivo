import { getStoredAuthTenantId } from '@/features/auth/authStorage';

const ACTIVE_SITE_STORAGE_PREFIX = 'active_site_id:';

// localStorage is shared by every same-origin tab, so it only remembers the
// last selection for the next boot. Requests must carry the site this document
// resolved and shows, or another tab's switch silently re-scopes its writes.
let documentSite: { tenantId: string; siteId: string } | null = null;

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

  documentSite = { tenantId: resolvedTenantId, siteId };
  window.localStorage.setItem(getStorageKey(resolvedTenantId), siteId);
}

export function clearStoredSiteId(tenantId?: string | null): void {
  const resolvedTenantId = tenantId ?? getStoredAuthTenantId();
  if (!resolvedTenantId) {
    return;
  }

  if (documentSite?.tenantId === resolvedTenantId) {
    documentSite = null;
  }
  window.localStorage.removeItem(getStorageKey(resolvedTenantId));
}

/**
 * The site this document's requests carry. Its own resolved selection wins
 * while the stored tenant still names that identity (or storage lost it). A
 * login that replaced the stored tenant falls back to that tenant's remembered
 * site until its provider resolves one.
 */
export function getRequestSiteId(): string | null {
  const storedTenantId = getStoredAuthTenantId();
  if (documentSite && (!storedTenantId || storedTenantId === documentSite.tenantId)) {
    return documentSite.siteId;
  }

  return getStoredSiteId(storedTenantId);
}

/** Test-only: forget this document's resolved site between cases. */
export function __resetDocumentSiteForTests(): void {
  documentSite = null;
}
