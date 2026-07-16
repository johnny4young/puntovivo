import type { UserRole } from '@puntovivo/shared/roles';
import type {
  CheckoutApprovalAction,
  CheckoutApprovalItem,
} from '@puntovivo/shared/checkout-approval';
import type { DatabaseInstance } from '../../db/index.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../audit-logs.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import {
  resolveLossPreventionSettings,
  type LossPreventionRole,
  type LossPreventionRolePolicy,
} from './settings.js';

export type CheckoutLossPreventionViolation =
  | {
      kind: 'max_discount';
      action: 'sale_discount';
      observedPercent: number;
      thresholdPercent: number;
    }
  | {
      kind: 'after_hours_sale';
      action: 'sale_after_hours';
      localTime: string;
      blockedFrom: string;
      blockedUntil: string;
    }
  | {
      kind: 'dual_approval_threshold';
      action: 'sale_discount';
      observedAmount: number;
      thresholdAmount: number;
    };

export interface CheckoutLossPreventionEvaluation {
  role: UserRole;
  timeZone: string;
  localTime: string;
  policy: LossPreventionRolePolicy | null;
  requiredActions: CheckoutApprovalAction[];
  violations: CheckoutLossPreventionViolation[];
}

function roundPolicyNumber(value: number): number {
  // Audit evidence may be rounded for a stable JSON payload, but retain
  // enough precision that a real positive discount never appears as zero.
  return Number(value.toFixed(6));
}

export function checkoutDiscountPercent(
  items: Pick<CheckoutApprovalItem, 'quantity' | 'unitPrice'>[],
  discountAmount: number
): number {
  const gross = items.reduce(
    (sum, item) => roundMoney(sum + roundMoney(item.quantity * item.unitPrice)),
    0
  );
  if (gross <= 0 || discountAmount <= 0) return 0;
  // Keep the authoritative comparison at full precision. Rounding the ratio
  // here can collapse a real positive discount to the zero-percent default
  // threshold on a large checkout and bypass the approval requirement.
  return Math.min(100, Math.max(0, (discountAmount / gross) * 100));
}

export function isTimeInsideBlockedWindow(
  localTime: string,
  blockedFrom: string,
  blockedUntil: string
): boolean {
  if (blockedFrom === blockedUntil) return false;
  if (blockedFrom < blockedUntil) {
    return localTime >= blockedFrom && localTime < blockedUntil;
  }
  return localTime >= blockedFrom || localTime < blockedUntil;
}

function localTimeAt(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const read = (type: 'hour' | 'minute') => {
    const value = parts.find(part => part.type === type)?.value;
    if (!value) throw new Error(`Unable to resolve ${type} in ${timeZone}`);
    return value;
  };
  return `${read('hour')}:${read('minute')}`;
}

function policyRole(role: UserRole): LossPreventionRole | null {
  return role === 'cashier' || role === 'manager' ? role : null;
}

/** ENG-142a — deterministic checkout policy evaluated by the local authority. */
export async function evaluateCheckoutLossPrevention(args: {
  db: DatabaseInstance;
  tenantId: string;
  role: UserRole;
  isCompletion: boolean;
  items: CheckoutApprovalItem[];
  discountAmount: number;
  nowIso?: string | undefined;
}): Promise<CheckoutLossPreventionEvaluation> {
  const [settings, locale] = await Promise.all([
    resolveLossPreventionSettings(args.db, args.tenantId),
    resolveTenantLocale(args.db, args.tenantId),
  ]);
  const nowIso = args.nowIso ?? new Date().toISOString();
  const localTime = localTimeAt(nowIso, locale.timezone);
  const roleKey = policyRole(args.role);
  const policy = roleKey ? settings.roles[roleKey] : null;
  const violations: CheckoutLossPreventionViolation[] = [];

  if (policy && args.isCompletion) {
    const observedPercent = checkoutDiscountPercent(args.items, args.discountAmount);
    if (observedPercent > policy.maxDiscountPercent) {
      violations.push({
        kind: 'max_discount',
        action: 'sale_discount',
        observedPercent: roundPolicyNumber(observedPercent),
        thresholdPercent: policy.maxDiscountPercent,
      });
    }
    const discountAmount = roundMoney(Math.max(0, args.discountAmount));
    if (policy.dualApproval.enabled && discountAmount > policy.dualApproval.thresholdAmount) {
      violations.push({
        kind: 'dual_approval_threshold',
        action: 'sale_discount',
        observedAmount: discountAmount,
        thresholdAmount: policy.dualApproval.thresholdAmount,
      });
    }
    if (
      policy.afterHoursSale.enabled &&
      isTimeInsideBlockedWindow(
        localTime,
        policy.afterHoursSale.blockedFrom,
        policy.afterHoursSale.blockedUntil
      )
    ) {
      violations.push({
        kind: 'after_hours_sale',
        action: 'sale_after_hours',
        localTime,
        blockedFrom: policy.afterHoursSale.blockedFrom,
        blockedUntil: policy.afterHoursSale.blockedUntil,
      });
    }
  }

  return {
    role: args.role,
    timeZone: locale.timezone,
    localTime,
    policy,
    requiredActions: [...new Set(violations.map(violation => violation.action))],
    violations,
  };
}

/** Every real checkout attempt that hits a rule leaves privacy-safe evidence. */
export function recordCheckoutLossPreventionTriggers(args: {
  db: DatabaseInstance;
  tenantId: string;
  actorId: string;
  siteId: string;
  checkoutResourceId: string;
  mode: 'fresh' | 'fromDraft';
  evaluation: CheckoutLossPreventionEvaluation;
  providedActions: readonly CheckoutApprovalAction[];
  operationId?: string | null | undefined;
}): void {
  if (args.evaluation.violations.length === 0) return;
  const provided = new Set(args.providedActions);
  args.db.transaction(tx => {
    for (const violation of args.evaluation.violations) {
      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: 'loss_prevention.triggered',
        resourceType: 'loss_prevention_rule',
        resourceId: violation.kind,
        after: {
          requiredAction: violation.action,
          approvalProvided: provided.has(violation.action),
        },
        metadata: {
          siteId: args.siteId,
          checkoutResourceId: args.checkoutResourceId,
          checkoutMode: args.mode,
          role: args.evaluation.role,
          timeZone: args.evaluation.timeZone,
          ...violation,
        },
        operationId: args.operationId,
      });
    }
  });
}
