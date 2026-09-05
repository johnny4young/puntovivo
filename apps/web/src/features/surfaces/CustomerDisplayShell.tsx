/**
 * Customer Display shell.
 *
 * Authority-free second-monitor chrome around the privacy-minimal cart mirror.
 * The isolated entry does not mount AuthProvider, tenant queries or tRPC; the
 * close action affects only this display and can never clear the POS session.
 *
 * @module features/surfaces/CustomerDisplayShell
 */

import { Suspense, useState } from 'react';
import { Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import {
  persistLanguagePreference,
  readLanguagePreference,
  resolveBootLocale,
  type LanguagePreference,
} from '@/i18n/resolveLocale';

export function CustomerDisplayShell() {
  const { t, i18n } = useTranslation(['common', 'customerDisplay']);
  const [language, setLanguage] = useState<LanguagePreference>(() => readLanguagePreference());

  const handleLanguageChange = (preference: LanguagePreference) => {
    setLanguage(preference);
    persistLanguagePreference(preference);
    void i18n.changeLanguage(resolveBootLocale());
  };

  return (
    <div
      className="flex min-h-screen flex-col bg-gradient-to-br from-primary-50 to-secondary-50 text-secondary-950"
      data-testid="customer-display-shell"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/70 bg-white/80 px-5 py-3 backdrop-blur sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary-700 font-display text-sm font-bold text-white shadow-sm"
            aria-hidden="true"
          >
            P
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold text-secondary-950">
              {t('customerDisplay:shell.product')}
            </p>
            <p className="truncate text-xs text-secondary-500">
              {t('customerDisplay:shell.privacy')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="customer-display-language">
            {t('customerDisplay:shell.language')}
          </label>
          <select
            id="customer-display-language"
            value={language}
            onChange={event => handleLanguageChange(event.target.value as LanguagePreference)}
            className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-secondary-700"
          >
            <option value="system">{t('common:language.options.system')}</option>
            <option value="es">{t('common:language.options.es')}</option>
            <option value="en">{t('common:language.options.en')}</option>
          </select>
          <button
            type="button"
            onClick={() => window.close()}
            className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-white text-secondary-600 transition hover:border-danger-300 hover:text-danger-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-100"
            aria-label={t('customerDisplay:shell.close')}
            title={t('customerDisplay:shell.close')}
            data-testid="customer-display-close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>
      <main className="flex-1 px-4 py-5 sm:px-8 sm:py-8">
        <Suspense
          fallback={
            <PageLoadingState
              title={t('loading.pageTitle')}
              description={t('loading.pageDescription')}
            />
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
