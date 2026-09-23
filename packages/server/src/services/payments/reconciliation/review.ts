/** Atomic human review of a durable AI payment recommendation. */
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { DatabaseInstance } from '../../../db/index.js';
import { paymentOutbox, paymentReconciliationProposals } from '../../../db/schema.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { writeAuditLog } from '../../audit-logs.js';
import { isProposableCandidate, statementKey } from './proposals.js';

/** A second submission of the same decision returns without another write or audit row. */
export function reviewPaymentProposal(
  db: DatabaseInstance,
  tenantId: string,
  actorId: string,
  proposalId: string,
  decision: 'approve' | 'reject'
): { proposalId: string; status: 'approved' | 'rejected' } {
  return db.transaction(tx => {
    const proposal = tx
      .select()
      .from(paymentReconciliationProposals)
      .where(
        and(
          eq(paymentReconciliationProposals.tenantId, tenantId),
          eq(paymentReconciliationProposals.id, proposalId)
        )
      )
      .get();
    if (!proposal) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'PAYMENT_PROPOSAL_NOT_FOUND',
        message: 'Payment proposal not found for this tenant',
      });
    }
    const desired = decision === 'approve' ? 'approved' : 'rejected';
    if (proposal.status === desired) return { proposalId, status: desired };
    if (proposal.status !== 'pending') {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PAYMENT_PROPOSAL_NOT_PENDING',
        message: 'Payment proposal was already reviewed with a different decision',
      });
    }

    const reviewedAt = new Date().toISOString();
    if (decision === 'reject') {
      const updated = tx
        .update(paymentReconciliationProposals)
        .set({ status: 'rejected', reviewedAt, reviewedBy: actorId })
        .where(
          and(
            eq(paymentReconciliationProposals.tenantId, tenantId),
            eq(paymentReconciliationProposals.id, proposalId),
            eq(paymentReconciliationProposals.status, 'pending')
          )
        )
        .run();
      if (updated.changes !== 1) staleProposal();
      writeAuditLog({
        tx,
        tenantId,
        actorId,
        action: 'payment.proposal_rejected',
        resourceType: 'payment_reconciliation_proposal',
        resourceId: proposalId,
        before: { status: 'pending' },
        after: { status: 'rejected', reviewedAt },
        metadata: { selectedOutboxId: proposal.selectedOutboxId },
      });
      return { proposalId, status: 'rejected' };
    }

    const evidence = proposal.evidence;
    const statement = evidence.statement;
    const selected = evidence.candidates.find(
      candidate => candidate.outboxId === proposal.selectedOutboxId
    );
    if (
      !selected ||
      evidence.recommendedOutboxId !== proposal.selectedOutboxId ||
      statement.status !== 'settled' ||
      statement.railId !== proposal.railId ||
      statementKey(statement) !== proposal.statementKey ||
      statement.providerTransactionId.trim().length === 0
    ) {
      staleProposal();
    }
    const outbox = tx
      .select()
      .from(paymentOutbox)
      .where(
        and(eq(paymentOutbox.tenantId, tenantId), eq(paymentOutbox.id, proposal.selectedOutboxId))
      )
      .get();
    if (
      !outbox ||
      !isProposableCandidate(outbox, statement) ||
      outbox.salePaymentId !== selected.salePaymentId ||
      outbox.reference !== selected.reference ||
      outbox.providerTransactionId !== selected.providerTransactionId ||
      outbox.createdAt !== selected.createdAt ||
      outbox.amount !== selected.amount ||
      outbox.currencyCode !== selected.currencyCode
    ) {
      staleProposal();
    }
    const priorSettlement = tx
      .select({ id: paymentOutbox.id })
      .from(paymentOutbox)
      .where(
        and(
          eq(paymentOutbox.tenantId, tenantId),
          eq(paymentOutbox.railId, proposal.railId),
          eq(paymentOutbox.providerTransactionId, statement.providerTransactionId),
          eq(paymentOutbox.status, 'settled'),
          ne(paymentOutbox.id, outbox.id)
        )
      )
      .get();
    if (priorSettlement) staleProposal();

    const outboxWrite = tx
      .update(paymentOutbox)
      .set({
        status: 'settled',
        providerTransactionId: statement.providerTransactionId,
        claimToken: null,
        lockedAt: null,
        updatedAt: reviewedAt,
      })
      .where(
        and(
          eq(paymentOutbox.tenantId, tenantId),
          eq(paymentOutbox.id, outbox.id),
          eq(paymentOutbox.status, 'approved'),
          isNull(paymentOutbox.claimToken),
          isNull(paymentOutbox.lockedAt)
        )
      )
      .run();
    if (outboxWrite.changes !== 1) staleProposal();
    const proposalWrite = tx
      .update(paymentReconciliationProposals)
      .set({ status: 'approved', reviewedAt, reviewedBy: actorId })
      .where(
        and(
          eq(paymentReconciliationProposals.tenantId, tenantId),
          eq(paymentReconciliationProposals.id, proposalId),
          eq(paymentReconciliationProposals.status, 'pending')
        )
      )
      .run();
    if (proposalWrite.changes !== 1) staleProposal();

    writeAuditLog({
      tx,
      tenantId,
      actorId,
      action: 'payment.mark_settled',
      resourceType: 'payment_outbox',
      resourceId: outbox.id,
      before: { status: outbox.status, providerTransactionId: outbox.providerTransactionId },
      after: { status: 'settled', providerTransactionId: statement.providerTransactionId },
      metadata: { railId: outbox.railId, proposalId, source: 'human_ai_proposal_review' },
    });
    writeAuditLog({
      tx,
      tenantId,
      actorId,
      action: 'payment.proposal_approved',
      resourceType: 'payment_reconciliation_proposal',
      resourceId: proposalId,
      before: { status: 'pending' },
      after: { status: 'approved', reviewedAt },
      metadata: { selectedOutboxId: outbox.id, aiAuditLogId: evidence.aiAuditLogId },
    });
    return { proposalId, status: 'approved' };
  });
}

function staleProposal(): never {
  return throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'PAYMENT_PROPOSAL_STALE',
    message: 'Payment proposal evidence no longer matches the current outbox row',
  });
}
