/**
 * ENG-017 — admin Locale & currency card.
 *
 * Lets the admin pick the tenant's country, optionally override
 * currency / locale / timezone / firstDayOfWeek, and see a live
 * preview of how currency amounts and dates will render before
 * saving. Save dispatches `tenantLocale.update` and invalidates the
 * `tenantLocale.get` cache so `LocaleProvider` re-hydrates
 * immediately — no reload needed.
 *
 * Live-preview is entirely client-side: we build a tentative
 * `ResolvedLocale` shape from the picker state + the catalog rows
 * (already fetched by the router) and feed it to `Intl.NumberFormat`
 * / `Intl.DateTimeFormat`. The server round-trip only happens on
 * Save.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe2 } from 'lucide-react';
import { useToast } from '@/components/feedback/ToastProvider';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';

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
      await utils.tenantLocale.get.invalidate();
      toast.success({
        title: t('localeSettings:toast.saveSuccessTitle'),
        description: t('localeSettings:toast.saveSuccessDescription', {
          country: variables.countryCode,
        }),
      });
    },
    onError: error => {
      toast.error({
        title: t('localeSettings:toast.saveErrorTitle'),
        description: translateServerError(
          error,
          t,
          t('localeSettings:toast.saveErrorFallback')
        ),
      });
    },
  });

  const countries = countriesQuery.data ?? EMPTY_COUNTRIES;
  const currencies = currenciesQuery.data ?? EMPTY_CURRENCIES;
  const current = currentQuery.data;

  const effectiveCountryCode = pickedCountry ?? current?.countryCode ?? null;
  const effectiveCurrencyOverride =
    currencyOverride ?? current?.currencyOverride ?? '';
  const effectiveLocaleOverride =
    localeOverride ?? current?.localeOverride ?? '';
  const effectiveTimezoneOverride =
    timezoneOverride ?? current?.timezoneOverride ?? '';
  const effectiveFirstDayOverride =
    firstDayOverride ??
    (current?.firstDayOfWeekOverride === null ||
    current?.firstDayOfWeekOverride === undefined
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
        effectiveLocaleOverride.length > 0
          ? effectiveLocaleOverride
          : countryRow.defaultLocale,
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
      countryCode: effectiveCountryCode,
      localeOverride:
        effectiveLocaleOverride.trim().length > 0
          ? effectiveLocaleOverride.trim()
          : null,
      currencyOverride:
        effectiveCurrencyOverride.trim().length > 0
          ? effectiveCurrencyOverride.trim()
          : null,
      timezoneOverride:
        effectiveTimezoneOverride.trim().length > 0
          ? effectiveTimezoneOverride.trim()
          : null,
      firstDayOfWeekOverride:
        effectiveFirstDayOverride === '0'
          ? 0
          : effectiveFirstDayOverride === '1'
            ? 1
            : null,
    });
  };

  const saveDisabled =
    mutation.isPending || !effectiveCountryCode || currentQuery.isLoading;

  return (
    <section className="card p-6 space-y-5" data-testid="company-locale-card">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary-100">
          <Globe2 className="h-5 w-5 text-secondary-700" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">
            {t('localeSettings:card.title')}
          </h2>
          <p className="text-sm text-secondary-500">
            {t('localeSettings:card.description')}
          </p>
        </div>
      </div>

      <label className="block text-sm">
        <span className="font-medium text-secondary-800">
          {t('localeSettings:card.countryLabel')}
        </span>
        <select
          className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-2 text-sm"
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
      </label>

      {countryRow && !countryRow.uiLocaleReady && (
        <p
          className="surface-panel-muted text-sm text-secondary-600"
          role="status"
        >
          {t('localeSettings:card.uiNotReadyWarning', {
            language: countryRow.generalLocale,
          })}
        </p>
      )}

      <details className="rounded-xl border border-secondary-200 bg-secondary-50/60 px-4 py-3 open:pb-4">
        <summary className="cursor-pointer text-sm font-medium text-secondary-800">
          {t('localeSettings:card.overrideSection')}
        </summary>
        <p className="mt-2 text-xs text-secondary-500">
          {t('localeSettings:card.overrideHint')}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-secondary-800">
              {t('localeSettings:card.currencyOverrideLabel')}
            </span>
            <select
              className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-2 text-sm"
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
          </label>
          <label className="block text-sm">
            <span className="font-medium text-secondary-800">
              {t('localeSettings:card.localeOverrideLabel')}
            </span>
            <input
              type="text"
              className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-2 text-sm"
              value={effectiveLocaleOverride}
              onChange={event => setLocaleOverride(event.target.value)}
              placeholder={t('localeSettings:card.localeOverridePlaceholder', {
                default: countryRow?.defaultLocale ?? '—',
              })}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-secondary-800">
              {t('localeSettings:card.timezoneOverrideLabel')}
            </span>
            <input
              type="text"
              className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-2 text-sm"
              value={effectiveTimezoneOverride}
              onChange={event => setTimezoneOverride(event.target.value)}
              placeholder={t('localeSettings:card.timezoneOverridePlaceholder', {
                default: countryRow?.defaultTimezone ?? '—',
              })}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-secondary-800">
              {t('localeSettings:card.firstDayOfWeekLabel')}
            </span>
            <select
              className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-2 text-sm"
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
          </label>
        </div>
      </details>

      <div
        className="rounded-xl border border-primary-200 bg-primary-50/60 p-4"
        data-testid="locale-preview"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-700">
          {t('localeSettings:card.previewHeading')}
        </p>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-secondary-600">
              {t('localeSettings:card.previewSampleAmount')}
            </dt>
            <dd
              className="text-lg font-semibold text-secondary-900"
              data-testid="locale-preview-amount"
            >
              {previewCurrency}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-secondary-600">
              {t('localeSettings:card.previewSampleDate')}
            </dt>
            <dd
              className="text-lg font-semibold text-secondary-900"
              data-testid="locale-preview-date"
            >
              {previewDate}
            </dd>
          </div>
        </dl>
      </div>

      <div>
        <button
          type="button"
          className="btn-primary"
          onClick={handleSave}
          disabled={saveDisabled}
          data-testid="locale-save"
        >
          {mutation.isPending
            ? t('localeSettings:card.savingAction')
            : t('localeSettings:card.saveAction')}
        </button>
      </div>
    </section>
  );
}
