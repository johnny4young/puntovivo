/**
 * ENG-069 — Customer Display shell.
 *
 * Second-monitor cart mirror — read-only chrome for a public-facing
 * screen that shows the cashier's cart to the customer. v1 ships
 * the layout chrome only; the actual cart-mirror data flow lands
 * with ENG-039 (or a follow-up that adds a session-token-based
 * unauthenticated mode).
 *
 * v1 keeps this surface BEHIND the auth shell (cashier role, enforced
 * by `SurfaceShellRoute`) so the operator launches it from inside the
 * authenticated session. A future iteration may add an unauthenticated
 * mode for public second monitors. ENG-183 — role + module gating moved
 * up to `SurfaceShellRoute`; this shell is pure presentational chrome.
 *
 * @module features/surfaces/CustomerDisplayShell
 */

import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageLoadingState } from '@/components/feedback/LoadingState';

export function CustomerDisplayShell() {
  const { t } = useTranslation('common');

  return (
    <div
      className="flex min-h-screen flex-col bg-gradient-to-br from-primary-50 to-secondary-50 text-secondary-950"
      data-testid="customer-display-shell"
    >
      <main className="flex-1 px-8 py-10">
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
