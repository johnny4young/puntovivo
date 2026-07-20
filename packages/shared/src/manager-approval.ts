import type { UserRole } from './roles.js';

/** Stable sensitive-action catalogue shared by renderer, server, and schema. */
export const managerApprovalActionEnum = [
  'credit_override',
  'sale_void',
  'sale_discount',
  'cash_drawer_open',
  'sale_refund',
  'credit_sale',
  // deterministic local blocked-window checkout escalation.
  'sale_after_hours',
] as const;

export type ManagerApprovalAction = (typeof managerApprovalActionEnum)[number];

const ADMIN_ONLY_ACTIONS = new Set<ManagerApprovalAction>(['credit_override', 'sale_void']);

/**
 * Whether a role may perform an action directly without consuming a grant.
 * Cashiers always escalate; managers escalate only admin-only actions.
 */
export function canRolePerformApprovalActionDirectly(
  role: UserRole | undefined,
  action: ManagerApprovalAction
): boolean {
  if (role === 'admin') return true;
  return role === 'manager' && !ADMIN_ONLY_ACTIONS.has(action);
}

export function requiredApprovalRole(action: ManagerApprovalAction): 'admin' | 'manager' {
  return ADMIN_ONLY_ACTIONS.has(action) ? 'admin' : 'manager';
}
