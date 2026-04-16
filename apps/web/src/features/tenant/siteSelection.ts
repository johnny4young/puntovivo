import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Site } from '@/types';
import { clearStoredSiteId, getStoredSiteId, persistSiteId } from './siteStorage';

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
}: {
  tenantId: string | null;
  sites: Site[];
  fallbackSiteId: string | null;
}) {
  const [selection, setSelection] = useState<{
    tenantId: string | null;
    siteId: string | null;
  }>({
    tenantId: null,
    siteId: null,
  });

  const selectedSiteId = selection.tenantId === tenantId ? selection.siteId : null;

  const resolvedSiteId = useMemo(() => {
    if (!tenantId || sites.length === 0) {
      return null;
    }

    return resolveSiteId({
      currentSiteId: selectedSiteId,
      storedSiteId: getStoredSiteId(tenantId),
      fallbackSiteId,
      sites,
    });
  }, [selectedSiteId, fallbackSiteId, sites, tenantId]);

  useEffect(() => {
    if (!tenantId) {
      return;
    }

    if (resolvedSiteId) {
      persistSiteId(resolvedSiteId, tenantId);
      return;
    }

    clearStoredSiteId(tenantId);
  }, [resolvedSiteId, tenantId]);

  const currentSite = useMemo(
    () => sites.find(site => site.id === resolvedSiteId) ?? null,
    [resolvedSiteId, sites]
  );

  const switchSite = useCallback(
    async (siteId: string) => {
      if (!tenantId) {
        return;
      }

      if (!sites.some(site => site.id === siteId)) {
        return;
      }

      setSelection({ tenantId, siteId });
    },
    [sites, tenantId]
  );

  return {
    currentSite,
    currentSiteId: resolvedSiteId,
    switchSite,
  };
}
