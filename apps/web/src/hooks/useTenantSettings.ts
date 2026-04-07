import { useTenant } from '@/features/tenant/TenantProvider';
import { formatCurrency as formatCurrencyUtil, formatDate, formatDateTime } from '@/lib/utils';

export function useTenantSettings() {
  const { tenantSettings, currentTenant } = useTenant();
  const currency = tenantSettings?.currency || 'USD';
  const taxRate = tenantSettings?.taxRate || 0;

  const formatCurrency = (amount: number) => formatCurrencyUtil(amount, currency);
  const formatTenantDate = (date: Date | string) => formatDate(date);
  const formatTenantDateTime = (date: Date | string) => formatDateTime(date);

  return {
    tenant: currentTenant,
    settings: tenantSettings,
    formatCurrency,
    formatDate: formatTenantDate,
    formatDateTime: formatTenantDateTime,
    taxRate,
    currency,
    timezone: tenantSettings?.timezone || 'UTC',
  };
}
