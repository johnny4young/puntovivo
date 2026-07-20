import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { WorkspaceItem, VisibleWorkspace } from './workspaces';

interface MobileWorkspaceNavigationProps {
  workspaces: readonly VisibleWorkspace[];
  currentPath: string;
  dashboardBadge: number;
  onNavigate: () => void;
  onPrefetchSales: () => void;
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
  currentPath,
  dashboardBadge,
  onNavigate,
  onPrefetchSales,
}: MobileWorkspaceNavigationProps) {
  const { t: tWorkspaces } = useTranslation('workspaces');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeWorkspace = workspaces.find(workspace => ownsPath(workspace, currentPath));
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    activeWorkspace?.workspace.id ?? workspaces[0]?.workspace.id ?? ''
  );
  const selectedWorkspace =
    workspaces.find(({ workspace }) => workspace.id === selectedWorkspaceId) ??
    activeWorkspace ??
    workspaces[0];

  const selectWorkspace = (index: number, focus = false) => {
    const target = workspaces[index];
    if (!target) return;
    setSelectedWorkspaceId(target.workspace.id);
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

  return (
    <nav aria-label={tWorkspaces('mobile.navigationLabel')} className="space-y-4">
      {workspaces.length > 1 && (
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
                  'flex min-h-12 items-center gap-2 rounded-[18px] border px-3 py-2 text-left text-xs font-semibold transition-colors',
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

      {selectedWorkspace && (
        <section
          id="mobile-workspace-routes"
          role="region"
          aria-labelledby={
            workspaces.length > 1
              ? `mobile-workspace-option-${selectedWorkspace.workspace.id}`
              : undefined
          }
          aria-label={tWorkspaces('mobile.workspaceRoutes', { workspace: selectedLabel })}
          className="rounded-[24px] border border-line/70 bg-surface-2/45 p-3"
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
            {!hasLandingItem && (
              <Link
                to={selectedWorkspace.workspace.defaultRoute}
                onClick={onNavigate}
                data-testid={`mobile-workspace-overview-${selectedWorkspace.workspace.id}`}
                className="flex min-h-11 items-center gap-3 rounded-[18px] px-3 py-2.5 text-sm font-medium text-fg2 transition-colors hover:bg-secondary-100/80 hover:text-secondary-950"
              >
                <selectedWorkspace.workspace.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  {tWorkspaces('mobile.openWorkspace', { workspace: selectedLabel })}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Link>
            )}
            {selectedWorkspace.items.map(item => (
              <MobileNavigationLink
                key={item.href}
                item={item}
                onNavigate={onNavigate}
                onPrefetch={item.href === '/sales' ? onPrefetchSales : undefined}
                badgeCount={item.href === '/dashboard' ? dashboardBadge : undefined}
              />
            ))}
          </div>
        </section>
      )}
    </nav>
  );
}
