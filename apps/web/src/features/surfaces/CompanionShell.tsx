/**
 * Companion shell.
 *
 * Phone-width chrome for the read-only owner companion: the surface a
 * business owner opens away from the counter to see how the day is
 * going. Same clamped `max-w-md` container as the mobile waiter so it
 * renders honestly on a desktop browser during development.
 *
 * Role + module gating live in `SurfaceShellRoute`; this shell is pure
 * presentational chrome around its `<Outlet />`.
 *
 * @module features/surfaces/CompanionShell
 */

import { Suspense, useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  persistLanguagePreference,
  readLanguagePreference,
  resolveBootLocale,
  type LanguagePreference,
} from '@/i18n/resolveLocale';
import { registerCompanionServiceWorker } from './companionPwa';

export function CompanionShell() {
  const { logout } = useAuth();
  const { t, i18n } = useTranslation(['common', 'companion']);
  const [language, setLanguage] = useState<LanguagePreference>(() => readLanguagePreference());

  useEffect(() => {
    void registerCompanionServiceWorker();
  }, []);

  const handleLanguageChange = (preference: LanguagePreference) => {
    setLanguage(preference);
    persistLanguagePreference(preference);
    void i18n.changeLanguage(resolveBootLocale());
  };

  return (
    <div
      className="mx-auto flex min-h-screen max-w-md flex-col bg-surface text-secondary-950"
      data-testid="companion-shell"
    >
      <header className="sticky top-0 z-20 border-b border-line/80 bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-700 font-display text-sm font-bold text-white shadow-sm"
              aria-hidden="true"
            >
              P
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-secondary-950">
                {t('companion:shell.product')}
              </p>
              <p className="truncate text-xs text-secondary-500">{t('companion:shell.readOnly')}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="sr-only" htmlFor="companion-language">
              {t('common:language.label')}
            </label>
            <select
              id="companion-language"
              value={language}
              onChange={event => handleLanguageChange(event.target.value as LanguagePreference)}
              className="h-9 rounded-lg border border-line bg-surface px-2 text-xs font-semibold text-secondary-700"
              data-testid="companion-language"
            >
              <option value="system">{t('common:language.options.system')}</option>
              <option value="es">{t('common:language.options.es')}</option>
              <option value="en">{t('common:language.options.en')}</option>
            </select>
            <button
              type="button"
              onClick={() => void logout()}
              className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface text-secondary-600 transition hover:border-danger-300 hover:text-danger-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-100"
              aria-label={t('companion:shell.logout')}
              title={t('companion:shell.logout')}
              data-testid="companion-logout"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-4">
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
