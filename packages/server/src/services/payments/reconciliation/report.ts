/**
 * ENG-038 — read-side payment reconciliation report.
 *
 * @module services/payments/reconciliation/report
 */

import { and, eq, gte } from 'drizzle-orm';
import { paymentOutbox, salePayments } from '../../../db/schema.js';
import type { PaymentOutboxStatus, PaymentRailId } from '../../../db/schema.js';
import type { DatabaseInstance } from '../../../db/index.js';
import { roundMoney } from '../../../lib/money.js';
import { PAYMENT_RAIL_IDS } from '../manifest.js';
import {
  AMOUNT_EPSILON,
  PROVIDER_ISSUE_STATUSES,
  RECONCILIATION_WINDOW_DAYS,
} from './constants.js';
import { isRailCandidateTender } from './helpers.js';
import type { PaymentOutboxRow, SalePaymentRow } from './types.js';

type PaymentMismatchType =
  | 'missing_provider_reference'
  | 'provider_issue'
  | 'amount_mismatch'
  | 'orphan_provider_row';

export interface PaymentReconciliationInput {
  limit: number;
}

export interface PaymentReconciliationMismatch {
  type: PaymentMismatchType;
  railId: PaymentRailId | null;
  salePaymentId: string | null;
  paymentOutboxId: string | null;
  reference: string | null;
  providerTransactionId: string | null;
  amount: number;
  providerAmount: number | null;
  status: PaymentOutboxStatus | null;
  createdAt: string;
  suggestedAction: 'queue_charge' | 'review_provider' | 'adjust_amount' | 'link_tender';
}

export interface PaymentReconciliationRailSummary {
  railId: PaymentRailId;
  outboxRows: number;
  amount: number;
  issues: number;
}

export interface PaymentReconciliationResult {
  summary: {
    windowDays: number;
    tendersScanned: number;
    outboxRows: number;
    matched: number;
    mismatches: number;
    missingProviderReferences: number;
    providerIssues: number;
    totalTenderAmount: number;
    unmatchedAmount: number;
  };
  byRail: PaymentReconciliationRailSummary[];
  mismatches: PaymentReconciliationMismatch[];
}

/**
 * ENG-038 — AI-assisted payment reconciliation baseline.
 *
 * This pass is intentionally deterministic: it classifies local POS
 * tenders and provider outbox rows into an operator-readable mismatch
 * list without calling external rails. Later provider workers can feed
 * richer outbox rows into the same read model.
 */
export async function getPaymentReconciliation(
  db: DatabaseInstance,
  tenantId: string,
  input: PaymentReconciliationInput
): Promise<PaymentReconciliationResult> {
  const since = new Date(
    Date.now() - RECONCILIATION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const tenders = await db
    .select()
    .from(salePayments)
    .where(and(eq(salePayments.tenantId, tenantId), gte(salePayments.createdAt, since)))
    .all();
  const rows = await db
    .select()
    .from(paymentOutbox)
    .where(and(eq(paymentOutbox.tenantId, tenantId), gte(paymentOutbox.createdAt, since)))
    .all();

  const rowsBySalePayment = new Map<string, PaymentOutboxRow[]>();
  for (const row of rows) {
    if (!row.salePaymentId) continue;
    const current = rowsBySalePayment.get(row.salePaymentId) ?? [];
    current.push(row);
    rowsBySalePayment.set(row.salePaymentId, current);
  }

  const mismatches: PaymentReconciliationMismatch[] = [];
  const issueRowIds = new Set<string>();
  const railStats = new Map<PaymentRailId, PaymentReconciliationRailSummary>(
    PAYMENT_RAIL_IDS.map(railId => [railId, { railId, outboxRows: 0, amount: 0, issues: 0 }])
  );

  for (const row of rows) {
    const stats = railStats.get(row.railId);
    if (!stats) continue;
    stats.outboxRows += 1;
    stats.amount = roundMoney(stats.amount + row.amount);
    if (PROVIDER_ISSUE_STATUSES.has(row.status)) {
      stats.issues += 1;
      issueRowIds.add(row.id);
    }
  }

  const railCandidateTenders = tenders.filter(isRailCandidateTender);
  for (const tender of railCandidateTenders) {
    const providerRows = rowsBySalePayment.get(tender.id) ?? [];
    if (providerRows.length === 0) {
      mismatches.push(buildMissingProviderReference(tender));
      continue;
    }

    for (const row of providerRows) {
      if (PROVIDER_ISSUE_STATUSES.has(row.status)) {
        mismatches.push(buildProviderIssue(tender, row));
      }

      if (Math.abs(row.amount - tender.amount) > AMOUNT_EPSILON) {
        mismatches.push(buildAmountMismatch(tender, row));
      }
    }
  }

  for (const row of rows) {
    if (row.salePaymentId) continue;
    mismatches.push(buildOrphanProviderRow(row));
  }

  const limitedMismatches = mismatches
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, input.limit);
  const unmatchedAmount = sumReviewAmount(mismatches);

  return {
    summary: {
      windowDays: RECONCILIATION_WINDOW_DAYS,
      tendersScanned: railCandidateTenders.length,
      outboxRows: rows.length,
      matched: railCandidateTenders.filter(tender => rowsBySalePayment.has(tender.id)).length,
      mismatches: mismatches.length,
      missingProviderReferences: mismatches.filter(
        mismatch => mismatch.type === 'missing_provider_reference'
      ).length,
      providerIssues: issueRowIds.size,
      totalTenderAmount: roundMoney(
        railCandidateTenders.reduce((sum, tender) => sum + tender.amount, 0)
      ),
      unmatchedAmount,
    },
    byRail: [...railStats.values()],
    mismatches: limitedMismatches,
  };
}

function buildMissingProviderReference(tender: SalePaymentRow): PaymentReconciliationMismatch {
  return {
    type: 'missing_provider_reference',
    railId: null,
    salePaymentId: tender.id,
    paymentOutboxId: null,
    reference: tender.reference,
    providerTransactionId: null,
    amount: tender.amount,
    providerAmount: null,
    status: null,
    createdAt: tender.createdAt,
    suggestedAction: 'queue_charge',
  };
}

function buildProviderIssue(
  tender: SalePaymentRow,
  row: PaymentOutboxRow
): PaymentReconciliationMismatch {
  return {
    type: 'provider_issue',
    railId: row.railId,
    salePaymentId: tender.id,
    paymentOutboxId: row.id,
    reference: row.reference || tender.reference,
    providerTransactionId: row.providerTransactionId,
    amount: tender.amount,
    providerAmount: row.amount,
    status: row.status,
    createdAt: row.createdAt,
    suggestedAction: 'review_provider',
  };
}

function buildAmountMismatch(
  tender: SalePaymentRow,
  row: PaymentOutboxRow
): PaymentReconciliationMismatch {
  return {
    type: 'amount_mismatch',
    railId: row.railId,
    salePaymentId: tender.id,
    paymentOutboxId: row.id,
    reference: row.reference || tender.reference,
    providerTransactionId: row.providerTransactionId,
    amount: tender.amount,
    providerAmount: row.amount,
    status: row.status,
    createdAt: row.createdAt,
    suggestedAction: 'adjust_amount',
  };
}

function buildOrphanProviderRow(row: PaymentOutboxRow): PaymentReconciliationMismatch {
  return {
    type: 'orphan_provider_row',
    railId: row.railId,
    salePaymentId: null,
    paymentOutboxId: row.id,
    reference: row.reference,
    providerTransactionId: row.providerTransactionId,
    amount: row.amount,
    providerAmount: row.amount,
    status: row.status,
    createdAt: row.createdAt,
    suggestedAction: 'link_tender',
  };
}

function sumReviewAmount(mismatches: PaymentReconciliationMismatch[]): number {
  const seen = new Set<string>();
  let total = 0;

  for (const mismatch of mismatches) {
    const key =
      mismatch.salePaymentId ??
      mismatch.paymentOutboxId ??
      `${mismatch.type}:${mismatch.reference ?? mismatch.providerTransactionId ?? 'unknown'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    total += mismatch.amount;
  }

  return roundMoney(total);
}
