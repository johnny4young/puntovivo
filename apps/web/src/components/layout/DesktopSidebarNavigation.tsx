import { useState } from 'react';
import { Link, NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronDown, Grid3X3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VisibleWorkspace, WorkspaceItem } from './workspaces';
import { taskOwnsPath, type PrimaryTask } from './taskRegistry';

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
   * optional hover/focus prefetch handler. Wired only for the
   * `/sales` entry so its heavy entry queries warm the cache before the
   * route mounts; undefined for every other link (no-op). Widened to
   * include `undefined` per the  exactOptionalPropertyTypes rule.
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
          'operator-nav-link group flex items-center gap-3 rounded-[12px] px-3 py-2 text-sm font-medium transition-all duration-200',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-primary text-primary-foreground'
            : //  slice B: text-secondary-600 (oklch L=0.48)
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

// (slice A) — localStorage key prefix for the per-workspace
// collapse state. Mirrors the `puntovivo:sidebar:` prefix used by
// the legacy setup-section session key;  promotes the state
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
  /** prefetch the workspace default route when it is `/sales`. */
  onPrefetch?: (() => void) | undefined;
  controlsId: string;
}) {
  const { t } = useTranslation('workspaces');
  // (slice A) — generalises the  collapsible
  // section header to every workspace. The header carries the
  // workspace icon, label, and a chevron that flips on collapse.
  // aria-expanded + aria-controls satisfy the WAI-ARIA disclosure
  // pattern documented in docs/A11Y.md.
  //
  // the header splits into a `<Link>` (icon + label,
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
  // slice B (2026-05-21) — the label class moved from
  // `text-secondary-500` (oklch L=0.61) to `text-fg2` (semantic
  // mid-contrast foreground, oklch L=0.37). The original token
  // rendered at 3.69:1 against `--background` on 7.8pt body text,
  // failing WCAG AA 4.5:1. `text-fg2` is the canonical readable-
  // muted token from the  foreground ramp.
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
  primaryTasks,
  currentPath,
  dashboardBadge,
  prefetchSales,
  onExpandNavigation,
}: {
  collapsed: boolean;
  onNavigate: () => void;
  workspaces: readonly VisibleWorkspace[];
  primaryTasks: readonly PrimaryTask[];
  currentPath: string;
  dashboardBadge: number;
  prefetchSales: () => void;
  onExpandNavigation: () => void;
}) {
  const { t: tWorkspaces } = useTranslation('workspaces');
  const routeHasPrimaryTask = primaryTasks.some(task => taskOwnsPath(task, currentPath));
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const toolsOpen = !routeHasPrimaryTask || toolsExpanded;

  if (collapsed) {
    return (
      <div className="space-y-2" data-testid="sidebar-primary-tasks">
        {primaryTasks.map(task => (
          <PrimaryTaskLink
            key={task.id}
            task={task}
            collapsed
            onNavigate={onNavigate}
            onPrefetch={task.href === '/sales' ? prefetchSales : undefined}
            badgeCount={task.href === '/dashboard' ? dashboardBadge : undefined}
          />
        ))}
        <button
          type="button"
          onClick={onExpandNavigation}
          aria-label={tWorkspaces('taskNavigation.openMoreTools')}
          title={tWorkspaces('taskNavigation.moreTools')}
          className="operator-nav-link flex min-h-11 w-full items-center justify-center rounded-[12px] text-fg2 transition-colors hover:bg-secondary-100/80 hover:text-secondary-950"
          data-testid="sidebar-expand-more-tools"
        >
          <Grid3X3 className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section aria-labelledby="sidebar-primary-title" data-testid="sidebar-primary-tasks">
        <div className="mb-2 px-2">
          <p
            id="sidebar-primary-title"
            className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-fg2"
          >
            {tWorkspaces('taskNavigation.frequentTasks')}
          </p>
        </div>
        <div className="space-y-1">
          {primaryTasks.map(task => (
            <PrimaryTaskLink
              key={task.id}
              task={task}
              collapsed={false}
              onNavigate={onNavigate}
              onPrefetch={task.href === '/sales' ? prefetchSales : undefined}
              badgeCount={task.href === '/dashboard' ? dashboardBadge : undefined}
            />
          ))}
        </div>
      </section>

      <section className="rounded-[16px] border border-line/70 bg-surface-2/45 p-2">
        <button
          type="button"
          onClick={() => {
            if (routeHasPrimaryTask) setToolsExpanded(previous => !previous);
          }}
          aria-expanded={toolsOpen}
          aria-disabled={!routeHasPrimaryTask || undefined}
          aria-controls="sidebar-more-tools"
          className="flex min-h-11 w-full items-center gap-3 rounded-[11px] px-2.5 text-left text-sm font-semibold text-secondary-900 transition-colors hover:bg-secondary-100/80 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
          data-testid="sidebar-more-tools-toggle"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-secondary-100 text-secondary-700">
            <Grid3X3 className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{tWorkspaces('taskNavigation.moreTools')}</span>
            <span className="mt-0.5 block truncate text-[11px] font-normal text-fg2">
              {tWorkspaces('taskNavigation.moreToolsHint')}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-fg2 transition-transform',
              !toolsOpen && '-rotate-90'
            )}
            aria-hidden="true"
          />
        </button>

        <div
          id="sidebar-more-tools"
          hidden={!toolsOpen}
          className="mt-3 space-y-3 border-t border-line/70 pt-3"
        >
          {toolsOpen &&
            workspaces.map(({ workspace, items }) => (
              <SidebarWorkspaceSection
                key={workspace.id}
                workspace={workspace}
                items={items}
                collapsed={false}
                onNavigate={onNavigate}
                currentPath={currentPath}
                headerTitle={tWorkspaces(workspace.labelKey)}
                prefetchSales={prefetchSales}
                dashboardBadge={dashboardBadge}
              />
            ))}
        </div>
      </section>
    </div>
  );
}

function PrimaryTaskLink({
  task,
  collapsed,
  onNavigate,
  badgeCount,
  onPrefetch,
}: {
  task: PrimaryTask;
  collapsed: boolean;
  onNavigate: () => void;
  badgeCount?: number | undefined;
  onPrefetch?: (() => void) | undefined;
}) {
  const { t } = useTranslation(['palette', 'nav']);
  const label = t(`palette:${task.labelKey}`);
  const visibleBadgeCount = badgeCount ?? 0;
  const showBadge = visibleBadgeCount > 0;
  const accessibleName = showBadge
    ? `${label} (${visibleBadgeCount} ${t('nav:badges.unreadAlertsSr')})`
    : undefined;

  return (
    <NavLink
      to={task.href}
      onClick={onNavigate}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      aria-label={accessibleName}
      title={collapsed ? label : undefined}
      data-testid={`sidebar-primary-task-${task.id}`}
      className={({ isActive }) =>
        cn(
          'operator-nav-link group flex min-h-11 items-center gap-3 rounded-[13px] px-3 py-2 text-sm font-semibold transition-all duration-200',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-primary text-primary-foreground shadow-[0_16px_32px_-24px_color-mix(in_oklch,var(--primary)_80%,transparent)]'
            : 'text-secondary-800 hover:bg-secondary-100/80 hover:text-secondary-950'
        )
      }
    >
      <span className="relative inline-flex items-center justify-center">
        <task.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        {showBadge && (
          <span
            className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-700 px-1 text-[0.65rem] font-semibold leading-none text-white"
            aria-hidden="true"
          >
            {visibleBadgeCount > 9 ? '9+' : visibleBadgeCount}
          </span>
        )}
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
    </NavLink>
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
  /** hover-prefetch handler, attached only to the /sales item. */
  prefetchSales: () => void;
  /** high-severity anomaly count follows Dashboard into Operate. */
  dashboardBadge: number;
}) {
  const { t: tWorkspaces } = useTranslation('workspaces');
  // (slice A) — persisted collapse state applies to inactive
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
  const activeItem = items.find(
    item => currentPath === item.href || currentPath.startsWith(`${item.href}/`)
  );
  const hasDirectory = (workspace.directoryGroups?.length ?? 0) > 0;
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
        {hasDirectory && activeItem && (
          <p className="px-3 pb-0.5 pt-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-fg2">
            {tWorkspaces('directoryNavigation.currentPage')}
          </p>
        )}
        {(hasDirectory ? (activeItem ? [activeItem] : []) : items).map(item => (
          <NavigationLink
            key={item.href}
            item={item}
            collapsed={collapsed}
            onNavigate={onNavigate}
            onPrefetch={item.href === '/sales' ? prefetchSales : undefined}
            badgeCount={item.href === '/dashboard' ? dashboardBadge : undefined}
          />
        ))}
        {hasDirectory && (
          <NavLink
            to={workspace.defaultRoute}
            onClick={onNavigate}
            data-testid={`sidebar-workspace-directory-${workspace.id}`}
            className={({ isActive }) =>
              cn(
                'mt-1 flex min-h-11 items-center gap-3 rounded-[12px] border px-3 py-2 text-sm font-semibold transition-colors',
                isActive
                  ? 'border-primary-200 bg-primary-50 text-primary-900'
                  : 'border-line/70 bg-surface text-secondary-800 hover:border-primary-200 hover:bg-primary-50/60'
              )
            }
          >
            {activeItem ? (
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <Grid3X3 className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 leading-4">
              {tWorkspaces(
                activeItem
                  ? 'directoryNavigation.backToDirectory'
                  : 'directoryNavigation.openDirectory',
                { workspace: headerTitle }
              )}
            </span>
          </NavLink>
        )}
      </div>
    </section>
  );
}
