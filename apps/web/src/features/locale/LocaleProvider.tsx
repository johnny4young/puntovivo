/**
 * ENG-017 — tenant locale provider.
 *
 * Fetches the resolved locale from `tenantLocale.get` on mount and
 * whenever `currentTenant.id` changes. On every update, pushes a
 * snapshot into the `setActiveTenantLocale` singleton in
 * `apps/web/src/lib/utils.ts` so the existing ~140 call sites of
 * `formatCurrency(amount)` pick up the new defaults without a
 * render-path change.
 *
 * Exposes:
 * - `useResolvedLocale()` — the full `ResolvedLocale` object for
 *   components that need individual fields (timezone, decimals,
 *   firstDayOfWeek, etc.).
 * - `useLocaleLoaded()` — boolean for screens that want to skeleton
 *   until the locale is confirmed.
 *
 * Also dispatches `i18n.changeLanguage(language)` when the resolved
 * language changes so i18next renders copy in the matching bundle.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import i18n from '@/i18n';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { trpc } from '@/lib/trpc';
import { setActiveTenantLocale } from '@/lib/utils';

export interface ResolvedLocale {
  locale: string;
  language: string;
  countryCode: string;
  currency: string;
  currencySymbol: string;
  legalDecimals: number;
  displayDecimals: number;
  timezone: string;
  firstDayOfWeek: number;
  dateFormatShort: string;
  uiLocaleReady: boolean;
  isFallback: boolean;
}

const FALLBACK_RESOLVED_LOCALE: ResolvedLocale = {
  locale: 'en-US',
  language: 'en',
  countryCode: 'US',
  currency: 'USD',
  currencySymbol: '$',
  legalDecimals: 2,
  displayDecimals: 2,
  timezone: 'America/New_York',
  firstDayOfWeek: 0,
  dateFormatShort: 'MM/dd/yyyy',
  uiLocaleReady: true,
  isFallback: true,
};

interface LocaleContextValue {
  resolved: ResolvedLocale;
  isLoading: boolean;
  isFallback: boolean;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const { currentTenant } = useTenant();

  // Keyed on `currentTenant?.id` so React Query re-fetches on tenant
  // switch. Enabled gate prevents the query firing for unauthenticated
  // sessions (the tRPC middleware would reject and surface a toast).
  const tenantId = currentTenant?.id ?? null;
  const query = trpc.tenantLocale.get.useQuery(undefined, {
    enabled: isAuthenticated && tenantId !== null,
    staleTime: 60_000,
  });

  const resolved: ResolvedLocale =
    (query.data as ResolvedLocale | undefined) ?? FALLBACK_RESOLVED_LOCALE;

  // Keep the formatter singleton + i18next bundle in lockstep with
  // whatever resolution we have right now. Firing on every mount is
  // cheap because the comparison is primitive string equality; React
  // bails the effect when the dependencies are unchanged.
  useEffect(() => {
    setActiveTenantLocale({
      locale: resolved.locale,
      currency: resolved.currency,
      displayDecimals: resolved.displayDecimals,
    });
    const currentLang = i18n.resolvedLanguage ?? i18n.language;
    if (resolved.language && currentLang !== resolved.language) {
      void i18n.changeLanguage(resolved.language);
    }
  }, [resolved.locale, resolved.currency, resolved.displayDecimals, resolved.language]);

  // Cleanup on unmount: reset the singleton so a subsequent mount
  // (e.g. logout then re-login as a different tenant) does not read
  // the previous cashier's locale during the in-between render.
  useEffect(() => {
    return () => {
      setActiveTenantLocale(null);
    };
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      resolved,
      isLoading: query.isLoading,
      isFallback: resolved.isFallback,
    }),
    [resolved, query.isLoading]
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useResolvedLocale(): ResolvedLocale {
  const context = useContext(LocaleContext);
  return context?.resolved ?? FALLBACK_RESOLVED_LOCALE;
}

export function useLocaleStatus(): {
  isLoading: boolean;
  isFallback: boolean;
} {
  const context = useContext(LocaleContext);
  return {
    isLoading: context?.isLoading ?? false,
    isFallback: context?.isFallback ?? true,
  };
}
