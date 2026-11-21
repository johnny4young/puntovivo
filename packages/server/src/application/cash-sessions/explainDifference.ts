import { and, eq } from 'drizzle-orm';

import { cashSessions, type CashDifferenceReason } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { DAY_CLOSE_BALANCED_EPSILON } from '../../services/reports/day-close.js';
import type { CashSessionContext } from './types.js';

export interface ExplainCashDifferenceInput {
  sessionId: string;
  reason: CashDifferenceReason;
  note?: string | null | undefined;
}

/** Record why a closed drawer did not balance. Explaining again replaces the reason. */
export function explainCashDifference(ctx: CashSessionContext, input: ExplainCashDifferenceInput) {
  const note = input.note?.trim() || null;
  const explainedAt = new Date().toISOString();

  return ctx.db.transaction(
    tx => {
      const session = tx
        .select()
        .from(cashSessions)
        .where(and(eq(cashSessions.id, input.sessionId), eq(cashSessions.tenantId, ctx.tenantId)))
        .get();
      if (
        !session ||
        session.status !== 'closed' ||
        Math.abs(session.overShort ?? 0) <= DAY_CLOSE_BALANCED_EPSILON
      ) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'CASH_DIFFERENCE_NOT_EXPLAINABLE',
          message: 'Only a closed register with a difference can be explained',
          details: { sessionId: input.sessionId },
        });
      }

      tx.update(cashSessions)
        .set({
          differenceReason: input.reason,
          differenceNote: note,
          differenceExplainedBy: ctx.user.id,
          differenceExplainedAt: explainedAt,
          updatedAt: explainedAt,
        })
        .where(and(eq(cashSessions.id, session.id), eq(cashSessions.tenantId, ctx.tenantId)))
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'cash_session.explain_difference',
        resourceType: 'cash_session',
        resourceId: session.id,
        before: {
          differenceReason: session.differenceReason,
          differenceNote: session.differenceNote,
        },
        after: { differenceReason: input.reason, differenceNote: note },
        metadata: {
          siteId: session.siteId,
          registerName: session.registerName,
          overShort: session.overShort,
        },
        operationId: ctx.envelope?.operationId,
      });

      return {
        sessionId: session.id,
        overShort: session.overShort,
        differenceReason: input.reason,
        differenceNote: note,
        differenceExplainedBy: ctx.user.id,
        differenceExplainedAt: explainedAt,
      };
    },
    { behavior: 'immediate' }
  );
}
