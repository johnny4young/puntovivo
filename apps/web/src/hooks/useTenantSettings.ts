/**
 * ENG-017 — `useTenantSettings` is now a thin compatibility wrapper
 * over `useResolvedLocale` (the canonical ENG-017 entry point).
 * Consumers like `DashboardPage` keep the existing API shape but the
 * underlying formatters read the tenant's resolved locale instead of
 * the stale `tenants.settings` JSON blob.
 *
 * New code should prefer `useResolvedLocale()` + the plain
 * `formatCurrency` / `formatDate` / `formatDateTime` from
 * `@/lib/utils` (they read the same module-level singleton
 * `LocaleProvider` maintains).
 */

import { useTenant } from '@/features/tenant/TenantProvider';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { formatCurrency as formatCurrencyUtil, formatDate, formatDateTime } from '@/lib/utils';

export function useTenantSettings() {
  const { tenantSettings, currentTenant } = useTenant();
  const resolved = useResolvedLocale();
  const taxRate = tenantSettings?.taxRate ?? 0;

  // `formatCurrency` without a currency argument falls through to the
  // LocaleProvider singleton — guarantees the amount renders in the
  // tenant's resolved currency regardless of what the legacy JSON
  // blob still holds.
  const formatCurrency = (amount: number) => formatCurrencyUtil(amount);
  const formatTenantDate = (date: Date | string) => formatDate(date);
  const formatTenantDateTime = (date: Date | string) => formatDateTime(date);

  return {
    tenant: currentTenant,
    settings: tenantSettings,
    formatCurrency,
    formatDate: formatTenantDate,
    formatDateTime: formatTenantDateTime,
    taxRate,
    currency: resolved.currency,
    timezone: resolved.timezone,
  };
}
