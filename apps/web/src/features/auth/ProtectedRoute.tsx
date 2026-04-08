import { Navigate, useLocation } from 'react-router-dom';
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
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <FullscreenLoadingState
        title="Loading workspace"
        description="Restoring your session and access rules."
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
