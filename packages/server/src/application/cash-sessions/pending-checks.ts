/**
 * ENG-056 — Pending fiscal/payment checks for the cash-session
 * aggregate.
 *
 * Surfaces two warning categories at close-time and via a dedicated
 * `cashSessions.pendingChecks` query that the close-shift UI calls
 * before invoking close:
 *
 * 1. Pending fiscal documents — `fiscal_documents` rows joined to
 *    `sales` filtered by `cash_session_id`, with `status IN
 *    ('pending', 'contingency')`. These are DEEs/NCs the country
 *    adapter could not finalize at sale-time (typical: PT outage).
 *    Reusing `fiscal_documents.status` rather than the future
 *    `fiscal_outbox` (ENG-057) means coverage today is already correct
 *    for the rows the orchestrator wrote.
 *
 * 2. Pending payment sales — `sales` rows on the session with
 *    `status='completed' AND paymentStatus IN ('pending', 'partial')`.
 *    The `status='completed'` filter is critical: parked drafts and
 *    voided sales may carry `paymentStatus='pending'` for unrelated
 *    reasons and would generate noise.
 *
 * Both queries hit indexed paths (`idx_fiscal_documents_status` +
 * `idx_sales_cash_session`); samples are capped at 5 per category so
 * the response stays small enough for the UI confirm modal.
 *
 * Decision (per ENG-056 plan, Pending semantics): close NEVER blocks
 * on pending state. The counts ride into the audit log metadata
 * (forensic snapshot) and into `pending_warning` journal effects (one
 * per non-zero category). The UI uses this query as a pre-close gate
 * to render a confirmation; the cashier always has the option to
 * proceed.
 *
 * @module application/cash-sessions/pending-checks
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { fiscalDocuments, sales } from '../../db/schema.js';
import type {
  PendingChecksResult,
  PendingFiscalSample,
  PendingPaymentSample,
} from './types.js';

const PENDING_SAMPLE_LIMIT = 5;
const PENDING_FISCAL_STATUSES = ['pending', 'contingency'] as const;
const PENDING_PAYMENT_STATUSES = ['pending', 'partial'] as const;

/**
 * Counts fiscal documents the country adapter has not yet confirmed
 * (`pending` or `contingency`) for sales scoped to the given session.
 *
 * Note: the join through `sales.cashSessionId` means a return whose
 * ORIGINAL sale lived on a different session is NOT counted against
 * the current session — the warning is "pending docs from THIS shift",
 * not "pending docs touching THIS cashier".
 */
export async function getPendingFiscalForSession(
  db: DatabaseInstance,
  tenantId: string,
  sessionId: string
): Promise<{ count: number; samples: PendingFiscalSample[] }> {
  const rows = await db
    .select({
      saleId: sales.id,
      saleNumber: sales.saleNumber,
      fiscalDocumentId: fiscalDocuments.id,
      status: fiscalDocuments.status,
    })
    .from(fiscalDocuments)
    .innerJoin(sales, eq(sales.id, fiscalDocuments.sourceId))
    .where(
      and(
        eq(fiscalDocuments.tenantId, tenantId),
        eq(sales.tenantId, tenantId),
        eq(sales.cashSessionId, sessionId),
        inArray(fiscalDocuments.status, [...PENDING_FISCAL_STATUSES])
      )
    )
    .all();

  return {
    count: rows.length,
    samples: rows.slice(0, PENDING_SAMPLE_LIMIT).map(row => ({
      saleId: row.saleId,
      saleNumber: row.saleNumber,
      fiscalDocumentId: row.fiscalDocumentId,
      status: row.status,
    })),
  };
}

/**
 * Counts completed sales on the session whose payment is still
 * `pending` or `partial`. Excludes drafts and voided sales by
 * filtering on `status='completed'`.
 */
export async function getPendingPaymentForSession(
  db: DatabaseInstance,
  tenantId: string,
  sessionId: string
): Promise<{ count: number; samples: PendingPaymentSample[] }> {
  const rows = await db
    .select({
      saleId: sales.id,
      saleNumber: sales.saleNumber,
      paymentStatus: sales.paymentStatus,
    })
    .from(sales)
    .where(
      and(
        eq(sales.tenantId, tenantId),
        eq(sales.cashSessionId, sessionId),
        eq(sales.status, 'completed'),
        inArray(sales.paymentStatus, [...PENDING_PAYMENT_STATUSES])
      )
    )
    .all();

  return {
    count: rows.length,
    samples: rows.slice(0, PENDING_SAMPLE_LIMIT).map(row => ({
      saleId: row.saleId,
      saleNumber: row.saleNumber,
      paymentStatus: row.paymentStatus,
    })),
  };
}

/**
 * Aggregate both categories. Reused by `closeCashSession` (audit + journal
 * enrichment) and by the new `cashSessions.pendingChecks` tRPC query
 * (UI pre-close gate).
 */
export async function getPendingChecksForSession(
  db: DatabaseInstance,
  tenantId: string,
  sessionId: string
): Promise<PendingChecksResult> {
  const [fiscal, payment] = await Promise.all([
    getPendingFiscalForSession(db, tenantId, sessionId),
    getPendingPaymentForSession(db, tenantId, sessionId),
  ]);

  return {
    pendingFiscalDocuments: fiscal.count,
    pendingPaymentSales: payment.count,
    fiscalSamples: fiscal.samples,
    paymentSamples: payment.samples,
  };
}
