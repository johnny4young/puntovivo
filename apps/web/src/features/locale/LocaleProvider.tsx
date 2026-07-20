/**
 * /  — tenant locale state.
 *
 * Originally a React context provider;  migrated it to a Zustand
 * store so it no longer re-creates a context value on every render of the
 * provider stack. `useLocaleSync()` (mounted once via `<LocaleSync />` in
 * `App.tsx`) fetches the resolved locale from `tenantLocale.get` on mount
 * and whenever `currentTenant.id` changes, then:
 * - writes the snapshot into the store (read by `useResolvedLocale()`),
 * - pushes a snapshot into the `setActiveTenantLocale` singleton in
 * `apps/web/src/lib/utils.ts` so the existing ~140 call sites of
 * `formatCurrency(amount)` pick up the new defaults without a
 * render-path change,
 * - dispatches `i18n.changeLanguage(language)` when the resolved language
 * changes AND the user has not pinned an explicit preference.
 *
 * On logout / unauthenticated the singleton is reset to `null` and the
 * store falls back to en-US so a subsequent login as a different tenant
 * never reads the previous cashier's locale.
 *
 * @module features/locale/LocaleProvider
 */

import { useEffect } from 'react';
import { create } from 'zustand';
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

/**
 * Internal Zustand store holding the resolved tenant locale. `resolved`
 * starts on the en-US fallback so pre-auth renders (login screen) have a
 * valid shape; `useLocaleSync` replaces it once the tenant locale loads
 * and resets it on logout.
 */
interface LocaleStore {
  resolved: ResolvedLocale;
  setResolved(resolved: ResolvedLocale): void;
  reset(): void;
}

const useLocaleStore = create<LocaleStore>(set => ({
  resolved: FALLBACK_RESOLVED_LOCALE,
  setResolved(resolved) {
    set({ resolved });
  },
  reset() {
    set({ resolved: FALLBACK_RESOLVED_LOCALE });
  },
}));

/**
 * Bridges the `tenantLocale.get` tRPC query into the store and rehomes the
 * locale side-effects (singleton push + conditional `i18n.changeLanguage`).
 * Mount exactly once via `<LocaleSync />` inside `AuthProvider` +
 * `TenantProvider` in `App.tsx`.
 */
export function useLocaleSync(): void {
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

  // Keep tenant-driven formatting + copy in lockstep only after the tenant
  // locale is known. While unauthenticated, leave i18next on the user's
  // persisted language instead of forcing the fallback en-US bundle over
  // the login screen.
  useEffect(() => {
    if (!isAuthenticated || tenantId === null || !query.data) {
      setActiveTenantLocale(null);
      useLocaleStore.getState().reset();
      return;
    }

    const data = query.data as ResolvedLocale;
    setActiveTenantLocale({
      locale: data.locale,
      currency: data.currency,
      displayDecimals: data.displayDecimals,
      timezone: data.timezone,
      dateFormatShort: data.dateFormatShort,
    });
    useLocaleStore.getState().setResolved(data);

    // Only follow the tenant's language when the user has NOT pinned an
    // explicit preference. `readLanguagePreference()` returns `'system'`
    // when localStorage carries no override; in that case the tenant's
    // resolved language is the source of truth. When the user chose `'en'`
    // or `'es'` via the header dropdown, that choice must stick across
    // login and tenant-switch — otherwise logging in against a tenant
    // whose country resolves to a different language (or whose locale
    // settings row is missing, falling back to en-US) silently overwrites
    // what the user picked.
    const userPreference = readLanguagePreference();
    const currentLang = i18n.resolvedLanguage ?? i18n.language;
    if (userPreference === 'system' && data.language && currentLang !== data.language) {
      void i18n.changeLanguage(data.language);
    }
  }, [isAuthenticated, tenantId, query.data]);

  // Cleanup on unmount: reset the singleton so a subsequent mount (e.g.
  // hot-reload, or a future remount of the sync host) does not read a
  // stale cashier's locale during the in-between render.
  useEffect(() => {
    return () => {
      setActiveTenantLocale(null);
    };
  }, []);
}

/**
 * Null-rendering mount point for `useLocaleSync`. Placed inside
 * `AuthProvider` + `TenantProvider` in `App.tsx`.
 */
export function LocaleSync(): null {
  useLocaleSync();
  return null;
}

/**
 * Read the resolved tenant locale. Returns the en-US fallback before the
 * tenant locale loads (or while unauthenticated). Selector-based so a
 * consumer only re-renders when `resolved` actually changes.
 */
export function useResolvedLocale(): ResolvedLocale {
  return useLocaleStore(state => state.resolved);
}

/**
 * Test-only escape hatch to drive the store directly without mounting the
 * sync hook. Not exported from any barrel.
 */
export const __localeStoreForTests = useLocaleStore;
