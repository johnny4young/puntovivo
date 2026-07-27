import { createContext, useContext } from 'react';
import type { Site, Tenant, TenantSettings } from '@/types';

export interface TenantContextType {
  currentTenant: Tenant | null;
  tenantSettings: TenantSettings | null;
  sites: Site[];
  currentSite: Site | null;
  isLoadingSites: boolean;
  switchSite: (siteId: string) => Promise<void>;
}

export const TenantContext = createContext<TenantContextType | undefined>(undefined);

export function useTenant(): TenantContextType {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return context;
}
