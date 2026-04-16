import { Bell, KeyRound, LogOut, Menu, Search, User, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/form-controls/Select';
import { ChangePasswordModal } from '@/features/auth/ChangePasswordModal';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import {
  persistLanguagePreference,
  readLanguagePreference,
  resolveLocale,
  type LanguagePreference,
} from '@/i18n/resolveLocale';
import { isOnline } from '@/lib/utils';

interface HeaderProps {
  onOpenSidebar: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const { user, logout } = useAuth();
  const { currentTenant, currentSite, isLoadingSites, sites, switchSite } = useTenant();
  const { t, i18n } = useTranslation(['common', 'nav']);
  const [online, setOnline] = useState(isOnline());
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(() =>
    readLanguagePreference()
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const siteOptions = sites.map(site => ({
    value: site.id,
    label: site.name,
  }));

  const languageOptions = [
    { value: 'system', label: t('common:language.options.system') },
    { value: 'es', label: t('common:language.options.es') },
    { value: 'en', label: t('common:language.options.en') },
  ] satisfies Array<{ value: LanguagePreference; label: string }>;

  const handleLanguageChange = (value: string | number | null) => {
    if (value !== 'system' && value !== 'es' && value !== 'en') {
      return;
    }

    setLanguagePreference(value);
    persistLanguagePreference(value);
    void i18n.changeLanguage(resolveLocale(value));
  };

  return (
    <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6 xl:px-8">
      <div className="shell-panel px-4 py-3 sm:px-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(18rem,21rem)_minmax(0,1fr)] xl:items-start 2xl:grid-cols-[minmax(19rem,23rem)_minmax(0,1fr)]">
          <div className="flex items-start gap-3">
            <button
              type="button"
              className="btn-outline btn-icon mobile-shell-toggle xl:hidden"
              onClick={onOpenSidebar}
              aria-label={t('auth:login.openNavigation')}
            >
              <Menu className="h-5.5 w-5.5 shrink-0 text-current" strokeWidth={2.35} />
            </button>

            <div className="min-w-0 space-y-2">
              <p className="page-kicker text-[0.62rem] tracking-[0.24em]">{t('nav:header.kicker')}</p>
              <div className="space-y-2">
                <h2 className="font-display text-[clamp(1.8rem,2vw,2.3rem)] leading-[0.96] text-secondary-950">
                  {t('nav:header.title')}
                </h2>
                {currentTenant && <span className="badge badge-secondary">{currentTenant.name}</span>}
              </div>
            </div>
          </div>

          <div className="grid gap-3 2xl:grid-cols-[minmax(16rem,1fr)_auto] 2xl:items-start">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
              <input className="input pl-10" placeholder={t('common:quickSearch')} />
            </div>

            <div className="flex flex-wrap items-center gap-3 2xl:justify-end">
              <div className={online ? 'badge badge-success' : 'badge badge-warning'}>
                {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {online ? t('common:status.online') : t('common:status.offline')}
              </div>

              <div className="w-[5.7rem] min-w-0 flex-none sm:w-[6.1rem]">
                <Select
                  options={languageOptions}
                  value={languagePreference}
                  onChange={handleLanguageChange}
                  placeholder={t('common:language.placeholder')}
                  label={t('common:language.label')}
                  className="select-trigger"
                  triggerLabelClassName="max-w-[3.1rem]"
                />
              </div>

              <div className="min-w-[11.5rem] flex-1 sm:min-w-[12.5rem] xl:min-w-[13rem] xl:max-w-[15rem] xl:flex-none">
                <Select
                  options={siteOptions}
                  value={currentSite?.id ?? null}
                  onChange={value => {
                    if (typeof value === 'string') {
                      void switchSite(value);
                    }
                  }}
                  placeholder={isLoadingSites ? t('common:loadingSites') : t('common:selectSite')}
                  disabled={isLoadingSites || siteOptions.length <= 1}
                  className="select-trigger"
                />
              </div>

              <button
                type="button"
                className="btn-outline btn-icon relative"
                aria-label={t('common:notifications')}
              >
                <Bell className="h-5 w-5" />
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger-500" />
              </button>

              <div className="relative shrink-0">
                <button
                  type="button"
                  className="btn-outline flex w-full min-w-[10.75rem] items-center justify-between gap-3 px-3 sm:w-auto"
                  onClick={() => setShowUserMenu(current => !current)}
                >
                  <div className="flex items-center gap-3">
                    <span className="pointer-events-none flex h-9 w-9 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
                      <User className="h-4.5 w-4.5" />
                    </span>
                    <span className="pointer-events-none min-w-0 text-left">
                      <span className="block truncate text-sm font-semibold text-secondary-950">
                        {user?.name ?? t('common:user')}
                      </span>
                      <span className="hidden truncate text-xs text-secondary-500 xl:block">
                        {user?.role ?? t('common:session')}
                      </span>
                    </span>
                  </div>
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 z-20 mt-3 w-72 animate-pop-in rounded-[24px] border border-line bg-card p-3 shadow-[var(--shadow-panel)]">
                    <div className="card-inset px-4 py-3">
                      <p className="text-sm font-semibold text-secondary-950">{user?.name}</p>
                      <p className="mt-1 text-xs text-secondary-500">{user?.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowUserMenu(false);
                        setIsChangePasswordOpen(true);
                      }}
                      className="btn-ghost mt-3 w-full justify-start px-3"
                    >
                      <KeyRound className="h-4 w-4" />
                      {t('common:changePassword')}
                    </button>
                    <button
                      type="button"
                      onClick={logout}
                      className="btn-ghost mt-2 w-full justify-start px-3"
                    >
                      <LogOut className="h-4 w-4" />
                      {t('common:signOut')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
      />
    </header>
  );
}
