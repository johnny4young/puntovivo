import type { ReactNode } from 'react';
import { TenantProvider } from '@/features/tenant/TenantProvider';
import { useAuth } from './AuthContext';

/** Rebind tenant query observers after identity teardown; cart stores stay outside. */
export function AuthTenantBoundary({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const owner = JSON.stringify([user?.tenantId ?? null, user?.id ?? null]);
  return <TenantProvider key={owner}>{children}</TenantProvider>;
}
