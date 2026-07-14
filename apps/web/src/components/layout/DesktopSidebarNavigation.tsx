import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VisibleWorkspace, WorkspaceItem } from './workspaces';

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
  badgeCount?: number | undefined;
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
  const visibleBadgeCount = badgeCount ?? 0;
  const showBadge = visibleBadgeCount > 0;
  const accessibleName = showBadge
    ? `${name} (${visibleBadgeCount} ${t('badges.unreadAlertsSr', { defaultValue: 'unread alerts' })})`
    : undefined;
  return (
    <NavLink
      to={item.href}
      aria-label={accessibleName}
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
            : // ENG-134 slice B: text-secondary-600 (oklch L=0.48)
              // sat below WCAG AA 4.5:1 at body text size. text-fg2
              // (semantic mid-contrast foreground, L=0.37) is the
              // accessible default for inactive nav text.
              'text-fg2 hover:bg-secondary-100/80 hover:text-secondary-950'
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
            {visibleBadgeCount > 9 ? '9+' : visibleBadgeCount}
          </span>
        )}
      </span>
      {!collapsed && <span className="flex-1 truncate">{name}</span>}
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
        aria-label={t(isOpen ? 'actions.collapseWorkspace' : 'actions.expandWorkspace', {
          workspace: title,
        })}
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

export function SidebarWorkspaces({
  collapsed,
  onNavigate,
  workspaces,
  currentPath,
  dashboardBadge,
  prefetchSales,
}: {
  collapsed: boolean;
  onNavigate: () => void;
  workspaces: readonly VisibleWorkspace[];
  currentPath: string;
  dashboardBadge: number;
  prefetchSales: () => void;
}) {
  const { t: tWorkspaces } = useTranslation('workspaces');

  return (
    <div className={cn('space-y-3', collapsed && 'space-y-2')}>
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
          dashboardBadge={dashboardBadge}
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
  dashboardBadge,
}: {
  workspace: VisibleWorkspace['workspace'];
  items: readonly WorkspaceItem[];
  collapsed: boolean;
  onNavigate: () => void;
  currentPath: string;
  headerTitle: string;
  /** ENG-171 — hover-prefetch handler, attached only to the /sales item. */
  prefetchSales: () => void;
  /** ENG-131e — high-severity anomaly count follows Dashboard into Operate. */
  dashboardBadge: number;
}) {
  // ENG-131 (slice A) — persisted collapse state applies to inactive
  // workspaces, but the workspace that owns the active route must
  // always stay open so direct URLs and command-palette navigation do
  // not hide the current page's nav item.
  const containsActiveRoute =
    currentPath === workspace.defaultRoute ||
    currentPath.startsWith(`${workspace.defaultRoute}/`) ||
    items.some(item => currentPath === item.href || currentPath.startsWith(`${item.href}/`));
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
            badgeCount={item.href === '/dashboard' ? dashboardBadge : undefined}
          />
        ))}
      </div>
    </section>
  );
}
