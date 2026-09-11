import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Site } from '@/types';
import { clearStoredSiteId, getStoredSiteId, persistSiteId } from './siteStorage';

const NO_SITES: Site[] = [];

export function normalizeSites(sites: Site[] | undefined): Site[] {
  return (sites ?? []).map(site => ({
    ...site,
    isActive: site.isActive ?? false,
  }));
}

function resolveSiteId({
  currentSiteId,
  storedSiteId,
  fallbackSiteId,
  sites,
}: {
  currentSiteId: string | null;
  storedSiteId: string | null;
  fallbackSiteId: string | null;
  sites: Site[];
}): string | null {
  const siteIds = new Set(sites.map(site => site.id));

  return (
    [currentSiteId, storedSiteId, fallbackSiteId].find(
      (siteId): siteId is string => !!siteId && siteIds.has(siteId)
    ) ?? null
  );
}

export function useActiveSite({
  tenantId,
  sites,
  fallbackSiteId,
  sitesReady = true,
}: {
  tenantId: string | null;
  sites: Site[];
  fallbackSiteId: string | null;
  /** True only after sites.list returned authoritative data. */
  sitesReady?: boolean;
}) {
  const [selection, setSelection] = useState<{
    tenantId: string | null;
    siteId: string | null;
  }>({
    tenantId: null,
    siteId: null,
  });

  const selectedSiteId = selection.tenantId === tenantId ? selection.siteId : null;

  // `sites.list` query keys carry no identity, so a provider mounted for a new
  // tenant can observe rows cached for the previous one. The server lists only
  // the caller's own sites: one row owned by another tenant proves the list
  // answers a different identity. Never resolve, expose, persist, or clear from
  // it, so a stored or fallback id is only ever validated against sites this
  // tenant owns.
  const isForeignSiteList = !!tenantId && sites.some(site => site.tenantId !== tenantId);
  const isTenantListReady = !!tenantId && sitesReady && !isForeignSiteList;
  const tenantSites = isTenantListReady ? sites : NO_SITES;

  const resolvedSiteId = useMemo(() => {
    if (!tenantId || tenantSites.length === 0) {
      return null;
    }

    return resolveSiteId({
      currentSiteId: selectedSiteId,
      storedSiteId: getStoredSiteId(tenantId),
      fallbackSiteId,
      sites: tenantSites,
    });
  }, [selectedSiteId, fallbackSiteId, tenantSites, tenantId]);

  useEffect(() => {
    if (!tenantId || !isTenantListReady) {
      return;
    }

    if (resolvedSiteId) {
      persistSiteId(resolvedSiteId, tenantId);
      return;
    }

    clearStoredSiteId(tenantId);
  }, [resolvedSiteId, isTenantListReady, tenantId]);

  const currentSite = useMemo(
    () => tenantSites.find(site => site.id === resolvedSiteId) ?? null,
    [resolvedSiteId, tenantSites]
  );

  const switchSite = useCallback(
    async (siteId: string) => {
      if (!tenantId) {
        return;
      }

      if (!tenantSites.some(site => site.id === siteId)) {
        return;
      }

      setSelection({ tenantId, siteId });
    },
    [tenantSites, tenantId]
  );

  return {
    /** Sites this tenant owns; empty until an authoritative list arrives. */
    tenantSites,
    /** The provided list answers another identity and must be fetched again. */
    isForeignSiteList,
    currentSite,
    currentSiteId: resolvedSiteId,
    switchSite,
  };
}
