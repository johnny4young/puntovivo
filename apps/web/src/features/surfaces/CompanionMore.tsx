import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, LogOut } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  persistLanguagePreference,
  readLanguagePreference,
  resolveBootLocale,
  type LanguagePreference,
} from '@/i18n/resolveLocale';
import { trpc } from '@/lib/trpc';
import { dropBrowserPush } from './companionPush';
import { CompanionPushCard } from './CompanionPushCard';
import { isCompanionOwner } from './companionViews';

/** Settings that belong to this phone: notifications, language and the session. */
export function CompanionMore() {
  const { logout, user } = useAuth();
  const unsubscribePush = trpc.ownerPush.unsubscribe.useMutation();
  const { t, i18n } = useTranslation(['common', 'companion']);
  const [language, setLanguage] = useState<LanguagePreference>(() => readLanguagePreference());
  const owner = isCompanionOwner(user?.role);

  const handleLogout = async () => {
    if (owner) {
      await dropBrowserPush(endpoint => unsubscribePush.mutateAsync({ endpoint }));
    }
    await logout();
  };

  const handleLanguageChange = (preference: LanguagePreference) => {
    setLanguage(preference);
    persistLanguagePreference(preference);
    void i18n.changeLanguage(resolveBootLocale());
  };

  return (
    <div className="space-y-5" data-testid="companion-more">
      <header>
        <h1 className="text-[1.9rem] leading-tight">{t('companion:more.title')}</h1>
        {!owner && <p className="text-sm text-fg3">{t('companion:shell.readOnly')}</p>}
      </header>

      {owner && <CompanionPushCard />}

      <section className="card divide-y divide-line p-0">
        <label className="flex min-h-14 items-center justify-between gap-3 px-4">
          <span className="text-sm font-semibold text-fg1">{t('common:language.label')}</span>
          <select
            value={language}
            onChange={event => handleLanguageChange(event.target.value as LanguagePreference)}
            className="h-10 rounded-lg border border-line bg-surface pr-8 pl-3 text-sm font-semibold text-fg2"
            data-testid="companion-language"
          >
            <option value="system">{t('common:language.options.system')}</option>
            <option value="es">{t('common:language.options.es')}</option>
            <option value="en">{t('common:language.options.en')}</option>
          </select>
        </label>
        {owner && (
          <a
            href="/"
            className="flex min-h-14 items-center justify-between gap-3 px-4 text-sm font-semibold text-fg1"
            data-testid="companion-open-app"
          >
            {t('companion:more.openApp')}
            <ExternalLink className="h-4 w-4 text-fg3" aria-hidden="true" />
          </a>
        )}
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left text-sm font-semibold text-danger-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-100"
          data-testid="companion-logout"
        >
          {t('companion:shell.logout')}
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </button>
      </section>
    </div>
  );
}
