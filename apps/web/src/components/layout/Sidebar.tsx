import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { managerOrAdminRoles } from '@/features/auth/roleAccess';
import { CLIENT_MODULE_DEFAULTS, useModulesSnapshot } from '@/features/modules';
import { usePrefetchSales } from '@/features/sales/usePrefetchSales';
import { useDialogA11y } from '@/components/feedback/useDialogA11y';
import { TOP_LEVEL_DASHBOARD, visibleWorkspacesForRole } from './workspaces';
import { SidebarBrand } from './SidebarBrand';
import { SidebarWorkspaces } from './DesktopSidebarNavigation';
import { MobileWorkspaceNavigation } from './MobileWorkspaceNavigation';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
}

// ENG-131d — keep the JS rendering boundary aligned with Tailwind's `xl`
// shell breakpoint. Rendering one navigation model at a time avoids duplicate
// links in the accessibility tree and lets the mobile drawer be a real dialog.
const DESKTOP_SIDEBAR_QUERY = '(min-width: 1280px)';

function subscribeToDesktopSidebar(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const media = window.matchMedia(DESKTOP_SIDEBAR_QUERY);
  media.addEventListener('change', onStoreChange);
  return () => media.removeEventListener('change', onStoreChange);
}

function getDesktopSidebarSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(DESKTOP_SIDEBAR_QUERY).matches;
}

export function Sidebar({ collapsed, mobileOpen, onToggleCollapse, onCloseMobile }: SidebarProps) {
  const { user } = useAuth();
  const { t } = useTranslation(['nav', 'workspaces']);
  const { modules, isPlaceholder } = useModulesSnapshot();
  const location = useLocation();
  const prefetchSales = usePrefetchSales();
  const isDesktopSidebar = useSyncExternalStore(
    subscribeToDesktopSidebar,
    getDesktopSidebarSnapshot,
    () => true
  );
  const mobileDialogRef = useRef<HTMLElement>(null);

  // ENG-047 — dashboard badge for high-severity AI anomalies. Keep the query
  // above the responsive rendering split so mobile and desktop never issue
  // duplicate requests for the same shell signal.
  const isManagerOrAdmin = (managerOrAdminRoles as readonly string[]).includes(user?.role ?? '');
  const anomalyModuleActive =
    !isPlaceholder && (modules['anomaly-detection'] ?? CLIENT_MODULE_DEFAULTS['anomaly-detection']);
  const anomaliesQuery = trpc.ai.anomalies.list.useQuery(
    {},
    {
      enabled: isManagerOrAdmin && anomalyModuleActive,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    }
  );
  const dashboardBadge = anomaliesQuery.data?.severityCounts.high ?? 0;
  const visibleDashboard = (TOP_LEVEL_DASHBOARD.allowedRoles as readonly string[]).includes(
    user?.role ?? ''
  );
  const workspaces = visibleWorkspacesForRole(user?.role, modules, !isPlaceholder);
  const mobileDialogOpen = !isDesktopSidebar && mobileOpen;

  useDialogA11y({
    isOpen: mobileDialogOpen,
    onClose: onCloseMobile,
    closeOnEsc: true,
    containerRef: mobileDialogRef,
    dialogRef: mobileDialogRef,
    requireTopmost: true,
  });

  // A drawer left open while the viewport crosses into desktop must not
  // surprise the operator by reopening when they resize back to mobile.
  useEffect(() => {
    if (isDesktopSidebar && mobileOpen) onCloseMobile();
  }, [isDesktopSidebar, mobileOpen, onCloseMobile]);

  if (isDesktopSidebar) {
    return (
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex min-h-0 w-[18.5rem] flex-col border-r border-line/70 bg-surface/88 px-3 py-3 backdrop-blur-2xl transition-[width] duration-300',
          collapsed && 'w-[6.5rem]'
        )}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-2">
          <SidebarBrand collapsed={collapsed} />
          <button
            type="button"
            className="btn-outline btn-icon"
            onClick={onToggleCollapse}
            aria-label={t(collapsed ? 'nav:actions.expandNavigation' : 'nav:actions.collapseRail')}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronLeft className="h-4 w-4 shrink-0" />
            )}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin pr-1">
          <SidebarWorkspaces
            collapsed={collapsed}
            onNavigate={onCloseMobile}
            workspaces={workspaces}
            currentPath={location.pathname}
            visibleDashboard={visibleDashboard}
            dashboardBadge={dashboardBadge}
            prefetchSales={prefetchSales}
          />
        </div>
      </aside>
    );
  }

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="mobile-navigation-backdrop"
        className={cn(
          'fixed inset-0 z-40 bg-secondary-950/35 backdrop-blur-sm transition-opacity duration-200',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onCloseMobile}
      />

      <aside
        ref={mobileDialogRef}
        role={mobileDialogOpen ? 'dialog' : undefined}
        aria-modal={mobileDialogOpen ? 'true' : undefined}
        aria-label={mobileDialogOpen ? t('workspaces:mobile.navigationLabel') : undefined}
        aria-hidden={!mobileDialogOpen}
        inert={!mobileDialogOpen}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex min-h-0 w-[min(22rem,calc(100vw-1rem))] flex-col border-r border-line/70 bg-surface/96 px-3 py-3 backdrop-blur-2xl transition-transform duration-300',
          mobileDialogOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-2">
          <SidebarBrand collapsed={false} />
          <button
            type="button"
            className="btn-outline btn-icon mobile-shell-toggle"
            onClick={onCloseMobile}
            aria-label={t('nav:actions.closeNavigation')}
          >
            <X className="h-5.5 w-5.5 shrink-0" strokeWidth={2.35} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin pr-1">
          <MobileWorkspaceNavigation
            key={location.pathname}
            workspaces={workspaces}
            currentPath={location.pathname}
            showDashboard={visibleDashboard}
            dashboardBadge={dashboardBadge}
            onNavigate={onCloseMobile}
            onPrefetchSales={prefetchSales}
          />
        </div>
      </aside>
    </>
  );
}
