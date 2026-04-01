import { createContext, useContext, ReactNode } from 'react';
import type { Tenant, TenantSettings } from '@/types';
import { useAuth } from '@/features/auth/AuthProvider';

interface TenantContextType {
  currentTenant: Tenant | null;
  tenantSettings: TenantSettings | null;
  switchTenant: (tenantId: string) => Promise<void>;
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
  const { tenant } = useAuth();

  const switchTenant = async (tenantId: string) => {
    // In a real app, this would fetch and update tenant data
    console.log('Switching to tenant:', tenantId);
  };

  return (
    <TenantContext.Provider
      value={{
        currentTenant: tenant,
        tenantSettings: tenant?.settings ?? null,
        switchTenant,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}
