/** Durable, tenant-wide admission for remote AI calls. */
import { and, asc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import { aiAuditLog, aiBudgetReservations, tenants } from '../../db/schema.js';
import type { NewAIAuditLogRow } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../audit-logs.js';
import { assertCopilotQuotasForSites } from './quotas.js';

/**
 * No live call keeps an admission pending this long: every dispatch is
 * bounded by a 60 s provider deadline and settles in the same process. A
 * pending row older than this was orphaned by a crash or restart.
 */
export const AI_BUDGET_PENDING_TTL_MS = 10 * 60 * 1000;

/** Audit feature label for a liability recovered from an orphaned admission. */
export const AI_BUDGET_ORPHAN_FEATURE = 'budgetHoldRecovery';

/** Tenant-bound handle; only its pending admission may be settled once. */
export interface AiBudgetReservation {
  id: string;
  tenantId: string;
}

export interface AiBudgetAdmissionOptions {
  /** Check every site that the pending Copilot snapshot may read under the same write lock. */
  copilotSiteIds?: string[];
}

type CallAudit = Omit<NewAIAuditLogRow, 'id' | 'createdAt'> & {
  costState: NonNullable<NewAIAuditLogRow['costState']>;
};

function monthWindow(now: Date): { start: string; end: string } {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
  };
}

function denyBudget(message: string): never {
  return throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'AI_BUDGET_EXCEEDED',
    message,
  });
}

function denyBusy(): never {
  return throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'AI_BUDGET_BUSY',
    message: 'Another AI request for this organization is in progress',
  });
}

type WriteTx = Parameters<Parameters<DatabaseInstance['transaction']>[0]>[0];

/**
 * Convert crash-orphaned pending admissions into visible unknown liabilities.
 * The orphaned call may have been dispatched and billed, so the hold is kept
 * (fail-closed) but becomes reconcilable instead of an eternal "in progress".
 */
function expireOrphanedHolds(tx: WriteTx, tenantId: string, now: Date): number {
  const cutoff = new Date(now.getTime() - AI_BUDGET_PENDING_TTL_MS).toISOString();
  const orphaned = tx
    .select({ id: aiBudgetReservations.id, createdAt: aiBudgetReservations.createdAt })
    .from(aiBudgetReservations)
    .where(
      and(
        eq(aiBudgetReservations.tenantId, tenantId),
        eq(aiBudgetReservations.state, 'pending'),
        lte(aiBudgetReservations.createdAt, cutoff)
      )
    )
    .all();
  if (orphaned.length === 0) return 0;
  const tenant = tx
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const ai = ((tenant?.settings ?? {}) as Record<string, unknown>).ai as
    Record<string, unknown> | undefined;
  const providerId = typeof ai?.providerId === 'string' ? ai.providerId : 'unknown';
  for (const row of orphaned) {
    const auditLogId = nanoid();
    tx.insert(aiAuditLog)
      .values({
        id: auditLogId,
        tenantId,
        siteId: null,
        userId: null,
        feature: AI_BUDGET_ORPHAN_FEATURE,
        providerId,
        modelId: 'unknown',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        costState: 'unknown',
        durationMs: Math.max(0, now.getTime() - Date.parse(row.createdAt)),
        errorCode: 'AI_PROVIDER_ERROR',
        createdAt: row.createdAt,
      })
      .run();
    tx.update(aiBudgetReservations)
      .set({ state: 'unknown', auditLogId })
      .where(and(eq(aiBudgetReservations.id, row.id), eq(aiBudgetReservations.state, 'pending')))
      .run();
  }
  return orphaned.length;
}

/** Recover crash-orphaned admissions for one tenant in their own write transaction. */
export function expireOrphanedAiBudgetHolds(
  db: DatabaseInstance,
  tenantId: string,
  now: Date = new Date()
): number {
  return db.transaction(tx => expireOrphanedHolds(tx, tenantId, now), { behavior: 'immediate' });
}

/**
 * BEGIN IMMEDIATE serializes admission across SQLite connections, not only
 * promises in this process. The reservation is intentionally the tenant's
 * entire remaining monthly allowance: unknown output/billing cannot be
 * represented as a precise per-call USD cap before the provider responds.
 */
export function reserveAiBudget(
  db: DatabaseInstance,
  tenantId: string,
  now: Date = new Date(),
  options: AiBudgetAdmissionOptions = {}
): AiBudgetReservation {
  const month = monthWindow(now);
  // Commit orphan recovery separately: the admission transaction below may
  // deny and roll back, and the recovered liability must survive that.
  expireOrphanedAiBudgetHolds(db, tenantId, now);
  return db.transaction(
    tx => {
      const tenant = tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .get();
      const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
      const ai = (settings.ai ?? {}) as Record<string, unknown>;
      if (ai.enabled !== true) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'AI_DISABLED',
          message: 'AI features are disabled for this tenant',
        });
      }
      const budget = ai.monthlyBudgetUsd;
      if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) {
        denyBudget('AI monthly budget is zero');
      }

      const existing = tx
        .select({ id: aiBudgetReservations.id, state: aiBudgetReservations.state })
        .from(aiBudgetReservations)
        .where(
          and(
            eq(aiBudgetReservations.tenantId, tenantId),
            eq(aiBudgetReservations.monthStart, month.start)
          )
        )
        .get();
      if (existing?.state === 'pending') denyBusy();
      if (existing) {
        denyBudget('AI monthly budget is held by an unreconciled call');
      }

      const summary = tx
        .select({
          knownSpend: sql<
            number | string
          >`COALESCE(SUM(CASE WHEN ${aiAuditLog.costState} <> 'unknown' THEN ${aiAuditLog.costUsd} ELSE 0 END), 0)`,
          unknownCalls: sql<number>`COALESCE(SUM(CASE WHEN ${aiAuditLog.costState} = 'unknown' THEN 1 ELSE 0 END), 0)`,
        })
        .from(aiAuditLog)
        .where(
          and(
            eq(aiAuditLog.tenantId, tenantId),
            gte(aiAuditLog.createdAt, month.start),
            lt(aiAuditLog.createdAt, month.end)
          )
        )
        .get();
      const spent = Number(summary?.knownSpend ?? 0);
      if (Number(summary?.unknownCalls ?? 0) > 0 || spent >= budget) {
        denyBudget(`AI monthly budget unavailable ($${spent.toFixed(4)} of $${budget.toFixed(2)})`);
      }

      if (options.copilotSiteIds !== undefined) {
        assertCopilotQuotasForSites({ db: tx, tenantId, siteIds: options.copilotSiteIds, now });
      }

      const id = nanoid();
      tx.insert(aiBudgetReservations)
        .values({
          id,
          tenantId,
          monthStart: month.start,
          state: 'pending',
          createdAt: now.toISOString(),
        })
        .run();
      return { id, tenantId };
    },
    { behavior: 'immediate' }
  );
}

/** Insert exactly one audit row and settle its admission in the same write tx. */
export function settleAiBudget(
  db: DatabaseInstance,
  reservation: AiBudgetReservation,
  audit: CallAudit,
  uncertainRemoteCost: boolean
): { id: string } {
  return db.transaction(
    tx => {
      const row = tx
        .select({
          id: aiBudgetReservations.id,
          state: aiBudgetReservations.state,
          createdAt: aiBudgetReservations.createdAt,
        })
        .from(aiBudgetReservations)
        .where(
          and(
            eq(aiBudgetReservations.id, reservation.id),
            eq(aiBudgetReservations.tenantId, reservation.tenantId)
          )
        )
        .get();
      if (!row || row.state !== 'pending' || audit.tenantId !== reservation.tenantId) {
        throw new Error('AI budget reservation cannot be settled twice or across tenants');
      }
      const id = nanoid();
      tx.insert(aiAuditLog)
        .values({ ...audit, id, createdAt: row.createdAt })
        .run();
      if (uncertainRemoteCost) {
        tx.update(aiBudgetReservations)
          .set({ state: 'unknown', auditLogId: id })
          .where(eq(aiBudgetReservations.id, reservation.id))
          .run();
      } else {
        tx.delete(aiBudgetReservations).where(eq(aiBudgetReservations.id, reservation.id)).run();
      }
      return { id };
    },
    { behavior: 'immediate' }
  );
}

export interface AiBudgetReconciliation {
  monthStart: string;
  reconciledCalls: number;
  releasedReservation: boolean;
  costUsd: number;
}

/**
 * Admin recovery for unknown-cost liabilities in the current month.
 *
 * The operator enters the amount the provider actually billed for every
 * unreconciled call of the month (from the provider invoice or console).
 * The total is booked on the oldest unknown row, the remaining unknown rows
 * are booked at zero, all become `estimated`, and the month's hold is
 * released. A live (non-orphaned) admission is never touched. The tenant
 * audit chain records the amount, note and affected AI audit rows. A repeat
 * submission with nothing left to reconcile is a no-op.
 */
export function reconcileAiBudgetHold(
  db: DatabaseInstance,
  args: { tenantId: string; actorId: string; costUsd: number; note: string; now?: Date }
): AiBudgetReconciliation {
  const now = args.now ?? new Date();
  const month = monthWindow(now);
  const note = args.note.trim();
  if (!Number.isFinite(args.costUsd) || args.costUsd < 0 || note.length === 0) {
    throw new Error('AI budget reconciliation requires a non-negative cost and a note');
  }
  return db.transaction(
    tx => {
      expireOrphanedHolds(tx, args.tenantId, now);
      const reservation = tx
        .select({ id: aiBudgetReservations.id, state: aiBudgetReservations.state })
        .from(aiBudgetReservations)
        .where(
          and(
            eq(aiBudgetReservations.tenantId, args.tenantId),
            eq(aiBudgetReservations.monthStart, month.start)
          )
        )
        .get();
      if (reservation?.state === 'pending') denyBusy();
      const unknownRows = tx
        .select({ id: aiAuditLog.id })
        .from(aiAuditLog)
        .where(
          and(
            eq(aiAuditLog.tenantId, args.tenantId),
            eq(aiAuditLog.costState, 'unknown'),
            gte(aiAuditLog.createdAt, month.start),
            lt(aiAuditLog.createdAt, month.end)
          )
        )
        .orderBy(asc(aiAuditLog.createdAt), asc(aiAuditLog.id))
        .all();
      if (!reservation && unknownRows.length === 0) {
        return {
          monthStart: month.start,
          reconciledCalls: 0,
          releasedReservation: false,
          costUsd: 0,
        };
      }
      unknownRows.forEach((row, index) => {
        tx.update(aiAuditLog)
          .set({ costState: 'estimated', costUsd: index === 0 ? args.costUsd : 0 })
          .where(and(eq(aiAuditLog.id, row.id), eq(aiAuditLog.tenantId, args.tenantId)))
          .run();
      });
      if (reservation) {
        tx.delete(aiBudgetReservations).where(eq(aiBudgetReservations.id, reservation.id)).run();
      }
      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: 'ai.budget_hold.reconciled',
        resourceType: 'ai_feature',
        resourceId: reservation?.id ?? `ai-budget:${month.start}`,
        before: {
          unknownCalls: unknownRows.length,
          reservationState: reservation?.state ?? null,
        },
        after: { costUsd: args.costUsd, costState: 'estimated', reservationReleased: true },
        metadata: {
          monthStart: month.start,
          aiAuditLogIds: unknownRows.map(row => row.id),
          note,
        },
      });
      return {
        monthStart: month.start,
        reconciledCalls: unknownRows.length,
        releasedReservation: reservation !== undefined,
        costUsd: args.costUsd,
      };
    },
    { behavior: 'immediate' }
  );
}
