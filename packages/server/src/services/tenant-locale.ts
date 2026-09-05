/**
 * Tenant locale resolver ().
 *
 * A single function — `resolveTenantLocale` — reads the tenant's row
 * in `tenant_locale_settings`, joins `country_catalog` + `currency_catalog`,
 * applies null-override-shadow logic, and returns the resolved shape
 * that every downstream formatter needs. Callers never touch the three
 * tables directly.
 *
 * Fallback strategy: when the tenant has no row in
 * `tenant_locale_settings` (fresh install, never-configured tenant),
 * the resolver keeps a neutral US locale/timezone but reads the tenant's
 * authoritative transaction currency. This keeps UI rendering safe during
 * setup without letting the cart disagree with the currency frozen at sale.
 *
 * @module services/tenant-locale
 */

import { eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../db/index.js';
import {
  countryCatalog,
  currencyCatalog,
  tenantLocaleSettings,
  tenants,
  type CountryCatalogRow,
  type CurrencyCatalogRow,
  type TenantLocaleSettingsRow,
} from '../db/schema.js';

/**
 * Shape consumed by every formatter — server-side (receipt renderer,
 * quotation PDF) and client-side (`LocaleProvider`). Keep it flat so
 * serialization through tRPC is cheap.
 */
export interface ResolvedLocale {
  /** BCP-47 locale for `Intl.*` (e.g. 'es-CO', 'en-US'). */
  locale: string;
  /** Primary language subtag for `i18next.changeLanguage` (e.g. 'es'). */
  language: string;
  /** Country code (ISO 3166-1 alpha-2). Returned for admin UI use. */
  countryCode: string;
  /** Currency code (ISO 4217) used by `Intl.NumberFormat`. */
  currency: string;
  currencySymbol: string;
  /** Legal decimals from ISO 4217 (used by fiscal / accounting). */
  legalDecimals: number;
  /** Display decimals for POS rendering (e.g. COP=0 even though legal=2). */
  displayDecimals: number;
  /** IANA timezone (e.g. 'America/Bogota'). */
  timezone: string;
  /** 0=Sunday, 1=Monday. */
  firstDayOfWeek: number;
  /** Short-format hint shown in admin preview. */
  dateFormatShort: string;
  /** Raw admin overrides so the settings UI can preserve untouched fields. */
  localeOverride: string | null;
  currencyOverride: string | null;
  timezoneOverride: string | null;
  firstDayOfWeekOverride: number | null;
  /**
   * optimistic-concurrency token of the underlying
   * `tenant_locale_settings` row (0 for the fallback / unconfigured tenant).
   * The admin locale card round-trips this on save so a stale overwrite is
   * rejected with STALE_VERSION.
   */
  version: number;
  /** Whether i18next has bundles for `language` — BR/pt-BR starts false. */
  uiLocaleReady: boolean;
  /** True when the resolver hit the hardcoded fallback path. */
  isFallback: boolean;
}

/**
 * Fallback used when the tenant has no `tenant_locale_settings` row
 * yet (pre-onboarding) or when a catalog join fails for an unexpected
 * reason. Matches the US / USD baseline so numbers keep rendering.
 */
export const LOCALE_FALLBACK: ResolvedLocale = {
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
  version: 0,
  uiLocaleReady: true,
  isFallback: true,
};

function combine(
  settings: TenantLocaleSettingsRow,
  country: CountryCatalogRow,
  currency: CurrencyCatalogRow
): ResolvedLocale {
  const locale = settings.localeOverride ?? country.defaultLocale;
  // The primary language subtag (BCP-47 before the first hyphen) is
  // what i18next can resolve today. Fine to recompute on every call;
  // the function is cheap and consumers memoize on their side.
  const language = locale.includes('-') ? locale.slice(0, locale.indexOf('-')) : locale;
  return {
    locale,
    language,
    countryCode: country.code,
    currency: currency.code,
    currencySymbol: currency.symbol,
    legalDecimals: currency.decimals,
    displayDecimals: currency.displayDecimals,
    timezone: settings.timezoneOverride ?? country.defaultTimezone,
    firstDayOfWeek: settings.firstDayOfWeekOverride ?? country.firstDayOfWeek,
    dateFormatShort: country.dateFormatShort,
    localeOverride: settings.localeOverride,
    currencyOverride: settings.currencyOverride,
    timezoneOverride: settings.timezoneOverride,
    firstDayOfWeekOverride: settings.firstDayOfWeekOverride,
    version: settings.version,
    uiLocaleReady: country.uiLocaleReady ?? true,
    isFallback: false,
  };
}

/**
 * An unconfigured tenant still has an authoritative transaction currency on
 * `tenants.default_currency_code`. Keep the neutral US locale/timezone
 * fallback, but hydrate its money metadata from that row so the cart and a
 * newly persisted sale can never render different currencies during setup.
 */
async function resolveCurrencyAwareFallback(
  db: DatabaseInstance,
  tenantId: string
): Promise<ResolvedLocale> {
  const tenantCurrency = await db
    .select({
      code: currencyCatalog.code,
      symbol: currencyCatalog.symbol,
      decimals: currencyCatalog.decimals,
      displayDecimals: currencyCatalog.displayDecimals,
    })
    .from(tenants)
    .innerJoin(currencyCatalog, eq(currencyCatalog.code, tenants.defaultCurrencyCode))
    .where(eq(tenants.id, tenantId))
    .get();

  if (!tenantCurrency) return LOCALE_FALLBACK;
  return {
    ...LOCALE_FALLBACK,
    currency: tenantCurrency.code,
    currencySymbol: tenantCurrency.symbol,
    legalDecimals: tenantCurrency.decimals,
    displayDecimals: tenantCurrency.displayDecimals,
  };
}

/**
 * Resolve the effective locale for a tenant. Single database round-trip
 * (one join across three tables) so callers can invoke this once per
 * request without a noticeable cost.
 *
 * Returns the neutral fallback locale when the tenant has never been
 * configured, while preserving its authoritative transaction currency.
 */
export async function resolveTenantLocale(
  db: DatabaseInstance,
  tenantId: string
): Promise<ResolvedLocale> {
  const settings = await db
    .select()
    .from(tenantLocaleSettings)
    .where(eq(tenantLocaleSettings.tenantId, tenantId))
    .get();

  if (!settings) {
    return resolveCurrencyAwareFallback(db, tenantId);
  }

  const country = await db
    .select()
    .from(countryCatalog)
    .where(eq(countryCatalog.code, settings.countryCode))
    .get();

  if (!country) {
    // Stale FK — shouldn't happen in practice because the DB enforces
    // the reference, but treat it as a soft fallback rather than
    // crashing the request.
    return resolveCurrencyAwareFallback(db, tenantId);
  }

  // Override wins; default comes from the country row when null.
  const effectiveCurrencyCode = settings.currencyOverride ?? country.defaultCurrencyCode;
  const currency = await db
    .select()
    .from(currencyCatalog)
    .where(eq(currencyCatalog.code, effectiveCurrencyCode))
    .get();

  if (!currency) {
    return resolveCurrencyAwareFallback(db, tenantId);
  }

  return combine(settings, country, currency);
}
