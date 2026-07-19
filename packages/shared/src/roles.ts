/**
 * ENG-129a — Canonical user-role and role-group contract.
 *
 * These tuples are consumed by the database enum, tRPC validation and
 * middleware, and the renderer's route catalogue. Keeping the groups here
 * prevents a permission change from drifting between server enforcement and
 * the UI that explains the default role templates to administrators.
 */
export const USER_ROLES = ['admin', 'manager', 'cashier', 'viewer'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ADMIN_ONLY_ROLES = ['admin'] as const satisfies readonly UserRole[];

export const MANAGER_OR_ADMIN_ROLES = ['admin', 'manager'] as const satisfies readonly UserRole[];

export const SALES_ROLES = ['admin', 'manager', 'cashier'] as const satisfies readonly UserRole[];

export const DASHBOARD_ROLES = [
  'admin',
  'manager',
  'viewer',
] as const satisfies readonly UserRole[];
