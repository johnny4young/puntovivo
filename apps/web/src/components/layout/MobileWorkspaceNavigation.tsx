import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Grid3X3 } from 'lucide-react';
import { Link, NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { WorkspaceItem, VisibleWorkspace } from './workspaces';
import { taskOwnsPath, type PrimaryTask } from './taskRegistry';

interface MobileWorkspaceNavigationProps {
  workspaces: readonly VisibleWorkspace[];
  primaryTasks: readonly PrimaryTask[];
  currentPath: string;
  dashboardBadge: number;
  onNavigate: () => void;
  onPrefetchSales: () => void;
}

function PrimaryTaskLink({
  task,
  onNavigate,
  onPrefetch,
  badgeCount,
}: {
  task: PrimaryTask;
  onNavigate: () => void;
  onPrefetch?: (() => void) | undefined;
  badgeCount?: number | undefined;
}) {
  const { t } = useTranslation(['palette', 'nav']);
  const label = t(`palette:${task.labelKey}`);
  const description = t(`palette:${task.descriptionKey}`);
  const visibleBadgeCount = badgeCount ?? 0;
  const showBadge = visibleBadgeCount > 0;
  const accessibleName = showBadge
    ? `${label} (${visibleBadgeCount} ${t('nav:badges.unreadAlertsSr')})`
    : undefined;

  return (
    <NavLink
      to={task.href}
      aria-label={accessibleName}
      onClick={onNavigate}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      data-testid={`mobile-primary-task-${task.id}`}
      className={({ isActive }) =>
        cn(
          'group flex min-h-[4.25rem] items-center gap-3 rounded-[16px] border px-3 py-2.5 text-left transition-all',
          isActive
            ? 'border-primary-300 bg-primary text-primary-foreground shadow-[0_18px_42px_-30px_color-mix(in_oklch,var(--primary)_80%,transparent)]'
            : 'border-line/70 bg-surface-2/65 text-secondary-900 hover:border-primary-200 hover:bg-primary-50/55'
        )
      }
    >
      <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-white/80 text-primary-800 shadow-sm">
        <task.icon className="h-5 w-5" aria-hidden="true" />
        {showBadge && (
          <span
            className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-700 px-1 text-[0.65rem] font-semibold leading-none text-white"
            aria-hidden="true"
          >
            {visibleBadgeCount > 9 ? '9+' : visibleBadgeCount}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block line-clamp-2 text-[11.5px] leading-4 opacity-75">
          {description}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 opacity-55" aria-hidden="true" />
    </NavLink>
  );
}

function ownsPath(workspace: VisibleWorkspace, pathname: string): boolean {
  return (
    pathname === workspace.workspace.defaultRoute ||
    pathname.startsWith(`${workspace.workspace.defaultRoute}/`) ||
    workspace.items.some(item => pathname === item.href || pathname.startsWith(`${item.href}/`))
  );
}

function MobileNavigationLink({
  item,
  onNavigate,
  onPrefetch,
  badgeCount,
}: {
  item: WorkspaceItem;
  onNavigate: () => void;
  onPrefetch?: (() => void) | undefined;
  badgeCount?: number | undefined;
}) {
  const { t } = useTranslation('nav');
  const label = t(item.nameKey);
  const visibleBadgeCount = badgeCount ?? 0;
  const showBadge = visibleBadgeCount > 0;
  const accessibleName = showBadge
    ? `${label} (${visibleBadgeCount} ${t('badges.unreadAlertsSr')})`
    : undefined;

  return (
    <NavLink
      to={item.href}
      aria-label={accessibleName}
      onClick={onNavigate}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      className={({ isActive }) =>
        cn(
          'flex min-h-11 items-center gap-3 rounded-[18px] px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-primary text-primary-foreground shadow-[0_18px_40px_-28px_color-mix(in_oklch,var(--primary)_75%,transparent)]'
            : 'text-fg2 hover:bg-secondary-100/80 hover:text-secondary-950'
        )
      }
    >
      <span className="relative inline-flex items-center justify-center">
        <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        {showBadge && (
          <span
            className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-700 px-1 text-[0.65rem] font-semibold leading-none text-white"
            aria-hidden="true"
          >
            {visibleBadgeCount > 9 ? '9+' : visibleBadgeCount}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </NavLink>
  );
}

/**
 * drawer-specific two-level workspace navigation.
 *
 * The desktop rail keeps its persisted disclosure widgets. Mobile and tablet
 * instead choose one job first and render only that workspace's routes, which
 * avoids reproducing the full ERP-like route wall inside a narrow drawer.
 */
export function MobileWorkspaceNavigation({
  workspaces,
  primaryTasks,
  currentPath,
  dashboardBadge,
  onNavigate,
  onPrefetchSales,
}: MobileWorkspaceNavigationProps) {
  const { t: tWorkspaces } = useTranslation('workspaces');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeWorkspace = workspaces.find(workspace => ownsPath(workspace, currentPath));
  const activePrimaryTask = primaryTasks.find(task => taskOwnsPath(task, currentPath));
  const [manualWorkspaceId, setManualWorkspaceId] = useState<string | null>(null);
  const [manualToolsOpen, setManualToolsOpen] = useState<boolean | null>(null);
  const selectedWorkspaceId =
    manualWorkspaceId ?? activeWorkspace?.workspace.id ?? workspaces[0]?.workspace.id ?? '';
  const selectedWorkspace =
    workspaces.find(({ workspace }) => workspace.id === selectedWorkspaceId) ??
    activeWorkspace ??
    workspaces[0];
  const toolsOpen = manualToolsOpen ?? activePrimaryTask === undefined;

  const selectWorkspace = (index: number, focus = false) => {
    const target = workspaces[index];
    if (!target) return;
    setManualWorkspaceId(target.workspace.id);
    if (focus) requestAnimationFrame(() => tabRefs.current[index]?.focus());
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % workspaces.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + workspaces.length) % workspaces.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = workspaces.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    selectWorkspace(nextIndex, true);
  };

  const selectedLabel = selectedWorkspace ? tWorkspaces(selectedWorkspace.workspace.labelKey) : '';
  const selectedDescriptionKey = selectedWorkspace?.workspace.labelKey.replace(
    /\.label$/,
    '.description'
  );
  const hasLandingItem = selectedWorkspace?.items.some(
    item => item.href === selectedWorkspace.workspace.defaultRoute
  );
  const hasDirectory = (selectedWorkspace?.workspace.directoryGroups?.length ?? 0) > 0;
  const activeItem = selectedWorkspace?.items.find(
    item => currentPath === item.href || currentPath.startsWith(`${item.href}/`)
  );

  return (
    <nav aria-label={tWorkspaces('mobile.navigationLabel')} className="space-y-4">
      <section aria-labelledby="mobile-primary-title">
        <div className="mb-2 px-1">
          <p
            id="mobile-primary-title"
            className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-fg2"
          >
            {tWorkspaces('taskNavigation.frequentTasks')}
          </p>
        </div>
        <div className="space-y-2">
          {primaryTasks.map(task => (
            <PrimaryTaskLink
              key={task.id}
              task={task}
              onNavigate={onNavigate}
              onPrefetch={task.href === '/sales' ? onPrefetchSales : undefined}
              badgeCount={task.href === '/dashboard' ? dashboardBadge : undefined}
            />
          ))}
        </div>
      </section>

      <section className="rounded-[16px] border border-line/70 bg-surface-2/45 p-2">
        <button
          type="button"
          onClick={() => {
            if (activePrimaryTask) {
              setManualToolsOpen(previous => !(previous ?? toolsOpen));
            }
          }}
          aria-expanded={toolsOpen}
          aria-disabled={activePrimaryTask === undefined || undefined}
          aria-controls="mobile-more-tools"
          className="flex min-h-12 w-full items-center gap-3 rounded-[12px] px-2.5 text-left text-sm font-semibold text-secondary-900 transition-colors hover:bg-secondary-100/80 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
          data-testid="mobile-more-tools-toggle"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-[11px] bg-secondary-100 text-secondary-700">
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

        <div id="mobile-more-tools" hidden={!toolsOpen} className="mt-3 space-y-3">
          {toolsOpen && workspaces.length > 1 && (
            <div
              role="radiogroup"
              aria-label={tWorkspaces('mobile.workspaceSelector')}
              className="grid grid-cols-2 gap-2"
            >
              {workspaces.map(({ workspace }, index) => {
                const label = tWorkspaces(workspace.labelKey);
                const isSelected = workspace.id === selectedWorkspace?.workspace.id;
                const optionId = `mobile-workspace-option-${workspace.id}`;
                return (
                  <button
                    key={workspace.id}
                    ref={node => {
                      tabRefs.current[index] = node;
                    }}
                    id={optionId}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-controls="mobile-workspace-routes"
                    tabIndex={isSelected ? 0 : -1}
                    data-testid={`mobile-workspace-selector-${workspace.id}`}
                    onClick={() => selectWorkspace(index)}
                    onKeyDown={event => handleTabKeyDown(event, index)}
                    className={cn(
                      'flex min-h-12 items-center gap-2 rounded-[11px] border px-3 py-2 text-left text-xs font-semibold transition-colors',
                      isSelected
                        ? 'border-primary-300 bg-primary-50 text-primary-900 ring-2 ring-primary-100'
                        : 'border-line/70 bg-surface-2/60 text-fg2 hover:border-primary-200 hover:bg-primary-50/60'
                    )}
                  >
                    <workspace.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {toolsOpen && selectedWorkspace && (
            <section
              id="mobile-workspace-routes"
              role="region"
              aria-labelledby={
                workspaces.length > 1
                  ? `mobile-workspace-option-${selectedWorkspace.workspace.id}`
                  : undefined
              }
              aria-label={tWorkspaces('mobile.workspaceRoutes', { workspace: selectedLabel })}
              className="rounded-[14px] border border-line/70 bg-surface p-3"
            >
              <div className="px-1 pb-3">
                <p className="text-sm font-semibold text-secondary-950">{selectedLabel}</p>
                {selectedDescriptionKey && (
                  <p className="mt-1 text-xs leading-5 text-fg2">
                    {tWorkspaces(selectedDescriptionKey)}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                {!hasLandingItem && !hasDirectory && (
                  <Link
                    to={selectedWorkspace.workspace.defaultRoute}
                    onClick={onNavigate}
                    data-testid={`mobile-workspace-overview-${selectedWorkspace.workspace.id}`}
                    className="flex min-h-11 items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium text-fg2 transition-colors hover:bg-secondary-100/80 hover:text-secondary-950"
                  >
                    <selectedWorkspace.workspace.icon
                      className="h-5 w-5 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {tWorkspaces('mobile.openWorkspace', { workspace: selectedLabel })}
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </Link>
                )}
                {hasDirectory && activeItem && (
                  <p className="px-3 pb-0.5 pt-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-fg2">
                    {tWorkspaces('directoryNavigation.currentPage')}
                  </p>
                )}
                {(hasDirectory ? (activeItem ? [activeItem] : []) : selectedWorkspace.items).map(
                  item => (
                    <MobileNavigationLink
                      key={item.href}
                      item={item}
                      onNavigate={onNavigate}
                      onPrefetch={item.href === '/sales' ? onPrefetchSales : undefined}
                      badgeCount={item.href === '/dashboard' ? dashboardBadge : undefined}
                    />
                  )
                )}
                {hasDirectory && (
                  <NavLink
                    to={selectedWorkspace.workspace.defaultRoute}
                    onClick={onNavigate}
                    data-testid={`mobile-workspace-directory-${selectedWorkspace.workspace.id}`}
                    className={({ isActive }) =>
                      cn(
                        'mt-2 flex min-h-12 items-center gap-3 rounded-[12px] border px-3 py-2.5 text-sm font-semibold transition-colors',
                        isActive
                          ? 'border-primary-200 bg-primary-50 text-primary-900'
                          : 'border-line/70 bg-surface-2 text-secondary-900 hover:border-primary-200 hover:bg-primary-50/60'
                      )
                    }
                  >
                    {activeItem ? (
                      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <Grid3X3 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 leading-5">
                      {tWorkspaces(
                        activeItem
                          ? 'directoryNavigation.backToDirectory'
                          : 'directoryNavigation.openDirectory',
                        { workspace: selectedLabel }
                      )}
                    </span>
                    {!activeItem && <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  </NavLink>
                )}
              </div>
            </section>
          )}
        </div>
      </section>
    </nav>
  );
}
