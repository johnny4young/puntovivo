/**
 * Companion shell.
 *
 * Phone-width chrome for the read-only owner companion: the surface a
 * business owner opens away from the counter to see how the day is
 * going. Same clamped `max-w-md` container as the mobile waiter so it
 * renders honestly on a desktop browser during development.
 *
 * Role + module gating live in `SurfaceShellRoute`; this shell is pure
 * presentational chrome around its `<Outlet />`.
 *
 * @module features/surfaces/CompanionShell
 */

import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageLoadingState } from '@/components/feedback/LoadingState';

export function CompanionShell() {
  const { t } = useTranslation('common');

  return (
    <div
      className="mx-auto flex min-h-screen max-w-md flex-col bg-surface text-secondary-950"
      data-testid="companion-shell"
    >
      <main className="flex-1 px-4 py-4">
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
    </div>
  );
}
