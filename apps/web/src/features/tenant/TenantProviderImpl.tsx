import { useEffect, useMemo, useRef, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Site } from '@/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';
import { normalizeSites, useActiveSite } from './siteSelection';
import { TenantContext, type TenantContextType } from './TenantContext';

interface TenantProviderProps {
  children: ReactNode;
}

export function TenantProvider({ children }: TenantProviderProps) {
  const { tenant, isAuthenticated } = useAuth();
  const sitesQuery = trpc.sites.list.useQuery(undefined, {
    enabled: isAuthenticated && !!tenant,
  });

  // memoize `sites` so its reference is stable while the
  // underlying query data is unchanged. Without this the array is rebuilt
  // every render, which (a) defeats `switchSite`'s useCallback (it depends
  // on `sites`) and (b) would defeat the context-value memo below.
  const sites = useMemo(
    () => normalizeSites(sitesQuery.data?.items as Site[] | undefined),
    [sitesQuery.data]
  );
  const { tenantSites, isForeignSiteList, currentSite, switchSite } = useActiveSite({
    tenantId: tenant?.id ?? null,
    sites,
    fallbackSiteId: sitesQuery.data?.activeSiteId ?? sites[0]?.id ?? null,
    // During bootstrap `items ?? []` is not an authoritative empty tenant.
    // Do not let that transient shape erase the locally remembered site.
    sitesReady: sitesQuery.data !== undefined,
  });

  // A list cached for the previous identity is not this tenant's answer, and a
  // remounted observer does not refetch data that is still within staleTime.
  // Keep the selector loading and ask the server for this tenant's own sites.
  const refetchSites = sitesQuery.refetch;
  useEffect(() => {
    if (isForeignSiteList) {
      void refetchSites();
    }
  }, [isForeignSiteList, refetchSites]);
  const isLoadingSites = sitesQuery.isLoading || isForeignSiteList;

  // Site scoping rides on the `x-site-id` header, NOT on the React Query
  // keys — so a cached `sales.list`/`listDrafts`/etc. entry from the
  // previous site is key-identical to the new site's and would be served
  // (and, within staleTime, not even refetched) after a switch. Invalidate
  // everything on an actual site *change* (not on initial resolution) so
  // every active query refetches under the new header.
  const queryClient = useQueryClient();
  const previousSiteIdRef = useRef<string | null>(null);
  const currentSiteId = currentSite?.id ?? null;
  useEffect(() => {
    const previous = previousSiteIdRef.current;
    previousSiteIdRef.current = currentSiteId;
    if (previous !== null && currentSiteId !== null && previous !== currentSiteId) {
      void queryClient.invalidateQueries();
    }
  }, [currentSiteId, queryClient]);

  // memoize the context value so the 19 `useTenant` consumers do
  // not re-render on every TenantProvider render (e.g. when an ancestor
  // re-renders). `currentSite` + `switchSite` are already memoized in
  // `useActiveSite`; with `sites` now stable, this memo only changes when a
  // tracked field actually changes.
  const value = useMemo<TenantContextType>(
    () => ({
      currentTenant: tenant,
      tenantSettings: tenant?.settings ?? null,
      sites: tenantSites,
      currentSite,
      isLoadingSites,
      switchSite,
    }),
    [tenant, tenantSites, currentSite, isLoadingSites, switchSite]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}
