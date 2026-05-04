/**
 * ENG-056 — `closeCashSession` use-case service.
 *
 * Replaces the inline body that lived at
 * `trpc/routers/cashSessions.ts::close`. Mirrors the structural shape of
 * `application/sales/voidSale.ts`: pre-checks outside the transaction,
 * one synchronous `db.transaction(...)` for the row update + audit log,
 * post-commit pending-check enrichment + journal effects.
 *
 * Pending semantics (per ENG-056 plan): close NEVER blocks on pending
 * fiscal/payment state. The counts ride two channels —
 *
 *   1. `cash_session.close` audit log metadata (forensic snapshot at
 *      close-time).
 *   2. `pending_warning` journal effects, one per non-zero category,
 *      so the future Operations Center (ENG-065) can render
 *      "shift X closed with N pending DEEs".
 *
 * The new `cashSessions.pendingChecks` tRPC query is the UI's pre-close
 * gate. Close itself trusts the cashier's intent.
 *
 * Known asymmetry (deferred to a follow-up ticket): `voidSale.ts:166-179`
 * does a manual SQL fetch on the original session's `status='open'`
 * instead of using a shared helper. Not unified here to keep ENG-056
 * scope tight.
 *
 * @module application/cash-sessions/closeCashSession
 */

import { and, eq } from 'drizzle-orm';
import { cashSessions } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  assertCashSessionStillOpen,
  getActiveCashSessionForCashier,
  getCashSessionOverShort,
  getClosingCountTotal,
} from '../../services/cash-session.js';
import { createModuleLogger } from '../../logging/logger.js';
import {
  emitCashSessionEffects,
  lookupCashSessionJournalEventId,
  type CashSessionJournalEffectInput,
} from './journal-effects.js';
import { getPendingChecksForSession } from './pending-checks.js';
import type {
  CashSessionContext,
  CloseCashSessionInput,
  CloseCashSessionResult,
} from './types.js';

const fallbackLog = createModuleLogger('application/cash-sessions/closeCashSession');

export type ClosedCashSessionRow = typeof cashSessions.$inferSelect;

export async function closeCashSession(
  ctx: CashSessionContext,
  input: CloseCashSessionInput
): Promise<CloseCashSessionResult<ClosedCashSessionRow>> {
  const log = ctx.log ?? fallbackLog;

  if (!ctx.user) {
    throwServerError({
      trpcCode: 'UNAUTHORIZED',
      errorCode: 'CASH_SESSION_REQUIRED',
      message: 'An authenticated user is required to close a cash session',
    });
  }

  if (!ctx.siteId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_SITE_REQUIRED',
      message: 'An active site is required before closing a cash session',
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
      message: 'An open cash session is required before closing the register',
    });
  }

  const actualCount = getClosingCountTotal(input.actualCount, input.denominations);
  const overShort = getCashSessionOverShort(activeSession.expectedBalance, actualCount);
  const closedAt = new Date().toISOString();
  const closedBy = ctx.user.id;

  // Resolve pending counts BEFORE the close tx so the audit log row
  // committed inside the transaction carries the forensic snapshot.
  // The queries are read-only and tenant-scoped; running them outside
  // the tx avoids extending the close lock window.
  const pending = await getPendingChecksForSession(
    ctx.db,
    ctx.tenantId,
    activeSession.id
  );

  let auditLogId: string | null = null;

  // Tier-2 #8 — wrap the close write + audit-log insert in one
  // transaction so an over/short row never exists without a paired
  // audit entry (and vice versa). assertCashSessionStillOpen adds
  // TOCTOU defense parity with the sale-lifecycle services.
  ctx.db.transaction(tx => {
    assertCashSessionStillOpen(tx, ctx.tenantId, activeSession.id);

    tx.update(cashSessions)
      .set({
        actualCount,
        actualCountDenominations: input.denominations,
        overShort,
        status: 'closed',
        closedAt,
        updatedAt: closedAt,
      })
      .where(
        and(
          eq(cashSessions.id, activeSession.id),
          eq(cashSessions.tenantId, ctx.tenantId)
        )
      )
      .run();

    auditLogId = writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: closedBy,
      action: 'cash_session.close',
      resourceType: 'cash_session',
      resourceId: activeSession.id,
      before: {
        status: activeSession.status,
        expectedBalance: activeSession.expectedBalance,
        openingFloat: activeSession.openingFloat,
      },
      after: {
        status: 'closed',
        actualCount,
        overShort,
        closedAt,
      },
      metadata: {
        // Material for trend reporting + flagging anomalous shifts.
        // |overShort| > 0 means the cashier's count diverged from expected.
        siteId: activeSession.siteId,
        registerName: activeSession.registerName,
        pendingFiscalDocuments: pending.pendingFiscalDocuments,
        pendingPaymentSales: pending.pendingPaymentSales,
      },
    });
  });

  const closedSession = await ctx.db
    .select()
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.id, activeSession.id),
        eq(cashSessions.tenantId, ctx.tenantId)
      )
    )
    .get();

  if (!closedSession) {
    throw new Error('Failed to load the closed cash session');
  }

  const journalEventId = await lookupCashSessionJournalEventId(
    ctx.db,
    ctx.tenantId,
    ctx.envelope?.operationId
  );
  if (journalEventId) {
    const effects: CashSessionJournalEffectInput[] = [
      {
        kind: 'session_close',
        resourceType: 'cash_sessions',
        resourceId: activeSession.id,
        effectData: {
          overShort,
          expectedBalance: activeSession.expectedBalance,
          actualCount,
        },
      },
    ];
    if (auditLogId) {
      effects.push({
        kind: 'audit_log',
        resourceType: 'audit_logs',
        resourceId: auditLogId,
        effectData: { action: 'cash_session.close' },
      });
    }
    if (pending.pendingFiscalDocuments > 0) {
      effects.push({
        kind: 'pending_warning',
        resourceType: 'cash_sessions',
        resourceId: activeSession.id,
        effectData: {
          category: 'fiscal',
          count: pending.pendingFiscalDocuments,
          samples: pending.fiscalSamples,
        },
      });
    }
    if (pending.pendingPaymentSales > 0) {
      effects.push({
        kind: 'pending_warning',
        resourceType: 'cash_sessions',
        resourceId: activeSession.id,
        effectData: {
          category: 'payment',
          count: pending.pendingPaymentSales,
          samples: pending.paymentSamples,
        },
      });
    }
    await emitCashSessionEffects(ctx.db, log, journalEventId, effects);
  }

  return {
    session: closedSession,
    overShort,
    pendingFiscalDocuments: pending.pendingFiscalDocuments,
    pendingPaymentSales: pending.pendingPaymentSales,
    journalEventId,
  };
}
