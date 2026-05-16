import { Bell, KeyRound, LogOut, Menu, Search, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/form-controls/Select';
import { ChangePasswordModal } from '@/features/auth/ChangePasswordModal';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { FiscalContingencyIndicator } from '@/features/fiscal/FiscalContingencyIndicator';
import {
  persistLanguagePreference,
  readLanguagePreference,
  resolveLocale,
  type LanguagePreference,
} from '@/i18n/resolveLocale';
import { isOnline } from '@/lib/utils';
import { useHeaderTitle } from './useHeaderTitle';

interface HeaderProps {
  onOpenSidebar: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const { user, logout } = useAuth();
  const { currentSite, currentTenant, isLoadingSites, sites, switchSite } = useTenant();
  const { t, i18n } = useTranslation(['common', 'nav', 'auth']);
  const { kickerKey, titleKey } = useHeaderTitle();
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
    <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6 xl:px-[22px]">
      <div className="flex flex-nowrap items-center gap-3 rounded-[28px] border border-line/80 bg-surface/90 px-3.5 py-2.5 shadow-[var(--shadow-panel)] backdrop-blur-xl">
        <button
          type="button"
          className="btn-outline btn-icon mobile-shell-toggle shrink-0 rounded-full xl:hidden"
          onClick={onOpenSidebar}
          aria-label={t('auth:login.openNavigation')}
        >
          <Menu className="h-5.5 w-5.5 shrink-0 text-current" strokeWidth={2.35} />
        </button>

        <div
          data-testid="header-page-heading"
          className="flex min-w-0 shrink-0 flex-col gap-0.5 border-r border-line/70 pr-3"
        >
          <p className="truncate text-[9.5px] font-semibold uppercase tracking-[0.24em] text-primary-600">
            {t(kickerKey)}
          </p>
          <h2 className="truncate font-display text-[16px] leading-none tracking-[-0.02em] text-secondary-950 sm:text-[18px] lg:text-[22px] lg:tracking-[-0.03em]">
            {t(titleKey)}
          </h2>
          <p
            className="hidden truncate text-[9.5px] font-semibold uppercase tracking-[0.2em] text-secondary-500 lg:block"
            data-testid="header-tenant-badge"
          >
            {currentTenant?.name ?? ''}
          </p>
        </div>

        <div className="relative min-w-0 flex-[1_1_220px]">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary-500" />
          <input
            className="h-10 w-full rounded-full border border-line-strong/55 bg-surface-2/70 px-3.5 pl-10 text-[13px] text-secondary-700 outline-none transition focus:border-primary-300 focus:bg-white focus:ring-4 focus:ring-primary-100/60"
            placeholder={t('common:quickSearch')}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div
            className={
              online
                ? 'hidden items-center gap-1.5 rounded-full bg-success-50 px-3 py-2 text-success-700 md:inline-flex'
                : 'hidden items-center gap-1.5 rounded-full bg-warning-50 px-3 py-2 text-warning-700 md:inline-flex'
            }
          >
            <span
              className={online ? 'h-1.5 w-1.5 rounded-full bg-success-500' : 'h-1.5 w-1.5 rounded-full bg-warning-500'}
            />
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">
              {online ? t('common:status.online') : t('common:status.offline')}
            </span>
          </div>

          <FiscalContingencyIndicator />

          <div className="hidden w-[7rem] min-w-0 flex-none sm:block">
            <Select
              options={languageOptions}
              value={languagePreference}
              onChange={handleLanguageChange}
              placeholder={t('common:language.placeholder')}
              className="h-10 rounded-full border-line/70 bg-surface-2/70 px-3 text-[12.5px]"
              triggerLabelClassName="max-w-[3.4rem]"
            />
          </div>

          <div className="hidden min-w-[8.75rem] flex-none sm:block 2xl:min-w-[9.5rem]">
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
              className="h-10 rounded-full border-line/70 bg-surface-2/70 px-3 text-[12.5px]"
            />
          </div>

          <button
            type="button"
            className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line/70 bg-surface-2/70 text-secondary-700 transition hover:border-primary-200 hover:bg-primary-50/80 hover:text-primary-700"
            aria-label={t('common:notifications')}
          >
            <Bell className="h-4 w-4" />
            <span className="absolute right-2.5 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
          </button>

          <div className="relative shrink-0">
            <button
              type="button"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-line/70 bg-surface-2/70 py-1.5 pl-2 pr-3 text-secondary-700 transition hover:border-primary-200 hover:bg-primary-50/80 hover:text-primary-700"
              onClick={() => setShowUserMenu(current => !current)}
            >
              <span className="pointer-events-none flex h-[30px] w-[30px] items-center justify-center rounded-full bg-primary-100 text-primary-700">
                <User className="h-3.5 w-3.5" />
              </span>
              <span className="pointer-events-none hidden min-w-0 text-left sm:block">
                <span className="block max-w-[8.5rem] truncate text-[12.5px] font-semibold text-secondary-950">
                  {user?.name ?? t('common:user')}
                </span>
                <span className="block truncate text-[10.5px] leading-none text-secondary-500">
                  {user?.role ?? t('common:session')}
                </span>
              </span>
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
      <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
      />
    </header>
  );
}
