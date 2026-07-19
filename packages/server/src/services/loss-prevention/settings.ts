import { eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { lossPreventionSettings } from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';

export const LOSS_PREVENTION_ROLES = ['cashier', 'manager'] as const;
export type LossPreventionRole = (typeof LOSS_PREVENTION_ROLES)[number];

export interface LossPreventionAfterHoursPolicy {
  enabled: boolean;
  blockedFrom: string;
  blockedUntil: string;
}

export interface LossPreventionShiftValuePolicy {
  enabled: boolean;
  maxCount: number;
  maxAmount: number;
}

export interface LossPreventionNoSalePolicy {
  enabled: boolean;
  maxCount: number;
}

export interface LossPreventionShiftPolicies {
  refunds: LossPreventionShiftValuePolicy;
  voids: LossPreventionShiftValuePolicy;
  noSale: LossPreventionNoSalePolicy;
}

export interface LossPreventionDualApprovalPolicy {
  enabled: boolean;
  thresholdAmount: number;
}

export interface LossPreventionWhatsAppHandoffPolicy {
  enabled: boolean;
  /** E.164-compatible recipient. Persisted normalized, without a leading plus. */
  recipientPhone: string;
}

export interface LossPreventionAlertPolicy {
  whatsappHandoff: LossPreventionWhatsAppHandoffPolicy;
}

export const LOSS_PREVENTION_ALERT_CHANNELS = ['in_app', 'whatsapp_handoff'] as const;
export type LossPreventionAlertChannel = (typeof LOSS_PREVENTION_ALERT_CHANNELS)[number];

export interface LossPreventionRolePolicy {
  maxDiscountPercent: number;
  afterHoursSale: LossPreventionAfterHoursPolicy;
  shift: LossPreventionShiftPolicies;
  dualApproval: LossPreventionDualApprovalPolicy;
}

export interface LossPreventionSettings {
  version: 4;
  roles: Record<LossPreventionRole, LossPreventionRolePolicy>;
  alerts: LossPreventionAlertPolicy;
}

const DEFAULT_AFTER_HOURS_POLICY: LossPreventionAfterHoursPolicy = {
  enabled: false,
  blockedFrom: '22:00',
  blockedUntil: '06:00',
};

const DEFAULT_SHIFT_POLICIES: LossPreventionShiftPolicies = {
  refunds: { enabled: false, maxCount: 0, maxAmount: 0 },
  voids: { enabled: false, maxCount: 0, maxAmount: 0 },
  noSale: { enabled: false, maxCount: 0 },
};

const DEFAULT_DUAL_APPROVAL_POLICY: LossPreventionDualApprovalPolicy = {
  enabled: false,
  thresholdAmount: 0,
};

const DEFAULT_ALERT_POLICY: LossPreventionAlertPolicy = {
  whatsappHandoff: {
    enabled: false,
    recipientPhone: '',
  },
};

export const DEFAULT_LOSS_PREVENTION_SETTINGS: LossPreventionSettings = {
  version: 4,
  roles: {
    // Preserve the pre-ENG-142 authorization baseline: any cashier discount
    // escalates, while managers retain direct authority unless configured.
    cashier: {
      maxDiscountPercent: 0,
      afterHoursSale: { ...DEFAULT_AFTER_HOURS_POLICY },
      shift: structuredClone(DEFAULT_SHIFT_POLICIES),
      dualApproval: { ...DEFAULT_DUAL_APPROVAL_POLICY },
    },
    manager: {
      maxDiscountPercent: 100,
      afterHoursSale: { ...DEFAULT_AFTER_HOURS_POLICY },
      shift: structuredClone(DEFAULT_SHIFT_POLICIES),
      dualApproval: { ...DEFAULT_DUAL_APPROVAL_POLICY },
    },
  },
  alerts: structuredClone(DEFAULT_ALERT_POLICY),
};

const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function normalizeTime(value: unknown, fallback: string): string {
  return typeof value === 'string' && LOCAL_TIME_PATTERN.test(value) ? value : fallback;
}

function normalizeCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1000, Math.trunc(value)))
    : fallback;
}

function normalizeAmount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1_000_000_000_000, roundMoney(value)))
    : fallback;
}

export function normalizeWhatsAppRecipient(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value
    .trim()
    .replace(/[\s().-]/g, '')
    .replace(/^\+/, '');
  return /^[1-9]\d{7,14}$/.test(normalized) ? normalized : '';
}

/** Snapshot routing at trigger time so later settings changes do not rewrite history. */
export function configuredLossPreventionAlertChannels(
  settings: LossPreventionSettings
): LossPreventionAlertChannel[] {
  return [
    'in_app',
    ...(settings.alerts.whatsappHandoff.enabled ? (['whatsapp_handoff'] as const) : []),
  ];
}

function normalizeShiftValuePolicy(
  value: unknown,
  fallback: LossPreventionShiftValuePolicy
): LossPreventionShiftValuePolicy {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    maxCount: normalizeCount(raw.maxCount, fallback.maxCount),
    maxAmount: normalizeAmount(raw.maxAmount, fallback.maxAmount),
  };
}

function normalizeNoSalePolicy(
  value: unknown,
  fallback: LossPreventionNoSalePolicy
): LossPreventionNoSalePolicy {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    maxCount: normalizeCount(raw.maxCount, fallback.maxCount),
  };
}

function normalizeRolePolicy(
  value: unknown,
  fallback: LossPreventionRolePolicy
): LossPreventionRolePolicy {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rawWindow =
    raw.afterHoursSale && typeof raw.afterHoursSale === 'object'
      ? (raw.afterHoursSale as Record<string, unknown>)
      : {};
  const rawShift =
    raw.shift && typeof raw.shift === 'object' ? (raw.shift as Record<string, unknown>) : {};
  const rawDualApproval =
    raw.dualApproval && typeof raw.dualApproval === 'object'
      ? (raw.dualApproval as Record<string, unknown>)
      : {};
  const blockedFrom = normalizeTime(rawWindow.blockedFrom, fallback.afterHoursSale.blockedFrom);
  const blockedUntil = normalizeTime(rawWindow.blockedUntil, fallback.afterHoursSale.blockedUntil);
  const rawDiscount = raw.maxDiscountPercent;
  return {
    maxDiscountPercent:
      typeof rawDiscount === 'number' && Number.isFinite(rawDiscount)
        ? Math.max(0, Math.min(100, rawDiscount))
        : fallback.maxDiscountPercent,
    afterHoursSale: {
      enabled:
        typeof rawWindow.enabled === 'boolean'
          ? rawWindow.enabled && blockedFrom !== blockedUntil
          : fallback.afterHoursSale.enabled,
      blockedFrom,
      blockedUntil,
    },
    shift: {
      refunds: normalizeShiftValuePolicy(rawShift.refunds, fallback.shift.refunds),
      voids: normalizeShiftValuePolicy(rawShift.voids, fallback.shift.voids),
      noSale: normalizeNoSalePolicy(rawShift.noSale, fallback.shift.noSale),
    },
    dualApproval: {
      enabled:
        typeof rawDualApproval.enabled === 'boolean'
          ? rawDualApproval.enabled
          : fallback.dualApproval.enabled,
      thresholdAmount: normalizeAmount(
        rawDualApproval.thresholdAmount,
        fallback.dualApproval.thresholdAmount
      ),
    },
  };
}

export function normalizeLossPreventionSettings(value: unknown): LossPreventionSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const roles = raw.roles && typeof raw.roles === 'object' ? raw.roles : {};
  const roleRecord = roles as Record<string, unknown>;
  const rawAlerts =
    raw.alerts && typeof raw.alerts === 'object' ? (raw.alerts as Record<string, unknown>) : {};
  const rawWhatsApp =
    rawAlerts.whatsappHandoff && typeof rawAlerts.whatsappHandoff === 'object'
      ? (rawAlerts.whatsappHandoff as Record<string, unknown>)
      : {};
  const recipientPhone = normalizeWhatsAppRecipient(rawWhatsApp.recipientPhone);
  return {
    version: 4,
    roles: {
      cashier: normalizeRolePolicy(
        roleRecord.cashier,
        DEFAULT_LOSS_PREVENTION_SETTINGS.roles.cashier
      ),
      manager: normalizeRolePolicy(
        roleRecord.manager,
        DEFAULT_LOSS_PREVENTION_SETTINGS.roles.manager
      ),
    },
    alerts: {
      whatsappHandoff: {
        enabled: rawWhatsApp.enabled === true && recipientPhone.length > 0,
        recipientPhone,
      },
    },
  };
}

const DUAL_APPROVAL_ACTIONS = new Set([
  'sale_discount',
  'sale_after_hours',
  'sale_refund',
  'sale_void',
]);

/** ENG-142c — derive the distinct-approver count from server-owned request evidence. */
export function requiredLossPreventionApprovalCount(args: {
  db: DatabaseInstance;
  tenantId: string;
  role: string;
  action: string;
  amount: number | undefined;
}): 1 | 2 {
  if (
    (args.role !== 'cashier' && args.role !== 'manager') ||
    !DUAL_APPROVAL_ACTIONS.has(args.action) ||
    args.amount === undefined ||
    !Number.isFinite(args.amount)
  ) {
    return 1;
  }
  const policy = resolveLossPreventionSettings(args.db, args.tenantId).roles[args.role]
    .dualApproval;
  return policy.enabled && roundMoney(args.amount) > policy.thresholdAmount ? 2 : 1;
}

function readPersistedPolicy(db: DatabaseInstance, tenantId: string): unknown {
  return db
    .select({ policy: lossPreventionSettings.policy })
    .from(lossPreventionSettings)
    .where(eq(lossPreventionSettings.tenantId, tenantId))
    .get();
}

/** ENG-142a — resolve fail-safe per-role rules from the isolated tenant row. */
export function resolveLossPreventionSettings(
  db: DatabaseInstance,
  tenantId: string
): LossPreventionSettings {
  const persisted = readPersistedPolicy(db, tenantId) as { policy?: unknown } | undefined;
  return normalizeLossPreventionSettings(persisted?.policy);
}

/** Atomically upsert one validated policy row without touching sibling settings. */
export function writeLossPreventionSettings(
  db: DatabaseInstance,
  tenantId: string,
  next: LossPreventionSettings
): LossPreventionSettings {
  const normalized = normalizeLossPreventionSettings(next);
  const persistedPolicy = { ...normalized };
  const updatedAt = new Date().toISOString();
  db.insert(lossPreventionSettings)
    .values({
      tenantId,
      policy: persistedPolicy,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: lossPreventionSettings.tenantId,
      set: { policy: persistedPolicy, updatedAt },
    })
    .run();
  return normalized;
}
