/**
 * Manager approval policy shared by the queue and sensitive action adapters.
 *
 * Requests last ten minutes. An approved grant is deliberately shorter: the
 * cashier must use it within two minutes, and every decision requires a fresh
 * manager/admin PIN. No elevated session is minted or cached.
 */
import type { UserRole } from '@puntovivo/shared/roles';
import type {
  ManagerApprovalAction,
  ManagerApprovalRequest,
  ManagerApprovalStatus,
} from '../db/schema.js';

export const MANAGER_APPROVAL_REQUEST_TTL_MS = 10 * 60_000;
export const MANAGER_APPROVAL_GRANT_TTL_MS = 2 * 60_000;
export const MANAGER_APPROVAL_CLAIM_TTL_MS = 30_000;

const ADMIN_ONLY_APPROVALS = new Set<ManagerApprovalAction>([
  'credit_override',
  'sale_void',
]);

export function canRoleApproveAction(
  role: UserRole,
  action: ManagerApprovalAction
): boolean {
  if (role === 'admin') return true;
  return role === 'manager' && !ADMIN_ONLY_APPROVALS.has(action);
}

export function requiredApproverLabel(action: ManagerApprovalAction): 'admin' | 'manager' {
  return ADMIN_ONLY_APPROVALS.has(action) ? 'admin' : 'manager';
}

export function effectiveManagerApprovalStatus(
  request: Pick<
    ManagerApprovalRequest,
    'status' | 'expiresAt' | 'grantExpiresAt' | 'claimExpiresAt'
  >,
  nowIso: string = new Date().toISOString()
): ManagerApprovalStatus {
  if (request.status === 'pending' && request.expiresAt <= nowIso) return 'expired';
  if (
    request.status === 'approved' &&
    (!request.grantExpiresAt || request.grantExpiresAt <= nowIso)
  ) {
    return 'expired';
  }
  if (
    request.status === 'executing' &&
    (!request.claimExpiresAt || request.claimExpiresAt <= nowIso)
  ) {
    return 'approved';
  }
  return request.status;
}
