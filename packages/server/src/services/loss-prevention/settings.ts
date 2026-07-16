import { eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { lossPreventionSettings } from '../../db/schema.js';

export const LOSS_PREVENTION_ROLES = ['cashier', 'manager'] as const;
export type LossPreventionRole = (typeof LOSS_PREVENTION_ROLES)[number];

export interface LossPreventionAfterHoursPolicy {
  enabled: boolean;
  blockedFrom: string;
  blockedUntil: string;
}

export interface LossPreventionRolePolicy {
  maxDiscountPercent: number;
  afterHoursSale: LossPreventionAfterHoursPolicy;
}

export interface LossPreventionSettings {
  version: 1;
  roles: Record<LossPreventionRole, LossPreventionRolePolicy>;
}

const DEFAULT_AFTER_HOURS_POLICY: LossPreventionAfterHoursPolicy = {
  enabled: false,
  blockedFrom: '22:00',
  blockedUntil: '06:00',
};

export const DEFAULT_LOSS_PREVENTION_SETTINGS: LossPreventionSettings = {
  version: 1,
  roles: {
    // Preserve the pre-ENG-142 authorization baseline: any cashier discount
    // escalates, while managers retain direct authority unless configured.
    cashier: {
      maxDiscountPercent: 0,
      afterHoursSale: { ...DEFAULT_AFTER_HOURS_POLICY },
    },
    manager: {
      maxDiscountPercent: 100,
      afterHoursSale: { ...DEFAULT_AFTER_HOURS_POLICY },
    },
  },
};

const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function normalizeTime(value: unknown, fallback: string): string {
  return typeof value === 'string' && LOCAL_TIME_PATTERN.test(value) ? value : fallback;
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
  };
}

export function normalizeLossPreventionSettings(value: unknown): LossPreventionSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const roles = raw.roles && typeof raw.roles === 'object' ? raw.roles : {};
  const roleRecord = roles as Record<string, unknown>;
  return {
    version: 1,
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
  };
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
