import { Bell, Check, ChevronDown, KeyRound, LogOut, Menu, Search, User, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandMark } from '@/components/brand/BrandMark';
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
import { cn, isOnline } from '@/lib/utils';

interface HeaderProps {
  onOpenSidebar: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const { user, logout } = useAuth();
  const { currentSite, currentTenant, isLoadingSites, sites, switchSite } = useTenant();
  const { t, i18n } = useTranslation(['common', 'nav']);
  const [online, setOnline] = useState(isOnline());
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(() =>
    readLanguagePreference()
  );
  const languageMenuRef = useRef<HTMLDivElement>(null);

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

  // Close language pill dropdown when the user clicks outside.
  useEffect(() => {
    if (!showLanguageMenu) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (languageMenuRef.current && !languageMenuRef.current.contains(event.target as Node)) {
        setShowLanguageMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showLanguageMenu]);

  const siteOptions = sites.map(site => ({
    value: site.id,
    label: site.name,
  }));

  // Language pill — three options, displayed inline with a tracked
  // uppercase "IDIOMA" kicker + 3-char short value (Esp / Eng / Auto)
  // matching the design system pill pattern. The full names live in
  // the dropdown menu below.
  const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ['system', 'es', 'en'];
  const languageShort = (key: LanguagePreference) => t(`common:language.short.${key}`);
  const languageLong = (key: LanguagePreference) => t(`common:language.options.${key}`);

  const handleLanguageChange = (value: LanguagePreference) => {
    setLanguagePreference(value);
    persistLanguagePreference(value);
    void i18n.changeLanguage(resolveLocale(value));
    setShowLanguageMenu(false);
  };

  // ENG-080 + ENG-080c — brand cluster shown on the left of the header
  // on >=2xl viewports (where there is enough room next to the sidebar)
  // and mirrors the design-system handoff topbar layout: BrandMark + a
  // 3-tier label stack with the workspace kicker (primary-700,
  // tracking-0.22em), the tenant name in semibold Inter, and the
  // active site name beneath. On smaller viewports the sidebar already
  // carries the brand, so we hide the cluster to avoid duplication.
  const brandCluster = (
    <div
      data-testid="header-brand-cluster"
      className="hidden min-w-0 shrink-0 items-center gap-3 border-r border-line/60 pr-4 2xl:flex"
    >
      <BrandMark className="h-10 w-10 shrink-0" label="" />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[0.55rem] font-semibold uppercase tracking-[0.22em] text-primary-700">
          {t('nav:brand.workspaceKicker')}
        </p>
        <p className="mt-1 truncate text-sm font-semibold tracking-[-0.005em] text-secondary-950">
          {currentTenant?.name ?? t('nav:brand.title')}
        </p>
        {currentSite?.name && (
          <p className="mt-1 truncate text-[0.62rem] font-medium uppercase tracking-[0.18em] text-fg3">
            {currentSite.name}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6 xl:px-8">
      <div className="shell-panel px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn-outline btn-icon mobile-shell-toggle xl:hidden shrink-0"
            onClick={onOpenSidebar}
            aria-label={t('auth:login.openNavigation')}
          >
            <Menu className="h-5.5 w-5.5 shrink-0 text-current" strokeWidth={2.35} />
          </button>

          {brandCluster}

          <div className="grid flex-1 gap-3 lg:grid-cols-[minmax(18rem,1fr)_auto] lg:items-end xl:items-center">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
              <input className="input pl-10" placeholder={t('common:quickSearch')} />
            </div>

            <div className="flex flex-wrap items-end gap-2.5 lg:justify-end">
              <div className={`${online ? 'badge badge-success' : 'badge badge-warning'} self-end`}>
                {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {online ? t('common:status.online') : t('common:status.offline')}
              </div>

              <FiscalContingencyIndicator />


              <div className="relative self-end" ref={languageMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowLanguageMenu(current => !current)}
                  aria-haspopup="menu"
                  aria-expanded={showLanguageMenu}
                  aria-label={t('common:language.label')}
                  className="btn-outline flex items-center gap-2 px-3"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="text-[0.55rem] font-semibold uppercase tracking-[0.24em] text-secondary-500">
                      {t('common:language.label')}
                    </span>
                    <span className="text-sm font-semibold text-secondary-950">
                      {languageShort(languagePreference)}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 text-secondary-500 transition-transform',
                      showLanguageMenu && 'rotate-180'
                    )}
                  />
                </button>

                {showLanguageMenu && (
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-2 w-52 animate-pop-in rounded-2xl border border-line bg-card p-1.5 shadow-[var(--shadow-panel)]"
                  >
                    {LANGUAGE_PREFERENCES.map(pref => {
                      const isSelected = pref === languagePreference;
                      return (
                        <button
                          key={pref}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          onClick={() => handleLanguageChange(pref)}
                          className={cn(
                            'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors',
                            isSelected
                              ? 'bg-primary-50 font-semibold text-primary-700'
                              : 'text-secondary-700 hover:bg-secondary-50'
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <span className="text-[0.55rem] font-semibold uppercase tracking-[0.24em] text-secondary-500">
                              {languageShort(pref)}
                            </span>
                            <span>{languageLong(pref)}</span>
                          </span>
                          {isSelected && <Check className="h-4 w-4 shrink-0 text-primary-700" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="w-full min-w-[11.5rem] flex-none sm:w-[12.5rem] md:w-[14rem] xl:w-[13.5rem] 2xl:w-[15rem]">
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
                className="btn-outline btn-icon relative self-end"
                aria-label={t('common:notifications')}
              >
                <Bell className="h-5 w-5" />
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger-500" />
              </button>

              <div className="relative shrink-0 self-end">
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
