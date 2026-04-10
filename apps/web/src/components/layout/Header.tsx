import { Bell, LogOut, Menu, Search, User, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Select } from '@/components/form-controls/Select';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { isOnline } from '@/lib/utils';

interface HeaderProps {
  onOpenSidebar: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const { user, logout } = useAuth();
  const { currentTenant, currentSite, isLoadingSites, sites, switchSite } = useTenant();
  const [online, setOnline] = useState(isOnline());
  const [showUserMenu, setShowUserMenu] = useState(false);

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

  return (
    <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6 xl:px-8">
      <div className="shell-panel px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-outline btn-icon lg:hidden"
              onClick={onOpenSidebar}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="min-w-0">
              <p className="page-kicker text-[0.62rem] tracking-[0.24em]">Point Of Sale</p>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-2xl text-secondary-950">Operator workspace</h2>
                {currentTenant && <span className="badge badge-secondary">{currentTenant.name}</span>}
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-3 xl:max-w-[58rem] xl:flex-row xl:items-center xl:justify-end">
            <div className="relative xl:min-w-[18rem] xl:max-w-[22rem] xl:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
              <input className="input pl-10" placeholder="Quick search products, customers, receipts" />
            </div>

            <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap">
              <div className={online ? 'badge badge-success' : 'badge badge-warning'}>
                {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {online ? 'Online' : 'Offline'}
              </div>

              <div className="min-w-[14rem] flex-1 xl:flex-none">
                <Select
                  options={siteOptions}
                  value={currentSite?.id ?? null}
                  onChange={value => {
                    if (typeof value === 'string') {
                      void switchSite(value);
                    }
                  }}
                  placeholder={isLoadingSites ? 'Loading sites...' : 'Select a site'}
                  disabled={isLoadingSites || siteOptions.length <= 1}
                  className="select-trigger"
                />
              </div>

              <button type="button" className="btn-outline btn-icon relative" aria-label="Notifications">
                <Bell className="h-5 w-5" />
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger-500" />
              </button>

              <div className="relative shrink-0">
                <button
                  type="button"
                  className="btn-outline flex w-full items-center justify-between gap-3 px-3.5 sm:w-auto"
                  onClick={() => setShowUserMenu(current => !current)}
                >
                  <div className="flex items-center gap-3">
                    <span className="pointer-events-none flex h-9 w-9 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
                      <User className="h-4.5 w-4.5" />
                    </span>
                    <span className="pointer-events-none min-w-0 text-left">
                      <span className="block truncate text-sm font-semibold text-secondary-950">
                        {user?.name ?? 'User'}
                      </span>
                      <span className="block truncate text-xs text-secondary-500">
                        {user?.role ?? 'session'}
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
                      onClick={logout}
                      className="btn-ghost mt-3 w-full justify-start px-3"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
