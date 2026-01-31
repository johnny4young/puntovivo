import { useMemo } from 'react';
import { useTenant } from '@/features/tenant/TenantProvider';
import { formatCurrency as formatCurrencyUtil, formatDate, formatDateTime } from '@/lib/utils';

export function useTenantSettings() {
  const { tenantSettings, currentTenant } = useTenant();

  const formatCurrency = useMemo(() => {
    const currency = tenantSettings?.currency || 'USD';
    return (amount: number) => formatCurrencyUtil(amount, currency);
  }, [tenantSettings?.currency]);

  const formatTenantDate = useMemo(() => {
    return (date: Date | string) => formatDate(date);
  }, []);

  const formatTenantDateTime = useMemo(() => {
    return (date: Date | string) => formatDateTime(date);
  }, []);

  const taxRate = tenantSettings?.taxRate || 0;

  return {
    tenant: currentTenant,
    settings: tenantSettings,
    formatCurrency,
    formatDate: formatTenantDate,
    formatDateTime: formatTenantDateTime,
    taxRate,
    currency: tenantSettings?.currency || 'USD',
    timezone: tenantSettings?.timezone || 'UTC',
  };
}
