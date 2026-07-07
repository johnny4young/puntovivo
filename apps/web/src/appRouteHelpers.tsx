// Route-wrapper components for the app router, extracted from App.tsx
// (ENG-178 slice 35). HomeRedirect resolves the role default; LoginRoute is the
// login Suspense fallback; ShellRoute is the protected + module-gated Suspense
// wrapper every in-layout route uses.

import { Suspense, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RouteErrorBoundary } from '@/components/feedback/AppErrorBoundary';
import { FullscreenLoadingState, PageLoadingState } from '@/components/feedback/LoadingState';
import { useAuth } from '@/features/auth/AuthProvider';
import { getDefaultRouteForRole } from '@/features/auth/roleAccess';
import { RequireModule, useModulesSnapshot } from '@/features/modules';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import type { UserRole } from '@/types';
import type { ClientModuleId } from '@/features/modules';

export function HomeRedirect() {
  const { user } = useAuth();

  return <Navigate to={getDefaultRouteForRole(user?.role)} replace />;
}

export function LoginRoute({ children }: { children: ReactNode }) {
  const { t } = useTranslation('auth');

  return (
    <Suspense
      fallback={
        <FullscreenLoadingState
          title={t('login.loadingTitle')}
          description={t('login.loadingDescription')}
        />
      }
    >
      {children}
    </Suspense>
  );
}

export function ShellRoute({
  allowedRoles,
  allowedModule,
  children,
}: {
  allowedRoles?: readonly UserRole[];
  /**
   * ENG-068 — when set, the route renders only when the module is
   * active for the active tenant. When the module is off, the route
   * redirects to `/dashboard` (the closest universally-allowed
   * destination) so a stale URL or a manager who flipped the module
   * mid-session is never trapped on a blank route.
   */
  allowedModule?: ClientModuleId;
  children: ReactNode;
}) {
  const { t } = useTranslation('common');
  const { isPlaceholder } = useModulesSnapshot();

  const loadingState = (
    <PageLoadingState title={t('loading.pageTitle')} description={t('loading.pageDescription')} />
  );

  // RouteErrorBoundary keeps a page crash contained to the route slot —
  // the shell (nav, open drawers on other state) survives and the
  // operator can retry just the crashed page.
  const inner = (
    <RouteErrorBoundary>
      <Suspense fallback={loadingState}>{children}</Suspense>
    </RouteErrorBoundary>
  );

  const content =
    allowedModule && isPlaceholder ? (
      // ENG-183 reviewer fix — hidden modules must not flash while the
      // tenant's explicit module profile is still hydrating. This matters
      // for Ring-1 fresh tenants because AI modules have manifest defaults
      // of ON for legacy tenants, but the fresh profile writes them OFF.
      loadingState
    ) : allowedModule ? (
      <RequireModule id={allowedModule} fallback={<Navigate to="/dashboard" replace />}>
        {inner}
      </RequireModule>
    ) : (
      inner
    );

  return <ProtectedRoute allowedRoles={allowedRoles}>{content}</ProtectedRoute>;
}
