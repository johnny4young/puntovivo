import type { UserRole } from '@/types';

export const adminOnlyRoles = ['admin'] as const satisfies readonly UserRole[];
export const managerOrAdminRoles = ['admin', 'manager'] as const satisfies readonly UserRole[];
export const salesRoles = ['admin', 'manager', 'cashier'] as const satisfies readonly UserRole[];
export const dashboardRoles = ['admin', 'manager', 'viewer'] as const satisfies readonly UserRole[];

export function canAccessRole(
  role: UserRole | undefined,
  allowedRoles?: readonly UserRole[]
): boolean {
  if (!allowedRoles || allowedRoles.length === 0) {
    return true;
  }

  if (!role) {
    return false;
  }

  return allowedRoles.includes(role);
}

export function getDefaultRouteForRole(role: UserRole | undefined): string {
  if (role === 'cashier') {
    return '/sales';
  }

  return '/dashboard';
}
