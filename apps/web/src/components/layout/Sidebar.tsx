import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
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
import type { UserRole } from '@/types';
import {
  TOP_LEVEL_DASHBOARD,
  visibleWorkspacesForRole,
  type VisibleWorkspace,
  type WorkspaceItem,
} from './workspaces';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
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
}: {
  item: WorkspaceItem;
  collapsed: boolean;
  onNavigate: () => void;
  badgeCount?: number;
}) {
  const { t } = useTranslation('nav');
  const name = t(item.nameKey);
  const showBadge = (badgeCount ?? 0) > 0;
  return (
    <NavLink
      to={item.href}
      onClick={onNavigate}
      title={collapsed ? name : undefined}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-[20px] px-3 py-2 text-sm font-medium transition-all duration-200',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-primary text-primary-foreground shadow-[0_18px_40px_-28px_color-mix(in_oklch,var(--primary)_75%,transparent)]'
            : 'text-secondary-600 hover:bg-secondary-100/80 hover:text-secondary-950'
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
  controlsId,
}: {
  workspace: VisibleWorkspace['workspace'];
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  controlsId: string;
}) {
  // ENG-131 (slice A) — generalises the ENG-079b collapsible
  // section header to every workspace. The header carries the
  // workspace icon, label, and a chevron that flips on collapse.
  // aria-expanded + aria-controls satisfy the WAI-ARIA disclosure
  // pattern documented in docs/A11Y.md.
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-controls={controlsId}
      data-testid={`sidebar-workspace-${workspace.id}`}
      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-secondary-500 transition-colors hover:bg-secondary-100/60 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        <workspace.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{title}</span>
      </span>
      <ChevronDown
        className={cn(
          'h-3.5 w-3.5 shrink-0 transition-transform duration-150',
          !isOpen && '-rotate-90'
        )}
        aria-hidden="true"
      />
    </button>
  );
}

function SidebarWorkspaces({
  collapsed,
  onNavigate,
  role,
}: {
  collapsed: boolean;
  onNavigate: () => void;
  role: UserRole | undefined;
}) {
  const { t: tNav } = useTranslation('nav');
  const { t: tWorkspaces } = useTranslation('workspaces');
  const { modules } = useModulesSnapshot();
  const location = useLocation();

  // ENG-047 — dashboard badge for high-severity AI anomalies. The
  // endpoint is gated by managerOrAdminProcedure server-side; we
  // additionally gate client-side so cashiers / viewers never
  // attempt the query. The endpoint short-circuits to enabled=false
  // + zero counts when ai.enabled is off, so an unconfigured tenant
  // pays only one cheap settings read.
  const isManagerOrAdmin = (managerOrAdminRoles as readonly string[]).includes(role ?? '');
  const anomalyModuleActive = modules['anomaly-detection'] ?? CLIENT_MODULE_DEFAULTS['anomaly-detection'];
  const anomaliesQuery = trpc.ai.anomalies.list.useQuery(
    {},
    {
      enabled: isManagerOrAdmin && anomalyModuleActive,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
    }
  );
  const dashboardBadge = anomaliesQuery.data?.severityCounts.high ?? 0;

  const visibleDashboard =
    (TOP_LEVEL_DASHBOARD.allowedRoles as readonly string[]).includes(role ?? '');
  const workspaces = visibleWorkspacesForRole(role, modules);

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
          currentPath={location.pathname}
          headerTitle={tWorkspaces(workspace.labelKey)}
          fallbackTitleLabel={tNav(`workspaces.${workspace.id}`, {
            defaultValue: '',
          })}
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
}: {
  workspace: VisibleWorkspace['workspace'];
  items: readonly WorkspaceItem[];
  collapsed: boolean;
  onNavigate: () => void;
  currentPath: string;
  headerTitle: string;
  fallbackTitleLabel: string;
}) {
  // ENG-131 (slice A) — persisted collapse state applies to inactive
  // workspaces, but the workspace that owns the active route must
  // always stay open so direct URLs and command-palette navigation do
  // not hide the current page's nav item.
  const containsActiveRoute = items.some(item =>
    currentPath === item.href || currentPath.startsWith(`${item.href}/`)
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
  const { t } = useTranslation('nav');

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-secondary-950/35 backdrop-blur-sm transition-opacity duration-200 xl:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onCloseMobile}
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex min-h-0 w-[18.5rem] flex-col border-r border-line/70 bg-surface/88 px-3 py-3 backdrop-blur-2xl transition-transform duration-300 xl:translate-x-0',
          collapsed && 'xl:w-[6.5rem]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="mb-4 shrink-0 flex items-center justify-between gap-2">
          <SidebarBrand collapsed={collapsed} />
          {/*
            ENG-079b — collapse-rail button moved from the footer up to
            the header so the controls live together (Notion / Linear /
            GitHub pattern). The mobile X close button stays on the
            opposite breakpoint so only one icon is visible at a time.
          */}
          <button
            type="button"
            className="btn-outline btn-icon hidden xl:inline-flex"
            onClick={onToggleCollapse}
            aria-label={t(collapsed ? 'nav:actions.expandNavigation' : 'nav:actions.collapseRail')}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronLeft className="h-4 w-4 shrink-0" />
            )}
          </button>
          <button
            type="button"
            className="btn-outline btn-icon mobile-shell-toggle xl:hidden"
            onClick={onCloseMobile}
            aria-label={t('nav:actions.closeNavigation')}
          >
            <X className="h-5.5 w-5.5 shrink-0" strokeWidth={2.35} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin pr-1">
          <SidebarWorkspaces
            collapsed={collapsed}
            onNavigate={onCloseMobile}
            role={user?.role}
          />
        </div>

        {/*
          ENG-079a dropped the SESIÓN INICIADA card here (the same
          user.name + role + email surface in the Header user menu).
          ENG-079b moved the collapse-rail button to the top header so
          the footer block is now empty and the chrome shrinks to fit.
        */}
      </aside>
    </>
  );
}
