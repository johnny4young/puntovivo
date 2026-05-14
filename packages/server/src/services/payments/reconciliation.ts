import { and, eq, gte } from 'drizzle-orm';
import {
  paymentOutbox,
  salePayments,
  type PaymentOutboxStatus,
  type PaymentRailId,
} from '../../db/schema.js';
import type { DatabaseInstance } from '../../db/index.js';
import { PAYMENT_RAIL_IDS } from './manifest.js';
import type { TiebreakContext, TiebreakFn } from './ai-tiebreak.js';

const RECONCILIATION_WINDOW_DAYS = 30;
const AMOUNT_EPSILON = 0.009;
const TIEBREAK_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

const PROVIDER_ISSUE_STATUSES = new Set<PaymentOutboxStatus>([
  'declined',
  'timeout',
  'retrying',
  'dead_letter',
]);

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

type SalePaymentRow = typeof salePayments.$inferSelect;
type PaymentOutboxRow = typeof paymentOutbox.$inferSelect;

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

function isRailCandidateTender(tender: SalePaymentRow): boolean {
  return tender.method === 'card' || tender.method === 'transfer' || tender.method === 'other';
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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

// ============================================================================
// ENG-038c — Reconciliation pass (writes back to payment_outbox).
// ============================================================================

/**
 * One row in an imported provider statement. Mirrors the deterministic
 * fixture under `__fixtures__/payment-statements/`. Live provider workers
 * map their per-API response shapes into this normalized form before
 * handing the batch to `runReconciliationPass`.
 */
export interface StatementRow {
  railId: PaymentRailId;
  reference: string;
  providerTransactionId: string;
  amount: number;
  currencyCode: string;
  status: 'settled' | 'declined' | 'pending';
  settledAt: string;
  fee: number;
}

export type ReconciliationMismatchKind =
  | 'amount_mismatch'
  | 'missing_provider_reference'
  | 'orphan_provider_row'
  | 'provider_issue'
  | 'ambiguous';

export interface ReconciliationPassMismatch {
  kind: ReconciliationMismatchKind;
  railId: PaymentRailId | null;
  paymentOutboxId: string | null;
  salePaymentId: string | null;
  reference: string | null;
  providerTransactionId: string | null;
  amount: number;
  providerAmount: number | null;
  suggestedAction: 'queue_charge' | 'review_provider' | 'adjust_amount' | 'link_tender';
  /** Populated for `ambiguous` mismatches; null otherwise. */
  candidateSalePaymentIds: string[] | null;
}

export interface RunReconciliationPassResult {
  matched: number;
  unmatched: number;
  mismatches: ReconciliationPassMismatch[];
  byKind: Record<ReconciliationMismatchKind, number>;
  tiebreakAttempts: number;
  tiebreakDecided: number;
  tiebreakDegraded: number;
}

export interface RunReconciliationPassOptions {
  /** Optional AI tie-break injected so tests can stub the LLM. */
  aiTiebreak?: TiebreakFn;
  /** Context handed to the tie-break when invoked. */
  aiContext?: TiebreakContext;
  /** Override "now" so tests can stage rows around the cutoff window. */
  now?: Date;
}

/**
 * Walk a batch of provider statement rows and link each to a
 * `payment_outbox` row inside the tenant's reconciliation window.
 *
 * For every statement row:
 *   - Strict pass: match by providerTransactionId then by reference
 *     (both with amount inside `AMOUNT_EPSILON`).
 *   - Fuzzy pass: when no strict hit, scan outbox rows within ±2 days
 *     of the statement timestamp whose amount is inside epsilon. Single
 *     candidate → match. ≥ 2 candidates → AI tie-break (when wired)
 *     or surface as `ambiguous`.
 *   - No candidate → surface as `orphan_provider_row`.
 *
 * Matched outbox rows transition to `status='settled'` and store the
 * provider transaction id. Statement rows whose status is `declined` or
 * `pending` always surface as a `provider_issue` mismatch even when the
 * link found a candidate, so the operator still sees the failure.
 *
 * Side effects are limited to UPDATE statements on `payment_outbox` rows
 * already scoped to `tenantId`. The function never INSERTs new rows —
 * fully decoupling reconciliation from capture.
 */
export async function runReconciliationPass(
  db: DatabaseInstance,
  tenantId: string,
  statementRows: StatementRow[],
  opts: RunReconciliationPassOptions = {}
): Promise<RunReconciliationPassResult> {
  const now = opts.now ?? new Date();
  const sinceIso = new Date(
    now.getTime() - RECONCILIATION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const outboxRows = await db
    .select()
    .from(paymentOutbox)
    .where(
      and(eq(paymentOutbox.tenantId, tenantId), gte(paymentOutbox.createdAt, sinceIso))
    )
    .all();
  const tenders = await db
    .select()
    .from(salePayments)
    .where(and(eq(salePayments.tenantId, tenantId), gte(salePayments.createdAt, sinceIso)))
    .all();
  const outboxSalePaymentIds = new Set(
    outboxRows.flatMap(row => (row.salePaymentId ? [row.salePaymentId] : []))
  );

  const indexedByReference = new Map<string, PaymentOutboxRow[]>();
  const indexedByProviderTxId = new Map<string, PaymentOutboxRow[]>();
  for (const row of outboxRows) {
    if (row.reference) {
      const bucket = indexedByReference.get(row.reference) ?? [];
      bucket.push(row);
      indexedByReference.set(row.reference, bucket);
    }
    if (row.providerTransactionId) {
      const bucket = indexedByProviderTxId.get(row.providerTransactionId) ?? [];
      bucket.push(row);
      indexedByProviderTxId.set(row.providerTransactionId, bucket);
    }
  }

  const matchedOutboxIds = new Set<string>();
  const mismatches: ReconciliationPassMismatch[] = [];
  const byKind: Record<ReconciliationMismatchKind, number> = {
    amount_mismatch: 0,
    missing_provider_reference: 0,
    orphan_provider_row: 0,
    provider_issue: 0,
    ambiguous: 0,
  };

  let matched = 0;
  let tiebreakAttempts = 0;
  let tiebreakDecided = 0;
  let tiebreakDegraded = 0;

  for (const statement of statementRows) {
    // Provider-failure statements never settle a tender even if a row
    // looks like a match — they must surface as `provider_issue` so the
    // operator follows up.
    if (statement.status === 'declined' || statement.status === 'pending') {
      const candidate =
        pickStrictCandidate(
          statement,
          indexedByProviderTxId,
          indexedByReference,
          matchedOutboxIds
        ) ?? null;
      if (candidate) matchedOutboxIds.add(candidate.id);
      mismatches.push({
        kind: 'provider_issue',
        railId: statement.railId,
        paymentOutboxId: candidate?.id ?? null,
        salePaymentId: candidate?.salePaymentId ?? null,
        reference: statement.reference,
        providerTransactionId: statement.providerTransactionId,
        amount: candidate?.amount ?? statement.amount,
        providerAmount: statement.amount,
        suggestedAction: 'review_provider',
        candidateSalePaymentIds: null,
      });
      byKind.provider_issue += 1;
      continue;
    }

    const strict = pickStrictCandidate(
      statement,
      indexedByProviderTxId,
      indexedByReference,
      matchedOutboxIds
    );
    if (strict) {
      const amountDelta = Math.abs(strict.amount - statement.amount);
      if (amountDelta > AMOUNT_EPSILON) {
        mismatches.push({
          kind: 'amount_mismatch',
          railId: strict.railId,
          paymentOutboxId: strict.id,
          salePaymentId: strict.salePaymentId,
          reference: strict.reference,
          providerTransactionId: strict.providerTransactionId,
          amount: strict.amount,
          providerAmount: statement.amount,
          suggestedAction: 'adjust_amount',
          candidateSalePaymentIds: null,
        });
        byKind.amount_mismatch += 1;
        // The outbox row was logically reconciled (we found the
        // counterpart) — only the amount is off. Skip the trailing
        // sweep so the same physical row never double-counts as
        // `missing_provider_reference` with a different suggestedAction.
        matchedOutboxIds.add(strict.id);
        continue;
      }
      await settleOutboxRow(db, tenantId, strict.id, statement);
      matchedOutboxIds.add(strict.id);
      matched += 1;
      continue;
    }

    // Fuzzy pass: candidate set is outbox rows in the same rail with
    // amount inside epsilon AND createdAt within TIEBREAK_WINDOW_MS of
    // the statement timestamp.
    const fuzzy = collectFuzzyCandidates(statement, outboxRows, matchedOutboxIds);
    if (fuzzy.length === 0) {
      mismatches.push({
        kind: 'orphan_provider_row',
        railId: statement.railId,
        paymentOutboxId: null,
        salePaymentId: null,
        reference: statement.reference,
        providerTransactionId: statement.providerTransactionId,
        amount: statement.amount,
        providerAmount: statement.amount,
        suggestedAction: 'link_tender',
        candidateSalePaymentIds: null,
      });
      byKind.orphan_provider_row += 1;
      continue;
    }

    if (fuzzy.length === 1) {
      const winner = fuzzy[0]!;
      await settleOutboxRow(db, tenantId, winner.id, statement);
      matchedOutboxIds.add(winner.id);
      matched += 1;
      continue;
    }

    // Multiple candidates — try the AI tie-break if wired.
    if (opts.aiTiebreak && opts.aiContext) {
      tiebreakAttempts += 1;
      const decision = await opts.aiTiebreak(opts.aiContext, {
        statementReference: statement.reference,
        statementAmount: statement.amount,
        statementCurrency: statement.currencyCode,
        statementCreatedAt: statement.settledAt,
        candidates: fuzzy.map(candidate => ({
          salePaymentId: candidate.salePaymentId ?? candidate.id,
          reference: candidate.reference,
          providerTransactionId: candidate.providerTransactionId,
          amount: candidate.amount,
          currencyCode: candidate.currencyCode,
          createdAt: candidate.createdAt,
        })),
      });
      if (decision.ok) {
        const winner = fuzzy.find(
          candidate =>
            candidate.salePaymentId === decision.salePaymentId ||
            candidate.id === decision.salePaymentId
        );
        if (winner) {
          await settleOutboxRow(db, tenantId, winner.id, statement);
          matchedOutboxIds.add(winner.id);
          matched += 1;
          tiebreakDecided += 1;
          continue;
        }
      } else {
        tiebreakDegraded += 1;
      }
    }

    mismatches.push({
      kind: 'ambiguous',
      railId: statement.railId,
      paymentOutboxId: null,
      salePaymentId: null,
      reference: statement.reference,
      providerTransactionId: statement.providerTransactionId,
      amount: statement.amount,
      providerAmount: statement.amount,
      suggestedAction: 'review_provider',
      candidateSalePaymentIds: fuzzy.map(candidate => candidate.salePaymentId ?? candidate.id),
    });
    byKind.ambiguous += 1;
  }

  // Surface every captured outbox row that the statement batch did not
  // touch as `missing_provider_reference` — the cashier captured the
  // tender locally but the provider has not settled it inside the window.
  for (const row of outboxRows) {
    if (matchedOutboxIds.has(row.id)) continue;
    if (row.status === 'settled' || row.status === 'dead_letter') continue;
    if (!row.salePaymentId) continue;
    // Only surface "captured but not yet settled" once per outbox row.
    mismatches.push({
      kind: 'missing_provider_reference',
      railId: row.railId,
      paymentOutboxId: row.id,
      salePaymentId: row.salePaymentId,
      reference: row.reference,
      providerTransactionId: row.providerTransactionId,
      amount: row.amount,
      providerAmount: null,
      suggestedAction: 'queue_charge',
      candidateSalePaymentIds: null,
    });
    byKind.missing_provider_reference += 1;
  }

  for (const tender of tenders) {
    if (!isRailCandidateTender(tender)) continue;
    if (outboxSalePaymentIds.has(tender.id)) continue;
    mismatches.push({
      kind: 'missing_provider_reference',
      railId: null,
      paymentOutboxId: null,
      salePaymentId: tender.id,
      reference: tender.reference,
      providerTransactionId: null,
      amount: tender.amount,
      providerAmount: null,
      suggestedAction: 'queue_charge',
      candidateSalePaymentIds: null,
    });
    byKind.missing_provider_reference += 1;
  }

  const unmatched = mismatches.length;
  return {
    matched,
    unmatched,
    mismatches,
    byKind,
    tiebreakAttempts,
    tiebreakDecided,
    tiebreakDegraded,
  };
}

function pickStrictCandidate(
  statement: StatementRow,
  byProviderTxId: Map<string, PaymentOutboxRow[]>,
  byReference: Map<string, PaymentOutboxRow[]>,
  alreadyMatched: Set<string>
): PaymentOutboxRow | null {
  // providerTransactionId is the strongest deterministic signal — once
  // a rail returns it on charge capture, future settlement statements
  // echo it verbatim.
  const fromTxId = filterStrictCandidates(
    statement,
    byProviderTxId.get(statement.providerTransactionId) ?? [],
    alreadyMatched
  );
  if (fromTxId.length === 1) return fromTxId[0]!;
  const fromReference = filterStrictCandidates(
    statement,
    byReference.get(statement.reference) ?? [],
    alreadyMatched
  );
  if (fromReference.length === 1) return fromReference[0]!;
  return null;
}

function filterStrictCandidates(
  statement: StatementRow,
  rows: PaymentOutboxRow[],
  alreadyMatched: Set<string>
): PaymentOutboxRow[] {
  return rows.filter(row => row.railId === statement.railId && !alreadyMatched.has(row.id));
}

function collectFuzzyCandidates(
  statement: StatementRow,
  outboxRows: PaymentOutboxRow[],
  alreadyMatched: Set<string>
): PaymentOutboxRow[] {
  const statementMs = Date.parse(statement.settledAt);
  if (!Number.isFinite(statementMs)) return [];
  return outboxRows.filter(row => {
    if (alreadyMatched.has(row.id)) return false;
    if (row.railId !== statement.railId) return false;
    if (Math.abs(row.amount - statement.amount) > AMOUNT_EPSILON) return false;
    const rowMs = Date.parse(row.createdAt);
    if (!Number.isFinite(rowMs)) return false;
    return Math.abs(rowMs - statementMs) <= TIEBREAK_WINDOW_MS;
  });
}

async function settleOutboxRow(
  db: DatabaseInstance,
  tenantId: string,
  outboxId: string,
  statement: StatementRow
): Promise<void> {
  await db
    .update(paymentOutbox)
    .set({
      status: 'settled',
      providerTransactionId: statement.providerTransactionId,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(paymentOutbox.id, outboxId), eq(paymentOutbox.tenantId, tenantId)));
}
