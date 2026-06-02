import { Suspense, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { useModulesSnapshot } from '@/features/modules';
import type { ClientModuleId } from '@/features/modules';
import type { UserRole } from '@/types';

/**
 * Route wrapper for the full-screen surfaces (POS Touch, KDS, Customer
 * Display, Mobile Waiter) that live outside `MainLayout` and own their
 * viewport.
 *
 * ENG-183 — gates by role AND module at the ROUTE level, BEFORE the lazy
 * surface bundle loads, so a hidden module never fetches its chunk or
 * flashes its chrome on direct-URL navigation. (The old design gated INSIDE
 * each lazily-loaded shell, after the bundle had already mounted.)
 *
 * Module hydration matters here: `useModulesSnapshot` seeds the optimistic
 * client default (every surface module defaults OFF) until `getEffective`
 * lands. Gating on that default would bounce a cold direct-URL hit on an
 * ENABLED surface straight to /dashboard. So while the snapshot is still a
 * placeholder we render the loading state and only decide once the real
 * tenant module state has hydrated. The surface shells are pure
 * presentational chrome; all role/module gating lives here.
 */
export function SurfaceShellRoute({
  children,
  allowedRoles,
  allowedModule,
}: {
  children: ReactNode;
  /** Lowest roles allowed to reach the surface; omitted means any signed-in user. */
  allowedRoles?: readonly UserRole[];
  /** Module that must be active for the tenant; omitted means no module gate. */
  allowedModule?: ClientModuleId;
}) {
  const { t } = useTranslation('common');
  const { modules, isPlaceholder } = useModulesSnapshot();

  const loadingState = (
    <PageLoadingState
      title={t('loading.pageTitle')}
      description={t('loading.pageDescription')}
    />
  );

  let content: ReactNode;
  if (allowedModule && isPlaceholder) {
    // Module state not hydrated yet — never redirect on the optimistic
    // default; show loading until the tenant snapshot resolves.
    content = loadingState;
  } else if (allowedModule && !modules[allowedModule]) {
    content = <Navigate to="/dashboard" replace />;
  } else {
    content = <Suspense fallback={loadingState}>{children}</Suspense>;
  }

  if (allowedRoles) {
    content = <ProtectedRoute allowedRoles={allowedRoles}>{content}</ProtectedRoute>;
  }

  return content;
}
