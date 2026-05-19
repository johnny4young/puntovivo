/**
 * ENG-069 — KDS (Kitchen Display Screen) shell.
 *
 * Fullscreen black backdrop sized for a kitchen-mounted TV. No
 * sidebar / no Header — the kitchen station does not need
 * navigation chrome. v1 shipped the chrome only; the real ticket
 * queue landed with ENG-098 (kitchen display surface, 2026-05-19).
 *
 * Mounted as a top-level route in `App.tsx` so KDS owns its
 * viewport without competing with `MainLayout`.
 *
 * @module features/surfaces/KdsShell
 */

import { Suspense } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { RequireModule } from '@/features/modules/RequireModule';
import { salesRoles } from '@/features/auth/roleAccess';
import { PageLoadingState } from '@/components/feedback/LoadingState';

export function KdsShell() {
  const { t } = useTranslation('common');

  return (
    <ProtectedRoute allowedRoles={salesRoles}>
      <RequireModule id="kds" fallback={<Navigate to="/dashboard" replace />}>
        <div
          className="flex min-h-screen flex-col bg-secondary-950 text-secondary-50"
          data-testid="kds-shell"
        >
          <main className="flex-1 px-6 py-6">
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
