import { createContext, useContext, ReactNode } from 'react';
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

  const sites = normalizeSites(sitesQuery.data?.items as Site[] | undefined);
  const { currentSite, switchSite } = useActiveSite({
    tenantId: tenant?.id ?? null,
    sites,
    fallbackSiteId: sitesQuery.data?.activeSiteId ?? sites[0]?.id ?? null,
  });

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
