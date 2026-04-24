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
import { readLanguagePreference } from '@/i18n/resolveLocale';
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
  localeOverride: string | null;
  currencyOverride: string | null;
  timezoneOverride: string | null;
  firstDayOfWeekOverride: number | null;
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
  localeOverride: null,
  currencyOverride: null,
  timezoneOverride: null,
  firstDayOfWeekOverride: null,
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

  // Keep tenant-driven formatting + copy in lockstep only after the
  // tenant locale is known. While unauthenticated, leave i18next on
  // the user's persisted language instead of forcing the fallback
  // en-US bundle over the login screen.
  useEffect(() => {
    if (!isAuthenticated || tenantId === null || !query.data) {
      setActiveTenantLocale(null);
      return;
    }

    setActiveTenantLocale({
      locale: query.data.locale,
      currency: query.data.currency,
      displayDecimals: query.data.displayDecimals,
      timezone: query.data.timezone,
      dateFormatShort: query.data.dateFormatShort,
    });
    // Only follow the tenant's language when the user has NOT pinned
    // an explicit preference. `readLanguagePreference()` returns
    // `'system'` when localStorage carries no override; in that case
    // the tenant's resolved language is the source of truth. When the
    // user chose `'en'` or `'es'` via the header dropdown, that choice
    // must stick across login and tenant-switch — otherwise logging
    // in against a tenant whose country resolves to a different
    // language (or whose locale settings row is missing, falling back
    // to en-US) silently overwrites what the user picked.
    const userPreference = readLanguagePreference();
    const currentLang = i18n.resolvedLanguage ?? i18n.language;
    if (
      userPreference === 'system' &&
      query.data.language &&
      currentLang !== query.data.language
    ) {
      void i18n.changeLanguage(query.data.language);
    }
  }, [isAuthenticated, tenantId, query.data]);

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
