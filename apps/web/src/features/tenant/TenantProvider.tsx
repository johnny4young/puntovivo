import { createContext, useContext, useMemo, ReactNode } from 'react';
import type { Site, Tenant, TenantSettings } from '@/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';
import { normalizeSites, useActiveSite } from './siteSelection';

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
  const sitesQuery = trpc.sites.list.useQuery(undefined, {
    enabled: isAuthenticated && !!tenant,
  });

  // ENG-171 — memoize `sites` so its reference is stable while the
  // underlying query data is unchanged. Without this the array is rebuilt
  // every render, which (a) defeats `switchSite`'s useCallback (it depends
  // on `sites`) and (b) would defeat the context-value memo below.
  const sites = useMemo(
    () => normalizeSites(sitesQuery.data?.items as Site[] | undefined),
    [sitesQuery.data]
  );
  const { currentSite, switchSite } = useActiveSite({
    tenantId: tenant?.id ?? null,
    sites,
    fallbackSiteId: sitesQuery.data?.activeSiteId ?? sites[0]?.id ?? null,
  });

  // ENG-171 — memoize the context value so the 19 `useTenant` consumers do
  // not re-render on every TenantProvider render (e.g. when an ancestor
  // re-renders). `currentSite` + `switchSite` are already memoized in
  // `useActiveSite`; with `sites` now stable, this memo only changes when a
  // tracked field actually changes.
  const value = useMemo<TenantContextType>(
    () => ({
      currentTenant: tenant,
      tenantSettings: tenant?.settings ?? null,
      sites,
      currentSite,
      isLoadingSites: sitesQuery.isLoading,
      switchSite,
    }),
    [tenant, sites, currentSite, sitesQuery.isLoading, switchSite]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}
