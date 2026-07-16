import type { UserRole } from '@puntovivo/shared/roles';
import type { ManagerApprovalAction } from '@puntovivo/shared/manager-approval';
import { and, eq, gte } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { auditLogs } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../audit-logs.js';
import { getActiveCashSessionForCashier } from '../cash-session.js';
import {
  claimActionApproval,
  claimManagerApprovalGrant,
  type ManagerApprovalClaim,
} from '../manager-approvals.js';
import {
  resolveLossPreventionSettings,
  type LossPreventionNoSalePolicy,
  type LossPreventionRole,
  type LossPreventionShiftValuePolicy,
} from './settings.js';

export type ShiftLossPreventionAction = Extract<
  ManagerApprovalAction,
  'sale_refund' | 'sale_void' | 'cash_drawer_open'
>;

type ShiftLimitPolicy =
  | { kind: 'value'; value: LossPreventionShiftValuePolicy }
  | { kind: 'count'; value: LossPreventionNoSalePolicy };

export type ShiftLossPreventionViolation = {
  kind: 'shift_refund_limit' | 'shift_void_limit' | 'no_sale_limit';
  action: ShiftLossPreventionAction;
  reason: 'limit_exceeded' | 'shift_unavailable';
  exceeded: Array<'count' | 'amount' | 'shift'>;
  currentCount: number;
  prospectiveCount: number;
  maxCount: number;
  currentAmount: number;
  prospectiveAmount: number;
  maxAmount: number | null;
};

export interface ShiftLossPreventionEvaluation {
  role: UserRole;
  action: ShiftLossPreventionAction;
  cashSessionId: string | null;
  policyEnabled: boolean;
  requiresApproval: boolean;
  violation: ShiftLossPreventionViolation | null;
}

function policyRole(role: UserRole): LossPreventionRole | null {
  return role === 'cashier' || role === 'manager' ? role : null;
}

function policyForAction(
  role: LossPreventionRole,
  action: ShiftLossPreventionAction,
  settings: ReturnType<typeof resolveLossPreventionSettings>
): ShiftLimitPolicy {
  const shift = settings.roles[role].shift;
  if (action === 'sale_refund') return { kind: 'value', value: shift.refunds };
  if (action === 'sale_void') return { kind: 'value', value: shift.voids };
  return { kind: 'count', value: shift.noSale };
}

function completedAuditAction(action: ShiftLossPreventionAction): string {
  if (action === 'sale_refund') return 'sale.return';
  if (action === 'sale_void') return 'sale.void';
  return 'cash_drawer.open';
}

function completedAmount(
  action: ShiftLossPreventionAction,
  row: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }
): number {
  const raw =
    action === 'sale_refund'
      ? row.after?.refundAmount
      : action === 'sale_void'
        ? row.before?.total
        : 0;
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

function violationKind(action: ShiftLossPreventionAction): ShiftLossPreventionViolation['kind'] {
  if (action === 'sale_refund') return 'shift_refund_limit';
  if (action === 'sale_void') return 'shift_void_limit';
  return 'no_sale_limit';
}

/** ENG-142b — evaluate one sensitive action against the actor's open cash shift. */
export function evaluateShiftLossPrevention(args: {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  actorId: string;
  role: UserRole;
  action: ShiftLossPreventionAction;
  amount?: number | undefined;
}): ShiftLossPreventionEvaluation {
  const role = policyRole(args.role);
  if (!role) {
    return {
      role: args.role,
      action: args.action,
      cashSessionId: null,
      policyEnabled: false,
      requiresApproval: false,
      violation: null,
    };
  }

  const settings = resolveLossPreventionSettings(args.db, args.tenantId);
  const configured = policyForAction(role, args.action, settings);
  if (!configured.value.enabled) {
    return {
      role: args.role,
      action: args.action,
      cashSessionId: null,
      policyEnabled: false,
      requiresApproval: false,
      violation: null,
    };
  }

  const activeSession = getActiveCashSessionForCashier(
    args.db,
    args.tenantId,
    args.siteId,
    args.actorId
  );
  const maxCount = configured.value.maxCount;
  const maxAmount = configured.kind === 'value' ? configured.value.maxAmount : null;
  const actionAmount = roundMoney(Math.max(0, args.amount ?? 0));

  if (!activeSession) {
    const violation: ShiftLossPreventionViolation = {
      kind: violationKind(args.action),
      action: args.action,
      reason: 'shift_unavailable',
      exceeded: ['shift'],
      currentCount: 0,
      prospectiveCount: 1,
      maxCount,
      currentAmount: 0,
      prospectiveAmount: actionAmount,
      maxAmount,
    };
    return {
      role: args.role,
      action: args.action,
      cashSessionId: null,
      policyEnabled: true,
      requiresApproval: true,
      violation,
    };
  }

  const completed = args.db
    .select({
      resourceId: auditLogs.resourceId,
      before: auditLogs.before,
      after: auditLogs.after,
      metadata: auditLogs.metadata,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, args.tenantId),
        eq(auditLogs.actorId, args.actorId),
        eq(auditLogs.action, completedAuditAction(args.action)),
        gte(auditLogs.createdAt, activeSession.openedAt)
      )
    )
    .all()
    .filter(row => {
      if (args.action === 'cash_drawer_open') return row.resourceId === args.siteId;
      const recordedSessionId = row.metadata?.lossPreventionCashSessionId;
      return typeof recordedSessionId !== 'string' || recordedSessionId === activeSession.id;
    });
  const currentCount = completed.length;
  const currentAmount = roundMoney(
    completed.reduce((sum, row) => roundMoney(sum + completedAmount(args.action, row)), 0)
  );
  const prospectiveCount = currentCount + 1;
  const prospectiveAmount = roundMoney(currentAmount + actionAmount);
  const exceeded: ShiftLossPreventionViolation['exceeded'] = [];
  if (prospectiveCount > maxCount) exceeded.push('count');
  if (maxAmount !== null && prospectiveAmount > maxAmount) exceeded.push('amount');
  const violation: ShiftLossPreventionViolation | null =
    exceeded.length > 0
      ? {
          kind: violationKind(args.action),
          action: args.action,
          reason: 'limit_exceeded',
          exceeded,
          currentCount,
          prospectiveCount,
          maxCount,
          currentAmount,
          prospectiveAmount,
          maxAmount,
        }
      : null;

  return {
    role: args.role,
    action: args.action,
    cashSessionId: activeSession.id,
    policyEnabled: true,
    requiresApproval: violation !== null,
    violation,
  };
}

/** A denied or approved cap crossing leaves one privacy-safe trigger row. */
export function recordShiftLossPreventionTrigger(args: {
  db: DatabaseInstance;
  tenantId: string;
  actorId: string;
  siteId: string;
  resourceType: 'sale' | 'site';
  resourceId: string;
  evaluation: ShiftLossPreventionEvaluation;
  approvalRequestId?: string | null | undefined;
  operationId?: string | null | undefined;
}): void {
  const violation = args.evaluation.violation;
  if (!violation) return;
  writeAuditLog({
    tx: args.db,
    tenantId: args.tenantId,
    actorId: args.actorId,
    action: 'loss_prevention.triggered',
    resourceType: 'loss_prevention_rule',
    resourceId: violation.kind,
    after: {
      requiredAction: violation.action,
      approvalProvided: Boolean(args.approvalRequestId),
    },
    metadata: {
      siteId: args.siteId,
      actionResourceType: args.resourceType,
      actionResourceId: args.resourceId,
      role: args.evaluation.role,
      cashSessionId: args.evaluation.cashSessionId,
      ...violation,
    },
    operationId: args.operationId,
  });
}

/** Policy violations override normal direct authority and require an exact grant. */
export function claimShiftLossPreventionApproval(args: {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  requesterId: string;
  requesterRole: UserRole;
  action: ShiftLossPreventionAction;
  resourceType: 'sale' | 'site';
  resourceId: string;
  requestId?: string | undefined;
  evaluation: ShiftLossPreventionEvaluation;
}): ManagerApprovalClaim | null {
  if (!args.evaluation.requiresApproval) {
    return claimActionApproval(args);
  }
  if (!args.requestId) {
    throwServerError({
      trpcCode: 'FORBIDDEN',
      errorCode: 'MANAGER_APPROVAL_REQUIRED',
      message: 'An approved manager request is required for this action',
    });
  }
  return claimManagerApprovalGrant({
    db: args.db,
    tenantId: args.tenantId,
    siteId: args.siteId,
    requesterId: args.requesterId,
    requestId: args.requestId,
    action: args.action,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
  });
}
