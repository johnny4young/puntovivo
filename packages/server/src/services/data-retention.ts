/**
 * tenant-configurable retention for non-authoritative support data.
 *
 * Sales, fiscal documents, inventory, payments, cash sessions, and customer
 * transaction evidence are deliberately outside this policy. Only bounded
 * operational evidence is swept: ordinary audit rows, longer-lived privacy
 * audit rows, AI usage telemetry, and sync rows already acknowledged as
 * `synced`. Pending/conflict/dead-letter sync work is never deleted.
 *
 * @module services/data-retention
 */

import { and, count, eq, inArray, lt, notInArray } from 'drizzle-orm';

import type { DatabaseInstance } from '../db/index.js';
import { aiAuditLog, auditLogs, syncOutbox, tenants, type AuditLogAction } from '../db/schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const PRIVACY_AUDIT_ACTIONS = [
  'customer.personal_data.export',
  'customer.personal_data.delete',
  'customer.personal_data.anonymize',
] as const satisfies readonly AuditLogAction[];

export interface DataRetentionPolicy {
  /** Ordinary audit evidence. Default/floor preserve at least one year. */
  operationalAuditDays: number;
  /** Privacy-request evidence; never shorter than ordinary audit evidence. */
  privacyAuditDays: number;
  /** Provider/cost/error telemetry only — prompts are not stored here. */
  aiAuditDays: number;
  /** Rows already acknowledged by the sync consumer. */
  syncedOutboxDays: number;
}

export const DATA_RETENTION_LIMITS = {
  operationalAuditDays: { min: 365, max: 3650 },
  privacyAuditDays: { min: 365, max: 3650 },
  aiAuditDays: { min: 30, max: 730 },
  syncedOutboxDays: { min: 7, max: 365 },
} as const satisfies Record<keyof DataRetentionPolicy, { min: number; max: number }>;

export const DEFAULT_DATA_RETENTION_POLICY: DataRetentionPolicy = {
  operationalAuditDays: 1825,
  privacyAuditDays: 1825,
  aiAuditDays: 180,
  syncedOutboxDays: 30,
};

export interface RetentionBucket {
  cutoff: string;
  count: number;
}

export interface DataRetentionPreview {
  policy: DataRetentionPolicy;
  evaluatedAt: string;
  operationalAuditLogs: RetentionBucket;
  privacyAuditLogs: RetentionBucket;
  aiAuditLogs: RetentionBucket;
  syncedOutboxRows: RetentionBucket;
  total: number;
}

export interface DataRetentionSweepResult {
  policy: DataRetentionPolicy;
  evaluatedAt: string;
  deleted: {
    operationalAuditLogs: number;
    privacyAuditLogs: number;
    aiAuditLogs: number;
    syncedOutboxRows: number;
    total: number;
  };
}

export type DataRetentionSweepAudit = (
  tx: DatabaseInstance,
  result: DataRetentionSweepResult
) => void;

function normalizeDays(raw: unknown, key: keyof DataRetentionPolicy): number {
  const limits = DATA_RETENTION_LIMITS[key];
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < limits.min || raw > limits.max) {
    return DEFAULT_DATA_RETENTION_POLICY[key];
  }
  return raw;
}

export function normalizeDataRetentionPolicy(raw: unknown): DataRetentionPolicy {
  const candidate =
    raw !== null && typeof raw === 'object'
      ? (raw as Partial<Record<keyof DataRetentionPolicy, unknown>>)
      : {};
  const operationalAuditDays = normalizeDays(
    candidate.operationalAuditDays,
    'operationalAuditDays'
  );
  return {
    operationalAuditDays,
    privacyAuditDays: Math.max(
      operationalAuditDays,
      normalizeDays(candidate.privacyAuditDays, 'privacyAuditDays')
    ),
    aiAuditDays: normalizeDays(candidate.aiAuditDays, 'aiAuditDays'),
    syncedOutboxDays: normalizeDays(candidate.syncedOutboxDays, 'syncedOutboxDays'),
  };
}

export async function resolveDataRetentionPolicy(
  db: DatabaseInstance,
  tenantId: string
): Promise<DataRetentionPolicy> {
  const tenant = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
  return normalizeDataRetentionPolicy(settings.dataRetention);
}

export function mergeDataRetentionPolicy(
  settings: Record<string, unknown>,
  policy: DataRetentionPolicy
): Record<string, unknown> {
  return {
    ...settings,
    dataRetention: { ...policy },
  };
}

function cutoffIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function readCount(row: { value: number } | undefined): number {
  return row?.value ?? 0;
}

export async function previewDataRetention(
  db: DatabaseInstance,
  tenantId: string,
  now: Date = new Date()
): Promise<DataRetentionPreview> {
  const policy = await resolveDataRetentionPolicy(db, tenantId);
  const evaluatedAt = now.toISOString();
  const operationalCutoff = cutoffIso(now, policy.operationalAuditDays);
  const privacyCutoff = cutoffIso(now, policy.privacyAuditDays);
  const aiCutoff = cutoffIso(now, policy.aiAuditDays);
  const syncCutoff = cutoffIso(now, policy.syncedOutboxDays);

  const operationalAuditCount = readCount(
    db
      .select({ value: count() })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          lt(auditLogs.createdAt, operationalCutoff),
          notInArray(auditLogs.action, [...PRIVACY_AUDIT_ACTIONS])
        )
      )
      .get()
  );
  const privacyAuditCount = readCount(
    db
      .select({ value: count() })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          lt(auditLogs.createdAt, privacyCutoff),
          inArray(auditLogs.action, [...PRIVACY_AUDIT_ACTIONS])
        )
      )
      .get()
  );
  const aiAuditCount = readCount(
    db
      .select({ value: count() })
      .from(aiAuditLog)
      .where(and(eq(aiAuditLog.tenantId, tenantId), lt(aiAuditLog.createdAt, aiCutoff)))
      .get()
  );
  const syncedOutboxCount = readCount(
    db
      .select({ value: count() })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tenantId, tenantId),
          eq(syncOutbox.status, 'synced'),
          lt(syncOutbox.updatedAt, syncCutoff)
        )
      )
      .get()
  );

  return {
    policy,
    evaluatedAt,
    operationalAuditLogs: { cutoff: operationalCutoff, count: operationalAuditCount },
    privacyAuditLogs: { cutoff: privacyCutoff, count: privacyAuditCount },
    aiAuditLogs: { cutoff: aiCutoff, count: aiAuditCount },
    syncedOutboxRows: { cutoff: syncCutoff, count: syncedOutboxCount },
    total: operationalAuditCount + privacyAuditCount + aiAuditCount + syncedOutboxCount,
  };
}

function changes(result: unknown): number {
  return (result as { changes?: number }).changes ?? 0;
}

export async function runDataRetentionSweep(
  db: DatabaseInstance,
  tenantId: string,
  now: Date = new Date(),
  audit?: DataRetentionSweepAudit
): Promise<DataRetentionSweepResult> {
  const preview = await previewDataRetention(db, tenantId, now);
  return db.transaction(tx => {
    const operationalAuditLogs = changes(
      tx
        .delete(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            lt(auditLogs.createdAt, preview.operationalAuditLogs.cutoff),
            notInArray(auditLogs.action, [...PRIVACY_AUDIT_ACTIONS])
          )
        )
        .run()
    );
    const privacyAuditLogs = changes(
      tx
        .delete(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            lt(auditLogs.createdAt, preview.privacyAuditLogs.cutoff),
            inArray(auditLogs.action, [...PRIVACY_AUDIT_ACTIONS])
          )
        )
        .run()
    );
    const aiAuditLogs = changes(
      tx
        .delete(aiAuditLog)
        .where(
          and(
            eq(aiAuditLog.tenantId, tenantId),
            lt(aiAuditLog.createdAt, preview.aiAuditLogs.cutoff)
          )
        )
        .run()
    );
    const syncedOutboxRows = changes(
      tx
        .delete(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, tenantId),
            eq(syncOutbox.status, 'synced'),
            lt(syncOutbox.updatedAt, preview.syncedOutboxRows.cutoff)
          )
        )
        .run()
    );
    const result: DataRetentionSweepResult = {
      policy: preview.policy,
      evaluatedAt: preview.evaluatedAt,
      deleted: {
        operationalAuditLogs,
        privacyAuditLogs,
        aiAuditLogs,
        syncedOutboxRows,
        total: operationalAuditLogs + privacyAuditLogs + aiAuditLogs + syncedOutboxRows,
      },
    };
    // Manual callers attach their audit row here so deletion and evidence
    // either commit together or roll back together. The automatic worker
    // records one global summary after completing all tenant transactions.
    audit?.(tx as DatabaseInstance, result);
    return result;
  });
}

/** Worker input: inactive tenants remain untouched until reactivated. */
export function listRetentionTenantIds(db: DatabaseInstance): string[] {
  return db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.isActive, true))
    .all()
    .map(row => row.id);
}
