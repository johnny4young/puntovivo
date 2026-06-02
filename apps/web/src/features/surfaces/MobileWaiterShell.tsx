/**
 * ENG-069 — Mobile Waiter shell.
 *
 * Phone-width layout (max-width clamped to mobile breakpoint) for
 * waitstaff taking orders at the table. v1 ships the chrome only;
 * the actual table-side ordering flow lands with ENG-039.
 *
 * The container is `max-w-md mx-auto` so the layout still works
 * when accessed from a desktop browser during development, but
 * displays exactly as a phone-width app would on a real device.
 * ENG-183 — role + module gating moved up to `SurfaceShellRoute`;
 * this shell is pure presentational chrome around its `<Outlet />`.
 *
 * @module features/surfaces/MobileWaiterShell
 */

import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageLoadingState } from '@/components/feedback/LoadingState';

export function MobileWaiterShell() {
  const { t } = useTranslation('common');

  return (
    <div
      className="mx-auto flex min-h-screen max-w-md flex-col bg-surface text-secondary-950"
      data-testid="mobile-waiter-shell"
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
