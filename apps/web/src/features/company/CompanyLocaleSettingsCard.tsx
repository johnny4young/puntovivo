/**
 * admin Locale & currency card.
 *
 * Lets the admin pick the tenant's country, optionally override
 * currency / locale / timezone / firstDayOfWeek, and see a live
 * preview of how currency amounts and dates will render before
 * saving. Save dispatches `tenantLocale.update` and invalidates the
 * `tenantLocale.get` cache so `LocaleProvider` re-hydrates
 * immediately — no reload needed. Readiness caches are also
 * invalidated because the market profile keys off countryCode.
 *
 * Live-preview is entirely client-side: we build a tentative
 * `ResolvedLocale` shape from the picker state + the catalog rows
 * (already fetched by the router) and feed it to `Intl.NumberFormat`
 * / `Intl.DateTimeFormat`. The server round-trip only happens on
 * Save.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Globe2 } from 'lucide-react';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { extractServerErrorCode } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui';
const EMPTY_COUNTRIES: readonly never[] = [];
const EMPTY_CURRENCIES: readonly never[] = [];
export function CompanyLocaleSettingsCard() {
  const { t, i18n } = useTranslation(['localeSettings', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const currentQuery = trpc.tenantLocale.get.useQuery();
  const countriesQuery = trpc.tenantLocale.listCountries.useQuery();
  const currenciesQuery = trpc.tenantLocale.listCurrencies.useQuery();

  // Local form state starts untouched; effective values are derived
  // from server data until the admin edits a field.
  const [pickedCountry, setPickedCountry] = useState<string | null>(null);
  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null);
  const [localeOverride, setLocaleOverride] = useState<string | null>(null);
  const [timezoneOverride, setTimezoneOverride] = useState<string | null>(null);
  const [firstDayOverride, setFirstDayOverride] = useState<string | null>(null);
  const mutation = trpc.tenantLocale.update.useMutation({
    onSuccess: async (_data, variables) => {
      await Promise.all([
        utils.tenantLocale.get.invalidate(),
        utils.setupReadiness.get.invalidate(),
        utils.setupReadiness.checkout.invalidate(),
      ]);
      toast.success({
        title: t('localeSettings:toast.saveSuccessTitle'),
        description: t('localeSettings:toast.saveSuccessDescription', {
          country: variables.countryCode,
        }),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'localeSettings:toast.saveErrorTitle',
      fallbackKey: 'localeSettings:toast.saveErrorFallback',
      // refresh the resolved locale on a STALE_VERSION conflict so
      // the next save round-trips the latest version.
      extra: (_description, error) => {
        if (extractServerErrorCode(error) === 'STALE_VERSION') {
          void utils.tenantLocale.get.invalidate();
        }
      },
    }),
  });
  const countries = countriesQuery.data ?? EMPTY_COUNTRIES;
  const currencies = currenciesQuery.data ?? EMPTY_CURRENCIES;
  const current = currentQuery.data;
  const effectiveCountryCode = pickedCountry ?? current?.countryCode ?? null;
  const effectiveCurrencyOverride = currencyOverride ?? current?.currencyOverride ?? '';
  const effectiveLocaleOverride = localeOverride ?? current?.localeOverride ?? '';
  const effectiveTimezoneOverride = timezoneOverride ?? current?.timezoneOverride ?? '';
  const effectiveFirstDayOverride =
    firstDayOverride ??
    (current?.firstDayOfWeekOverride === null || current?.firstDayOfWeekOverride === undefined
      ? ''
      : String(current.firstDayOfWeekOverride));
  const countryRow = useMemo(
    () => countries.find(c => c.code === effectiveCountryCode) ?? null,
    [countries, effectiveCountryCode]
  );
  const isSpanish = (i18n.resolvedLanguage ?? i18n.language).startsWith('es');

  // Tentative locale for the live-preview. Overrides shadow the
  // country's defaults; when an override is blank we fall back to the
  // country row. Falls back to US/USD when nothing is picked yet.
  const previewLocale = useMemo(() => {
    if (!countryRow) {
      return {
        locale: 'en-US',
        currency: 'USD',
        displayDecimals: 2,
        dateFormatShort: 'MM/dd/yyyy',
      };
    }
    const currencyCode =
      effectiveCurrencyOverride.length > 0
        ? effectiveCurrencyOverride
        : countryRow.defaultCurrencyCode;
    const currencyRow = currencies.find(c => c.code === currencyCode);
    return {
      locale:
        effectiveLocaleOverride.length > 0 ? effectiveLocaleOverride : countryRow.defaultLocale,
      currency: currencyCode,
      displayDecimals: currencyRow?.displayDecimals ?? 2,
      dateFormatShort: countryRow.dateFormatShort,
    };
  }, [countryRow, currencies, effectiveCurrencyOverride, effectiveLocaleOverride]);
  const previewCurrency = useMemo(() => {
    try {
      return new Intl.NumberFormat(previewLocale.locale, {
        style: 'currency',
        currency: previewLocale.currency,
        minimumFractionDigits: previewLocale.displayDecimals,
        maximumFractionDigits: previewLocale.displayDecimals,
      }).format(123456.789);
    } catch {
      return '—';
    }
  }, [previewLocale]);
  const previewDate = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(previewLocale.locale, {
        dateStyle: 'medium',
      }).format(new Date());
    } catch {
      return '—';
    }
  }, [previewLocale]);
  const handleSave = () => {
    if (!effectiveCountryCode) return;
    mutation.mutate({
      // round-trip the resolved row's version so a concurrent
      // edit from another admin tab is rejected with STALE_VERSION. Undefined
      // on legacy/no-row clients; the server treats fallback 0 as virtual and
      // stores the first real write as version 1.
      version: current?.version,
      countryCode: effectiveCountryCode,
      localeOverride:
        effectiveLocaleOverride.trim().length > 0 ? effectiveLocaleOverride.trim() : null,
      currencyOverride:
        effectiveCurrencyOverride.trim().length > 0 ? effectiveCurrencyOverride.trim() : null,
      timezoneOverride:
        effectiveTimezoneOverride.trim().length > 0 ? effectiveTimezoneOverride.trim() : null,
      firstDayOfWeekOverride:
        effectiveFirstDayOverride === '0' ? 0 : effectiveFirstDayOverride === '1' ? 1 : null,
    });
  };
  const saveDisabled = mutation.isPending || !effectiveCountryCode || currentQuery.isLoading;
  return (
    <section className="card p-6 space-y-6" data-testid="company-locale-card">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-secondary-100 text-secondary-700">
          <Globe2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="pv-kicker">
            {t('localeSettings:card.kicker', {
              defaultValue: isSpanish ? 'Localización' : 'Localization',
            })}
          </p>
          <h2 className="pv-title text-xl">{t('localeSettings:card.title')}</h2>
          <p className="mt-2 max-w-prose text-sm text-secondary-600">
            {t('localeSettings:card.description')}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="pv-field">
          <label htmlFor="locale-country-select" className="label">
            {t('localeSettings:card.countryLabel')}
          </label>
          <select
            id="locale-country-select"
            className="pv-input"
            value={effectiveCountryCode ?? ''}
            onChange={event => setPickedCountry(event.target.value || null)}
            data-testid="locale-country-select"
          >
            <option value="">{t('localeSettings:card.countryPlaceholder')}</option>
            {countries.map(country => (
              <option key={country.code} value={country.code}>
                {isSpanish ? country.nameEs : country.nameEn} ({country.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {countryRow && !countryRow.uiLocaleReady && (
        <p className="surface-panel-muted text-sm text-fg2" role="status">
          {t('localeSettings:card.uiNotReadyWarning', {
            language: countryRow.generalLocale,
          })}
        </p>
      )}

      <details className="surface-panel-muted group open:pb-1">
        <summary className="label flex cursor-pointer list-none items-center justify-between gap-3 text-fg1">
          <span>{t('localeSettings:card.overrideSection')}</span>
          <ChevronDown
            className="h-4 w-4 text-fg3 transition-transform duration-200 group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-fg3">
          {t('localeSettings:card.overrideHint')}
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="pv-field">
            <label htmlFor="locale-currency-override" className="label">
              {t('localeSettings:card.currencyOverrideLabel')}
            </label>
            <select
              id="locale-currency-override"
              className="pv-input"
              value={effectiveCurrencyOverride}
              onChange={event => setCurrencyOverride(event.target.value)}
              data-testid="locale-currency-override"
            >
              <option value="">
                {t('localeSettings:card.currencyOverridePlaceholder', {
                  default: countryRow?.defaultCurrencyCode ?? '—',
                })}
              </option>
              {currencies.map(currency => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} — {isSpanish ? currency.nameEs : currency.nameEn}
                </option>
              ))}
            </select>
          </div>
          <div className="pv-field">
            <label htmlFor="locale-locale-override" className="label">
              {t('localeSettings:card.localeOverrideLabel')}
            </label>
            <input
              id="locale-locale-override"
              type="text"
              className="pv-input"
              value={effectiveLocaleOverride}
              onChange={event => setLocaleOverride(event.target.value)}
              placeholder={t('localeSettings:card.localeOverridePlaceholder', {
                default: countryRow?.defaultLocale ?? '—',
              })}
            />
          </div>
          <div className="pv-field">
            <label htmlFor="locale-timezone-override" className="label">
              {t('localeSettings:card.timezoneOverrideLabel')}
            </label>
            <input
              id="locale-timezone-override"
              type="text"
              className="pv-input"
              value={effectiveTimezoneOverride}
              onChange={event => setTimezoneOverride(event.target.value)}
              placeholder={t('localeSettings:card.timezoneOverridePlaceholder', {
                default: countryRow?.defaultTimezone ?? '—',
              })}
            />
          </div>
          <div className="pv-field">
            <label htmlFor="locale-first-day-override" className="label">
              {t('localeSettings:card.firstDayOfWeekLabel')}
            </label>
            <select
              id="locale-first-day-override"
              className="pv-input"
              value={effectiveFirstDayOverride}
              onChange={event => setFirstDayOverride(event.target.value)}
            >
              <option value="">
                {t('localeSettings:card.firstDayOfWeekDefault', {
                  default:
                    countryRow?.firstDayOfWeek === 0
                      ? t('localeSettings:card.firstDayOfWeekSunday')
                      : t('localeSettings:card.firstDayOfWeekMonday'),
                })}
              </option>
              <option value="0">{t('localeSettings:card.firstDayOfWeekSunday')}</option>
              <option value="1">{t('localeSettings:card.firstDayOfWeekMonday')}</option>
            </select>
          </div>
        </div>
      </details>

      <div
        className="rounded-2xl border border-primary-200/45 bg-primary-50/45 p-4"
        data-testid="locale-preview"
      >
        <p className="pv-kicker">{t('localeSettings:card.previewHeading')}</p>
        <dl className="mt-3 flex items-end justify-between gap-4">
          <div>
            <dt className="label">{t('localeSettings:card.previewSampleAmount')}</dt>
            <dd
              className="mt-1 font-mono text-xl font-semibold tabular-nums text-fg1"
              data-testid="locale-preview-amount"
            >
              {previewCurrency}
            </dd>
          </div>
          <div className="text-right">
            <dt className="label">{t('localeSettings:card.previewSampleDate')}</dt>
            <dd
              className="mt-1 font-mono text-base tabular-nums text-fg1"
              data-testid="locale-preview-date"
            >
              {previewDate}
            </dd>
          </div>
        </dl>
      </div>

      <div>
        <Button
          type="button"
          className="disabled:cursor-not-allowed disabled:opacity-45"
          onClick={handleSave}
          disabled={saveDisabled}
          data-testid="locale-save"
          variant="primary"
        >
          {mutation.isPending
            ? t('localeSettings:card.savingAction')
            : t('localeSettings:card.saveAction')}
        </Button>
      </div>
    </section>
  );
}
