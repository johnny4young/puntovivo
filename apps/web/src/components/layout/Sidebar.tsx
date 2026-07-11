import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { managerOrAdminRoles } from '@/features/auth/roleAccess';
import {
  CLIENT_MODULE_DEFAULTS,
  useModulesSnapshot,
} from '@/features/modules';
import { usePrefetchSales } from '@/features/sales/usePrefetchSales';
import { useDialogA11y } from '@/components/feedback/useDialogA11y';
import {
  TOP_LEVEL_DASHBOARD,
  visibleWorkspacesForRole,
  type VisibleWorkspace,
  type WorkspaceItem,
} from './workspaces';
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

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation('nav');
  // ENG-080 + ENG-080c — Puntovivo BrandMark + the "punto" 400 / "vivo"
  // 700 lowercase wordmark in Inter (primary) per the handoff
  // shell.jsx lockup. The orange punto accent is visible in both
  // expanded and collapsed rail; the tagline only renders expanded.
  return (
    <div className={cn('flex items-center gap-2.5 px-2 py-1.5', collapsed && 'justify-center px-0')}>
      <BrandMark
        className="h-9 w-9 shrink-0 drop-shadow-[0_8px_18px_color-mix(in_oklch,var(--primary)_45%,transparent)]"
        label={t('brand.title', 'Puntovivo')}
      />
      {!collapsed && (
        <div className="min-w-0 leading-none">
          <p className="text-[0.55rem] font-semibold uppercase tracking-[0.22em] text-primary-700">
            {t('brand.tagline')}
          </p>
          <h1 className="mt-1 truncate text-lg leading-none tracking-[-0.01em] text-primary lowercase">
            <span className="font-normal">punto</span>
            <span className="font-bold">vivo</span>
          </h1>
        </div>
      )}
    </div>
  );
}

function NavigationLink({
  item,
  collapsed,
  onNavigate,
  badgeCount,
  onPrefetch,
}: {
  item: WorkspaceItem;
  collapsed: boolean;
  onNavigate: () => void;
  badgeCount?: number;
  /**
   * ENG-171 — optional hover/focus prefetch handler. Wired only for the
   * `/sales` entry so its heavy entry queries warm the cache before the
   * route mounts; undefined for every other link (no-op). Widened to
   * include `undefined` per the ENG-179b exactOptionalPropertyTypes rule.
   */
  onPrefetch?: (() => void) | undefined;
}) {
  const { t } = useTranslation('nav');
  const name = t(item.nameKey);
  const showBadge = (badgeCount ?? 0) > 0;
  return (
    <NavLink
      to={item.href}
      onClick={onNavigate}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      title={collapsed ? name : undefined}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-[20px] px-3 py-2 text-sm font-medium transition-all duration-200',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-primary text-primary-foreground shadow-[0_18px_40px_-28px_color-mix(in_oklch,var(--primary)_75%,transparent)]'
            // ENG-134 slice B: text-secondary-600 (oklch L=0.48)
            // sat below WCAG AA 4.5:1 at body text size. text-fg2
            // (semantic mid-contrast foreground, L=0.37) is the
            // accessible default for inactive nav text.
            : 'text-fg2 hover:bg-secondary-100/80 hover:text-secondary-950'
        )
      }
    >
      <span className="relative inline-flex items-center justify-center">
        <item.icon className="h-5 w-5 shrink-0" />
        {showBadge && (
          <span
            className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-danger-700 px-1 text-[0.65rem] font-semibold leading-none text-white"
            aria-hidden="true"
          >
            {badgeCount! > 9 ? '9+' : badgeCount}
          </span>
        )}
      </span>
      {!collapsed && (
        <span className="flex-1 truncate">
          {name}
          {showBadge && (
            <span className="sr-only">
              {' '}
              ({badgeCount}
              {' '}
              {t('badges.unreadAlertsSr', { defaultValue: 'unread alerts' })})
            </span>
          )}
        </span>
      )}
    </NavLink>
  );
}

// ENG-131 (slice A) — localStorage key prefix for the per-workspace
// collapse state. Mirrors the `puntovivo:sidebar:` prefix used by
// the legacy setup-section session key; ENG-131 promotes the state
// to localStorage so a workspace expanded by an operator stays
// expanded across tabs. Each key looks like
// `puntovivo:sidebar:workspace:<id>:collapsed`.
const WORKSPACE_COLLAPSED_PREFIX = 'puntovivo:sidebar:workspace';

function workspaceStorageKey(id: string): string {
  return `${WORKSPACE_COLLAPSED_PREFIX}:${id}:collapsed`;
}

function readWorkspaceCollapsed(id: string, defaultCollapsed: boolean): boolean {
  if (typeof window === 'undefined') return defaultCollapsed;
  try {
    const raw = window.localStorage.getItem(workspaceStorageKey(id));
    if (raw === null) return defaultCollapsed;
    return raw === 'true';
  } catch {
    return defaultCollapsed;
  }
}

function writeWorkspaceCollapsed(id: string, collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(workspaceStorageKey(id), String(collapsed));
  } catch {
    // Private-mode browsers can throw on localStorage access. UI
    // still flips through state; we just cannot persist it.
  }
}

function WorkspaceGroupHeader({
  workspace,
  title,
  isOpen,
  onToggle,
  onNavigate,
  onPrefetch,
  controlsId,
}: {
  workspace: VisibleWorkspace['workspace'];
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  /** ENG-171 — prefetch the workspace default route when it is `/sales`. */
  onPrefetch?: (() => void) | undefined;
  controlsId: string;
}) {
  const { t } = useTranslation('workspaces');
  // ENG-131 (slice A) — generalises the ENG-079b collapsible
  // section header to every workspace. The header carries the
  // workspace icon, label, and a chevron that flips on collapse.
  // aria-expanded + aria-controls satisfy the WAI-ARIA disclosure
  // pattern documented in docs/A11Y.md.
  //
  // ENG-131c — the header splits into a `<Link>` (icon + label,
  // navigates to the workspace `defaultRoute` — which for catalog /
  // procurement / finance is the new landing route, and for the
  // others stays the first item) and a sibling `<button>` (chevron,
  // owns the disclosure state). Keeping them as two siblings
  // preserves cmd+click + screen-reader semantics on the label
  // (navigation) while keeping the chevron the canonical aria-
  // expanded surface (disclosure). The chevron retains the
  // pre-slice-C test id so existing tests + smoke selectors keep
  // working unchanged.
  //
  // ENG-134 slice B (2026-05-21) — the label class moved from
  // `text-secondary-500` (oklch L=0.61) to `text-fg2` (semantic
  // mid-contrast foreground, oklch L=0.37). The original token
  // rendered at 3.69:1 against `--background` on 7.8pt body text,
  // failing WCAG AA 4.5:1. `text-fg2` is the canonical readable-
  // muted token from the ENG-080b foreground ramp.
  return (
    <div className="flex w-full items-center gap-1">
      <Link
        to={workspace.defaultRoute}
        onClick={onNavigate}
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        data-testid={`sidebar-workspace-link-${workspace.id}`}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-fg2 transition-colors hover:bg-secondary-100/60 hover:text-secondary-950 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
      >
        <workspace.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{title}</span>
      </Link>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={controlsId}
        aria-label={t(
          isOpen ? 'actions.collapseWorkspace' : 'actions.expandWorkspace',
          { workspace: title }
        )}
        data-testid={`sidebar-workspace-${workspace.id}`}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg2 transition-colors hover:bg-secondary-100/60 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
      >
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
            !isOpen && '-rotate-90'
          )}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

function SidebarWorkspaces({
  collapsed,
  onNavigate,
  workspaces,
  currentPath,
  visibleDashboard,
  dashboardBadge,
  prefetchSales,
}: {
  collapsed: boolean;
  onNavigate: () => void;
  workspaces: readonly VisibleWorkspace[];
  currentPath: string;
  visibleDashboard: boolean;
  dashboardBadge: number;
  prefetchSales: () => void;
}) {
  const { t: tWorkspaces } = useTranslation('workspaces');

  return (
    <div className={cn('space-y-3', collapsed && 'space-y-2')}>
      {visibleDashboard && (
        <div className="space-y-1">
          <NavigationLink
            item={TOP_LEVEL_DASHBOARD}
            collapsed={collapsed}
            onNavigate={onNavigate}
            badgeCount={dashboardBadge}
          />
        </div>
      )}
      {workspaces.map(({ workspace, items }) => (
        <SidebarWorkspaceSection
          key={workspace.id}
          workspace={workspace}
          items={items}
          collapsed={collapsed}
          onNavigate={onNavigate}
          currentPath={currentPath}
          headerTitle={tWorkspaces(workspace.labelKey)}
          prefetchSales={prefetchSales}
        />
      ))}
    </div>
  );
}

function SidebarWorkspaceSection({
  workspace,
  items,
  collapsed,
  onNavigate,
  currentPath,
  headerTitle,
  prefetchSales,
}: {
  workspace: VisibleWorkspace['workspace'];
  items: readonly WorkspaceItem[];
  collapsed: boolean;
  onNavigate: () => void;
  currentPath: string;
  headerTitle: string;
  /** ENG-171 — hover-prefetch handler, attached only to the /sales item. */
  prefetchSales: () => void;
}) {
  // ENG-131 (slice A) — persisted collapse state applies to inactive
  // workspaces, but the workspace that owns the active route must
  // always stay open so direct URLs and command-palette navigation do
  // not hide the current page's nav item.
  const containsActiveRoute =
    currentPath === workspace.defaultRoute ||
    currentPath.startsWith(`${workspace.defaultRoute}/`) ||
    items.some(
      item => currentPath === item.href || currentPath.startsWith(`${item.href}/`)
    );
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() =>
    readWorkspaceCollapsed(workspace.id, !containsActiveRoute)
  );
  const toggle = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      writeWorkspaceCollapsed(workspace.id, next);
      return next;
    });
  };
  const controlsId = `sidebar-workspace-panel-${workspace.id}`;
  const isOpen = containsActiveRoute || !isCollapsed;
  const itemsHidden = !collapsed && !isOpen;
  return (
    <section className="space-y-2">
      {!collapsed && (
        <WorkspaceGroupHeader
          workspace={workspace}
          title={headerTitle}
          isOpen={isOpen}
          onToggle={toggle}
          onNavigate={onNavigate}
          onPrefetch={workspace.defaultRoute === '/sales' ? prefetchSales : undefined}
          controlsId={controlsId}
        />
      )}
      <div id={controlsId} hidden={itemsHidden} className="space-y-1">
        {items.map(item => (
          <NavigationLink
            key={item.href}
            item={item}
            collapsed={collapsed}
            onNavigate={onNavigate}
            onPrefetch={item.href === '/sales' ? prefetchSales : undefined}
          />
        ))}
      </div>
    </section>
  );
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
}: SidebarProps) {
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
  const isManagerOrAdmin = (managerOrAdminRoles as readonly string[]).includes(
    user?.role ?? ''
  );
  const anomalyModuleActive =
    !isPlaceholder &&
    (modules['anomaly-detection'] ?? CLIENT_MODULE_DEFAULTS['anomaly-detection']);
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
            aria-label={t(
              collapsed ? 'nav:actions.expandNavigation' : 'nav:actions.collapseRail'
            )}
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
