/**
 * ENG-056 — `recordCashMovement` use-case service.
 *
 * Replaces the inline body that lived at
 * `trpc/routers/cashSessions.ts::recordMovement`. Routes through the
 * shared `insertCashMovement` helper in `services/cash-session.ts`
 * (the broadened version that now accepts the full `CashMovementType`
 * enum and `referenceId: string | null`), eliminating the last
 * direct `cash_movements` INSERT in the codebase.
 *
 * Manual movement types (`paid_in`, `paid_out`, `skim`,
 * `replenishment`) only — `sale` and `refund` flow through the
 * sale-lifecycle use-cases (ENG-054 / ENG-055) and never enter here.
 *
 * Adds `assertCashSessionStillOpen` to the in-tx path so all three
 * shift-lifecycle commands (open / close / recordMovement) have TOCTOU
 * defense parity with the sale-lifecycle services.
 *
 * @module application/cash-sessions/recordCashMovement
 */

import { and, eq } from 'drizzle-orm';
import { cashMovements, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
// throwServerError used for site/session preconditions; the unreachable
// amount-invalid path inside the tx falls through to a plain Error so
// the rollback message is unambiguous.
import {
  assertCashSessionStillOpen,
  getActiveCashSessionForCashier,
  insertCashMovement,
} from '../../services/cash-session.js';
import { createModuleLogger } from '../../logging/logger.js';
import {
  emitCashSessionEffects,
  lookupCashSessionJournalEventId,
  type CashSessionJournalEffectInput,
} from './journal-effects.js';
import type {
  CashSessionContext,
  RecordCashMovementInput,
  RecordCashMovementResult,
} from './types.js';

const fallbackLog = createModuleLogger('application/cash-sessions/recordCashMovement');

export interface RecordedCashMovement {
  id: string;
  tenantId: string;
  sessionId: string;
  type: string;
  amount: number;
  referenceId: string | null;
  note: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export async function recordCashMovement(
  ctx: CashSessionContext,
  input: RecordCashMovementInput
): Promise<RecordCashMovementResult<RecordedCashMovement>> {
  const log = ctx.log ?? fallbackLog;

  if (!ctx.user) {
    throwServerError({
      trpcCode: 'UNAUTHORIZED',
      errorCode: 'CASH_SESSION_REQUIRED',
      message: 'An authenticated user is required to record a cash movement',
    });
  }

  if (!ctx.siteId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_SITE_REQUIRED',
      message: 'An active site is required before recording a cash movement',
    });
  }

  const activeSession = await getActiveCashSessionForCashier(
    ctx.db,
    ctx.tenantId,
    ctx.siteId,
    ctx.user.id
  );

  if (!activeSession) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_REQUIRED',
      message: 'An open cash session is required before recording a cash movement',
    });
  }

  const now = new Date().toISOString();
  let movementId: string | null = null;
  let auditLogId: string | null = null;

  ctx.db.transaction(tx => {
    assertCashSessionStillOpen(tx, ctx.tenantId, activeSession.id);

    movementId = insertCashMovement({
      tx,
      tenantId: ctx.tenantId,
      sessionId: activeSession.id,
      type: input.type,
      amount: input.amount,
      referenceId: null,
      note: input.note,
      createdBy: ctx.user.id,
      createdAt: now,
    });

    if (!movementId) {
      // Unreachable: the Zod schema enforces amount > 0, so
      // insertCashMovement always returns a row id. Throwing inside the
      // tx aborts cleanly if the precondition ever drifts.
      throwServerError({
        trpcCode: 'INTERNAL_SERVER_ERROR',
        errorCode: 'CASH_MOVEMENT_PERSIST_FAILED',
        message: 'insertCashMovement returned null despite amount > 0',
        details: {
          tenantId: ctx.tenantId,
          sessionId: activeSession.id,
          type: input.type,
          amount: input.amount,
          stage: 'insert',
        },
      });
    }

    auditLogId = writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: 'cash_session.movement',
      resourceType: 'cash_movement',
      resourceId: movementId,
      after: {
        sessionId: activeSession.id,
        type: input.type,
        amount: input.amount,
      },
      metadata: {
        siteId: activeSession.siteId,
        registerName: activeSession.registerName,
        note: input.note,
      },
    });
  });

  if (!movementId) {
    throwServerError({
      trpcCode: 'INTERNAL_SERVER_ERROR',
      errorCode: 'CASH_MOVEMENT_PERSIST_FAILED',
      message: 'Failed to record cash movement',
      details: {
        tenantId: ctx.tenantId,
        sessionId: activeSession.id,
        type: input.type,
        amount: input.amount,
        stage: 'post-tx',
      },
    });
  }

  const movement = await ctx.db
    .select({
      id: cashMovements.id,
      tenantId: cashMovements.tenantId,
      sessionId: cashMovements.sessionId,
      type: cashMovements.type,
      amount: cashMovements.amount,
      referenceId: cashMovements.referenceId,
      note: cashMovements.note,
      createdBy: cashMovements.createdBy,
      createdByName: users.name,
      createdAt: cashMovements.createdAt,
    })
    .from(cashMovements)
    .innerJoin(users, eq(cashMovements.createdBy, users.id))
    .where(
      and(
        eq(cashMovements.id, movementId),
        eq(cashMovements.tenantId, ctx.tenantId)
      )
    )
    .get();

  if (!movement) {
    throwServerError({
      trpcCode: 'INTERNAL_SERVER_ERROR',
      errorCode: 'CASH_MOVEMENT_PERSIST_FAILED',
      message: 'Failed to load the created cash movement',
      details: {
        tenantId: ctx.tenantId,
        sessionId: activeSession.id,
        movementId,
        stage: 'reload',
      },
    });
  }

  const journalEventId = await lookupCashSessionJournalEventId(
    ctx.db,
    ctx.tenantId,
    ctx.envelope?.operationId
  );
  if (journalEventId) {
    const effects: CashSessionJournalEffectInput[] = [
      {
        kind: 'cash_movement',
        resourceType: 'cash_movements',
        resourceId: movementId,
        effectData: {
          sessionId: activeSession.id,
          type: input.type,
          amount: input.amount,
        },
      },
    ];
    if (auditLogId) {
      effects.push({
        kind: 'audit_log',
        resourceType: 'audit_logs',
        resourceId: auditLogId,
        effectData: { action: 'cash_session.movement' },
      });
    }
    await emitCashSessionEffects(ctx.db, log, journalEventId, effects);
  }

  return { movement, journalEventId };
}
