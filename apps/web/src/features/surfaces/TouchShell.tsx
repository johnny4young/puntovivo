/**
 * ENG-069 — POS Touch shell.
 *
 * Touch-optimized layout for tablet sales: wider primary buttons,
 * bigger fonts, sticky bottom action bar. v1 ships the chrome only;
 * the actual touch-optimized sales flow lands with ENG-039.
 *
 * Mounted as a top-level route in `App.tsx` (NOT nested in
 * `MainLayout`) so the touch surface owns its full viewport. Module
 * gating + auth + Suspense are layered around `<Outlet />` here so
 * each surface owns its lifecycle without forking the App component.
 *
 * @module features/surfaces/TouchShell
 */

import { Suspense } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { RequireModule } from '@/features/modules/RequireModule';
import { salesRoles } from '@/features/auth/roleAccess';
import { PageLoadingState } from '@/components/feedback/LoadingState';

export function TouchShell() {
  const { t } = useTranslation('common');

  return (
    <ProtectedRoute allowedRoles={salesRoles}>
      <RequireModule id="pos-touch" fallback={<Navigate to="/dashboard" replace />}>
        <div
          className="flex min-h-screen flex-col bg-secondary-50 text-base"
          data-testid="touch-shell"
        >
          <main className="flex-1 px-6 py-6 sm:px-8 sm:py-8">
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
