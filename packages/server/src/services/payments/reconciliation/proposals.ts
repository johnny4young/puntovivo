/**
 * Durable evidence boundary for AI-assisted reconciliation. A recommendation
 * is not a payment state transition; only an admin review mutation can settle.
 *
 * @module services/payments/reconciliation/proposals
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../../db/index.js';
import {
  paymentOutbox,
  paymentReconciliationProposals,
  type PaymentProposalEvidence,
  type PaymentReconciliationProposal,
} from '../../../db/schema.js';
import type { TiebreakResult } from '../ai-tiebreak.js';
import type { PaymentOutboxRow } from './types.js';
import type { StatementRow } from './pass.js';
import { AMOUNT_EPSILON } from './constants.js';

/** Stable exact-row fingerprint, scoped again by tenant and rail in the unique index. */
export function statementKey(statement: StatementRow): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        statement.railId,
        statement.reference,
        statement.providerTransactionId,
        statement.amount,
        statement.currencyCode,
        statement.status,
        statement.settledAt,
        statement.fee,
      ])
    )
    .digest('hex');
}

/** Only an unclaimed approved charge with matching money can be proposed. */
export function isProposableCandidate(row: PaymentOutboxRow, statement: StatementRow): boolean {
  return (
    statement.status === 'settled' &&
    statement.providerTransactionId.trim().length > 0 &&
    row.kind === 'charge' &&
    row.status === 'approved' &&
    row.claimToken === null &&
    row.lockedAt === null &&
    row.railId === statement.railId &&
    row.currencyCode === statement.currencyCode &&
    Math.abs(row.amount - statement.amount) <= AMOUNT_EPSILON &&
    (row.providerTransactionId === null ||
      row.providerTransactionId === statement.providerTransactionId)
  );
}

/** Store immutable model evidence before the worker advances its import marker. */
export async function savePaymentProposal(
  db: DatabaseInstance,
  tenantId: string,
  statement: StatementRow,
  candidates: PaymentOutboxRow[],
  winner: PaymentOutboxRow,
  decision: Extract<TiebreakResult, { ok: true }>
): Promise<PaymentReconciliationProposal | null> {
  if (!isProposableCandidate(winner, statement)) return null;

  const evidence: PaymentProposalEvidence = {
    statement: { ...statement, status: 'settled' },
    candidates: candidates.map(row => ({
      outboxId: row.id,
      salePaymentId: row.salePaymentId,
      reference: row.reference,
      providerTransactionId: row.providerTransactionId,
      amount: row.amount,
      currencyCode: row.currencyCode,
      kind: row.kind,
      status: row.status,
      createdAt: row.createdAt,
    })),
    recommendedOutboxId: winner.id,
    confidence: decision.confidence,
    explanation: decision.explanation,
    aiAuditLogId: decision.auditLogId,
  };
  const key = statementKey(statement);

  // The model call awaited outside SQLite's synchronous transaction. Re-read
  // every candidate under the write lock before persisting evidence; otherwise
  // an import cursor could advance past a recommendation that was stale before
  // it was even saved. A failed insert also aborts the pass and preserves the
  // worker's import marker for replay.
  return db.transaction(tx => {
    const currentRows = tx
      .select()
      .from(paymentOutbox)
      .where(
        and(
          eq(paymentOutbox.tenantId, tenantId),
          inArray(
            paymentOutbox.id,
            candidates.map(row => row.id)
          )
        )
      )
      .all();
    const currentById = new Map(currentRows.map(row => [row.id, row]));
    for (const snapshot of candidates) {
      const current = currentById.get(snapshot.id);
      if (
        !current ||
        current.tenantId !== tenantId ||
        current.railId !== snapshot.railId ||
        current.kind !== snapshot.kind ||
        current.status !== snapshot.status ||
        current.salePaymentId !== snapshot.salePaymentId ||
        current.reference !== snapshot.reference ||
        current.providerTransactionId !== snapshot.providerTransactionId ||
        current.amount !== snapshot.amount ||
        current.currencyCode !== snapshot.currencyCode ||
        current.createdAt !== snapshot.createdAt ||
        current.claimToken !== snapshot.claimToken ||
        current.lockedAt !== snapshot.lockedAt
      ) {
        throw new Error('Payment reconciliation candidates changed during AI review');
      }
    }
    const currentWinner = currentById.get(winner.id);
    if (!currentWinner || !isProposableCandidate(currentWinner, statement)) {
      throw new Error('Payment reconciliation winner changed during AI review');
    }
    const duplicateSettlement = tx
      .select({ id: paymentOutbox.id })
      .from(paymentOutbox)
      .where(
        and(
          eq(paymentOutbox.tenantId, tenantId),
          eq(paymentOutbox.railId, statement.railId),
          eq(paymentOutbox.status, 'settled'),
          eq(paymentOutbox.providerTransactionId, statement.providerTransactionId),
          ne(paymentOutbox.id, winner.id)
        )
      )
      .get();
    if (duplicateSettlement) {
      throw new Error('Payment provider transaction is already settled');
    }
    const inserted = tx
      .insert(paymentReconciliationProposals)
      .values({
        id: nanoid(),
        tenantId,
        railId: statement.railId,
        statementKey: key,
        selectedOutboxId: winner.id,
        evidence,
      })
      .onConflictDoNothing()
      .run();
    const proposal = tx
      .select()
      .from(paymentReconciliationProposals)
      .where(
        and(
          eq(paymentReconciliationProposals.tenantId, tenantId),
          eq(paymentReconciliationProposals.railId, statement.railId),
          eq(paymentReconciliationProposals.statementKey, key)
        )
      )
      .get();
    if (!proposal || (inserted.changes === 0 && proposal.selectedOutboxId !== winner.id)) {
      // The partial unique index forbids two pending statements for one
      // outbox. Never swallow that conflict and then advance the import cursor.
      throw new Error('Payment reconciliation proposal conflicts with a pending candidate');
    }
    return proposal;
  });
}
