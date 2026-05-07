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
 *
 * @module features/surfaces/MobileWaiterShell
 */

import { Suspense } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { RequireModule } from '@/features/modules/RequireModule';
import { salesRoles } from '@/features/auth/roleAccess';
import { PageLoadingState } from '@/components/feedback/LoadingState';

export function MobileWaiterShell() {
  const { t } = useTranslation('common');

  return (
    <ProtectedRoute allowedRoles={salesRoles}>
      <RequireModule
        id="mobile-waiter"
        fallback={<Navigate to="/dashboard" replace />}
      >
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
      </RequireModule>
    </ProtectedRoute>
  );
}
