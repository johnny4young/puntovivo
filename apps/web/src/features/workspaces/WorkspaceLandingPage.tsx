/**
 * ENG-131c — Workspace landing page.
 *
 * Generic landing rendered by the new `/catalog`, `/procurement`, and
 * `/finance` routes. The page reads the canonical workspace catalogue
 * from `components/layout/workspaces.ts` (the same source the sidebar
 * uses for ENG-131 slice A) and renders the items the current
 * operator can see, filtered by role + active modules.
 *
 * Each card is an `<a>` (React Router `Link`) so screen readers
 * announce a link and `cmd+click` opens the item in a new tab —
 * matching the affordance of the sidebar nav items.
 *
 * Defensive: if the operator lands here with zero visible items
 * (rare — the sidebar would have omitted the workspace entirely, but
 * a direct URL or stale link can hit it), the page redirects to
 * `/dashboard` instead of rendering an empty grid that has no
 * follow-up action.
 *
 * @module features/workspaces/WorkspaceLandingPage
 */
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { useModulesSnapshot } from '@/features/modules';
import {
  WORKSPACES,
  visibleItemsForWorkspace,
} from '@/components/layout/workspaces';

export interface WorkspaceLandingPageProps {
  /** Workspace id from `WORKSPACES` (e.g. "catalog", "procurement", "finance"). */
  workspaceId: string;
}

export function WorkspaceLandingPage({ workspaceId }: WorkspaceLandingPageProps) {
  const { t: tNav } = useTranslation('nav');
  const { t: tWorkspaces } = useTranslation('workspaces');
  const { user } = useAuth();
  const { modules } = useModulesSnapshot();

  const workspace = WORKSPACES.find(w => w.id === workspaceId);
  if (!workspace) {
    return <Navigate to="/dashboard" replace />;
  }

  const items = visibleItemsForWorkspace(workspace, user?.role, modules);
  if (items.length === 0) {
    return <Navigate to="/dashboard" replace />;
  }

  const WorkspaceIcon = workspace.icon;
  const title = tWorkspaces(`${workspace.id}.label`);
  const description = tWorkspaces(`${workspace.id}.description`);

  return (
    <div
      className="space-y-6"
      data-testid={`workspace-landing-${workspace.id}`}
    >
      <header className="space-y-2">
        <div className="inline-flex items-center gap-3">
          <WorkspaceIcon className="h-7 w-7 text-primary" aria-hidden="true" />
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {title}
          </h1>
        </div>
        <p className="max-w-2xl text-muted-foreground">{description}</p>
      </header>
      <ul
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        role="list"
      >
        {items.map(item => {
          const Icon = item.icon;
          const itemLabel = tNav(item.nameKey);
          return (
            <li key={item.href}>
              <Link
                to={item.href}
                className="group block rounded-[28px] border border-line/80 bg-card/92 p-5 shadow-[var(--shadow-card)] backdrop-blur-xl transition hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50"
              >
                <Icon
                  className="h-6 w-6 text-primary transition-transform group-hover:scale-110"
                  aria-hidden="true"
                />
                <h2 className="mt-3 font-display text-lg font-semibold leading-tight">
                  {itemLabel}
                </h2>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
