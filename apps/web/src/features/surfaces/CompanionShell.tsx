/**
 * Companion shell.
 *
 * Phone-width chrome for the owner's companion: the surface a business
 * owner opens away from the counter. Same clamped `max-w-md` container as
 * the mobile waiter so it renders honestly on a desktop browser.
 *
 * Role + module gating live in `SurfaceShellRoute`; this shell is the
 * container and the tab bar around its `<Outlet />`.
 *
 * @module features/surfaces/CompanionShell
 */

import { Suspense, useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { useAuth } from '@/features/auth/AuthProvider';
import { cn } from '@/lib/utils';
import { registerCompanionServiceWorker } from './companionPwa';
import { CompanionTabBar } from './CompanionTabBar';
import { isCompanionOwner, parseCompanionView } from './companionViews';

export function CompanionShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const needsCanonicalRedirect = location.pathname === '/c';
  const { user } = useAuth();
  const { t } = useTranslation('common');
  const owner = isCompanionOwner(user?.role);
  const view = parseCompanionView(searchParams.get('view'), owner);

  useEffect(() => {
    if (needsCanonicalRedirect) return;
    void registerCompanionServiceWorker();
  }, [needsCanonicalRedirect]);

  useEffect(() => {
    const worker = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!worker) return;
    const onMessage = (event: MessageEvent) => {
      const url: unknown = event.data?.type === 'companion:navigate' ? event.data.url : null;
      if (typeof url === 'string' && url.startsWith('/c/')) void navigate(url);
    };
    worker.addEventListener('message', onMessage);
    return () => worker.removeEventListener('message', onMessage);
  }, [navigate]);

  if (needsCanonicalRedirect) {
    return (
      <Navigate to={{ pathname: '/c/', search: location.search, hash: location.hash }} replace />
    );
  }

  return (
    <div
      className={cn(
        // The sealed day is the night screen, so it borrows the dark tokens.
        'mx-auto flex min-h-screen max-w-md flex-col bg-[var(--background)] text-fg1',
        view === 'day' && 'dark'
      )}
      data-testid="companion-shell"
    >
      <main className="flex-1 px-4 pt-5 pb-28">
        <Suspense
          fallback={
            <PageLoadingState
              title={t('loading.pageTitle')}
              description={t('loading.pageDescription')}
            />
          }
        >
          <Outlet />
        </Suspense>
      </main>
      <CompanionTabBar owner={owner} active={view} />
    </div>
  );
}
