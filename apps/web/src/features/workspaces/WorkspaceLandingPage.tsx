/**
 * Workspace landing page.
 *
 * Generic landing rendered by the new `/catalog`, `/procurement`, and
 * `/finance` routes. The page reads the canonical workspace catalogue
 * from `components/layout/workspaces.ts` (the same source the sidebar
 * uses for  slice A) and renders the items the current
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
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { useModulesSnapshot } from '@/features/modules';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { WORKSPACES, visibleItemsForWorkspace } from '@/components/layout/workspaces';

export interface WorkspaceLandingPageProps {
  /** Workspace id from `WORKSPACES` (e.g. "catalog", "procurement", "finance"). */
  workspaceId: string;
}

export function WorkspaceLandingPage({ workspaceId }: WorkspaceLandingPageProps) {
  const { t: tNav } = useTranslation('nav');
  const { t: tWorkspaces } = useTranslation('workspaces');
  const { t: tCommon } = useTranslation('common');
  const { user } = useAuth();
  const { modules, isPlaceholder } = useModulesSnapshot();

  const workspace = WORKSPACES.find(w => w.id === workspaceId);
  if (!workspace) {
    return <Navigate to="/dashboard" replace />;
  }

  const items = visibleItemsForWorkspace(workspace, user?.role, modules, !isPlaceholder);
  if (items.length === 0) {
    if (isPlaceholder) {
      return (
        <PageLoadingState
          title={tCommon('loading.pageTitle')}
          description={tCommon('loading.pageDescription')}
        />
      );
    }
    return <Navigate to="/dashboard" replace />;
  }

  const WorkspaceIcon = workspace.icon;
  const title = tWorkspaces(`${workspace.id}.label`);
  const description = tWorkspaces(`${workspace.id}.description`);
  // Reuse the existing per-workspace kicker already declared for the
  // page header in `nav.header.*` (Catalog / Operations / Fiscal) so
  // the landing matches the shell's titling contract without a new key.
  const kicker = tNav(`header.${workspace.id}.kicker`);

  return (
    <div className="space-y-6" data-testid={`workspace-landing-${workspace.id}`}>
      <header className="flex items-start gap-3">
        <span className="pv-gt pv-gt-primary h-11 w-11 rounded-xl">
          <WorkspaceIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="pv-kicker">{kicker}</p>
          <h1 className="pv-title text-3xl">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-secondary-500">{description}</p>
        </div>
      </header>
      <ul className="pv-hub-grid" role="list">
        {items.map(item => {
          const Icon = item.icon;
          const itemLabel = tNav(item.nameKey);
          return (
            <li key={item.href}>
              <Link
                to={item.href}
                className="pv-hub group block transition hover:border-primary-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50"
              >
                <div className="hd">
                  <span className="pv-gt pv-gt-primary h-10 w-10 rounded-xl">
                    <Icon
                      className="h-5 w-5 transition-transform group-hover:scale-110"
                      aria-hidden="true"
                    />
                  </span>
                  <h2 className="text-base font-semibold leading-tight text-fg1">{itemLabel}</h2>
                </div>
                <div className="ft justify-end">
                  <span className="go">
                    {tWorkspaces('viewItem')}
                    <ArrowRight className="h-[13px] w-[13px]" aria-hidden="true" />
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
