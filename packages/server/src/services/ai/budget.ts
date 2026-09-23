/** Durable, tenant-wide admission for remote AI calls. */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import { aiAuditLog, aiBudgetReservations, tenants } from '../../db/schema.js';
import type { NewAIAuditLogRow } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { assertCopilotQuotasForSites, assertInvoiceOcrQuotaForSite } from './quotas.js';

export interface AiBudgetReservation {
  id: string;
  tenantId: string;
}

export interface AiBudgetAdmissionOptions {
  /** Check every site that the pending Copilot snapshot may read under the same write lock. */
  copilotSiteIds?: string[];
  /** Recheck the active invoice OCR site and its quota inside the writer lock. */
  invoiceOcrSiteId?: string;
  /** Lower bound known before dispatch, e.g. one Textract page. */
  minimumKnownCostUsd?: number;
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
      if (options.invoiceOcrSiteId !== undefined) {
        const features = (ai.features ?? {}) as Record<string, unknown>;
        const invoiceOcr = (features.invoiceOcr ?? {}) as Record<string, unknown>;
        if (invoiceOcr.enabled !== true) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'AI_DISABLED',
            message: 'Invoice OCR is disabled for this tenant',
          });
        }
        // Provider selection can change after the router's fast read. Only
        // the Textract implementation owns this paid admission path.
        if (invoiceOcr.provider !== undefined && invoiceOcr.provider !== 'textract') {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'AI_PROVIDER_ERROR',
            message: 'Textract is no longer the selected invoice OCR provider',
          });
        }
      }
      const minimumKnownCost = options.minimumKnownCostUsd ?? 0;
      if (!Number.isFinite(minimumKnownCost) || minimumKnownCost < 0) {
        denyBudget('AI call has an invalid minimum estimated cost');
      }
      const budget = ai.monthlyBudgetUsd;
      if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) {
        denyBudget('AI monthly budget is zero');
      }

      const existing = tx
        .select({ id: aiBudgetReservations.id })
        .from(aiBudgetReservations)
        .where(
          and(
            eq(aiBudgetReservations.tenantId, tenantId),
            eq(aiBudgetReservations.monthStart, month.start)
          )
        )
        .get();
      if (existing) {
        denyBudget('AI monthly budget is reserved by an in-flight or unreconciled call');
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
      if (
        Number(summary?.unknownCalls ?? 0) > 0 ||
        spent >= budget ||
        spent + minimumKnownCost > budget + 1e-9
      ) {
        denyBudget(`AI monthly budget unavailable ($${spent.toFixed(4)} of $${budget.toFixed(2)})`);
      }

      if (options.copilotSiteIds !== undefined) {
        assertCopilotQuotasForSites({ db: tx, tenantId, siteIds: options.copilotSiteIds, now });
      }
      if (options.invoiceOcrSiteId !== undefined) {
        assertInvoiceOcrQuotaForSite({ db: tx, tenantId, siteId: options.invoiceOcrSiteId, now });
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
