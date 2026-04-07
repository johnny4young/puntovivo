import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { ReactNode } from 'react';
import type { UserRole } from '@/types';
import { canAccessRole, getDefaultRouteForRole } from './roleAccess';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: readonly UserRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
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
