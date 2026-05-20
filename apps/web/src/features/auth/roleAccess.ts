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

/**
 * ENG-104 — Post-login routing that takes setup readiness into
 * account. Cashiers always go straight to `/sales` regardless of
 * tenant state — their flow is POS-direct and the setup checklist is
 * an admin concern. Admin lands on `/company?tab=readiness` when
 * there are unresolved blockers AND the operator has never
 * acknowledged the setup. Everyone else lands on the legacy default
 * (`/dashboard`).
 *
 * Defense in depth: if the readiness payload cannot be resolved (e.g.
 * the procedure failed), the caller passes `hasBlockers=false` so
 * the function falls back to the existing `/dashboard` default
 * instead of trapping the operator on a setup screen.
 */
export function getDefaultRouteForRoleWithSetup(args: {
  role: UserRole | undefined;
  hasBlockers: boolean;
  acknowledgedAt: string | null;
}): string {
  if (args.role === 'cashier') {
    return '/sales';
  }
  if (
    args.role === 'admin' &&
    args.hasBlockers &&
    args.acknowledgedAt === null
  ) {
    return '/company?tab=readiness';
  }
  return '/dashboard';
}
