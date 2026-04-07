import { createContext, useContext, ReactNode, useEffect, useMemo, useState } from 'react';
import type { Site, Tenant, TenantSettings } from '@/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';
import { clearStoredSiteId, getStoredSiteId, persistSiteId } from './siteStorage';

interface TenantContextType {
  currentTenant: Tenant | null;
  tenantSettings: TenantSettings | null;
  sites: Site[];
  currentSite: Site | null;
  isLoadingSites: boolean;
  switchSite: (siteId: string) => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function useTenant() {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return context;
}

interface TenantProviderProps {
  children: ReactNode;
}

export function TenantProvider({ children }: TenantProviderProps) {
  const { tenant, isAuthenticated } = useAuth();
  const [currentSiteId, setCurrentSiteId] = useState<string | null>(null);
  const sitesQuery = trpc.sites.list.useQuery(undefined, {
    enabled: isAuthenticated && !!tenant,
  });

  const sites = useMemo(
    () =>
      (sitesQuery.data?.items ?? []).map(site => ({
        ...site,
        isActive: site.isActive ?? false,
      })),
    [sitesQuery.data?.items]
  );

  useEffect(() => {
    if (!tenant) {
      setCurrentSiteId(null);
    }
  }, [tenant?.id]);

  useEffect(() => {
    if (!tenant) {
      return;
    }

    if (sites.length === 0) {
      setCurrentSiteId(null);
      clearStoredSiteId(tenant.id);
      return;
    }

    const siteIds = new Set(sites.map(site => site.id));
    const storedSiteId = getStoredSiteId(tenant.id);
    const defaultSiteId = sitesQuery.data?.activeSiteId ?? sites[0]?.id ?? null;
    const nextSiteId =
      [currentSiteId, storedSiteId, defaultSiteId].find(
        (siteId): siteId is string => !!siteId && siteIds.has(siteId)
      ) ?? null;

    if (nextSiteId !== currentSiteId) {
      setCurrentSiteId(nextSiteId);
    }

    if (nextSiteId) {
      persistSiteId(nextSiteId, tenant.id);
    }
  }, [currentSiteId, sites, sitesQuery.data?.activeSiteId, tenant]);

  const currentSite = useMemo(
    () => sites.find(site => site.id === currentSiteId) ?? null,
    [currentSiteId, sites]
  );

  const switchSite = async (siteId: string) => {
    if (!tenant) {
      return;
    }

    const selectedSite = sites.find(site => site.id === siteId);
    if (!selectedSite) {
      return;
    }

    setCurrentSiteId(selectedSite.id);
    persistSiteId(selectedSite.id, tenant.id);
  };

  return (
    <TenantContext.Provider
      value={{
        currentTenant: tenant,
        tenantSettings: tenant?.settings ?? null,
        sites,
        currentSite,
        isLoadingSites: sitesQuery.isLoading,
        switchSite,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}
