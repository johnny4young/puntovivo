import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthProvider';
import { ReactNode } from 'react';
import type { UserRole } from '@/types';
import { canAccessRole, getDefaultRouteForRole } from './roleAccess';
import { FullscreenLoadingState } from '@/components/feedback/LoadingState';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: readonly UserRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { t } = useTranslation('auth');
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <FullscreenLoadingState
        title={t('protected.loadingTitle')}
        description={t('protected.loadingDescription')}
      />
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!canAccessRole(user?.role, allowedRoles)) {
    return <Navigate to={getDefaultRouteForRole(user?.role)} replace />;
  }

  return <>{children}</>;
}
