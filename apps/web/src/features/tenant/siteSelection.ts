import { useEffect, useMemo, useState } from 'react';
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
  const [currentSiteId, setCurrentSiteId] = useState<string | null>(null);

  const resolvedSiteId = useMemo(() => {
    if (!tenantId || sites.length === 0) {
      return null;
    }

    return resolveSiteId({
      currentSiteId,
      storedSiteId: getStoredSiteId(tenantId),
      fallbackSiteId,
      sites,
    });
  }, [currentSiteId, fallbackSiteId, sites, tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setCurrentSiteId(null);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      return;
    }

    if (sites.length === 0) {
      if (currentSiteId !== null) {
        setCurrentSiteId(null);
      }
      clearStoredSiteId(tenantId);
      return;
    }

    if (resolvedSiteId !== currentSiteId) {
      setCurrentSiteId(resolvedSiteId);
    }
  }, [currentSiteId, resolvedSiteId, sites.length, tenantId]);

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

  const switchSite = async (siteId: string) => {
    if (!sites.some(site => site.id === siteId)) {
      return;
    }

    setCurrentSiteId(siteId);
  };

  return {
    currentSite,
    currentSiteId: resolvedSiteId,
    switchSite,
  };
}
