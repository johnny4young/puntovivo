/**
 * ENG-056 — `openCashSession` use-case service.
 *
 * Replaces the inline body that lived at
 * `trpc/routers/cashSessions.ts::open`. Mirrors the structural shape of
 * `application/sales/voidSale.ts`: pre-checks outside the transaction,
 * one synchronous `db.transaction(...)` for the row insert + audit log,
 * post-commit best-effort journal effects.
 *
 * Collateral fix (in scope per ENG-056 plan): adds a `cash_session.open`
 * audit log row inside the transaction. Close had one already; the
 * asymmetry was a real audit-trail gap.
 *
 * @module application/cash-sessions/openCashSession
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { cashSessions } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  assertOpeningFloatMatchesDenominations,
  ensureRegisterAssignmentTemplate,
  getActiveCashSessionForCashier,
  getOpenCashSessionForRegister,
  normalizeRegisterName,
} from '../../services/cash-session.js';
import { createModuleLogger } from '../../logging/logger.js';
import {
  emitCashSessionEffects,
  lookupCashSessionJournalEventId,
  type CashSessionJournalEffectInput,
} from './journal-effects.js';
import type {
  CashSessionContext,
  OpenCashSessionInput,
  OpenCashSessionResult,
} from './types.js';

const fallbackLog = createModuleLogger('application/cash-sessions/openCashSession');

export type OpenedCashSessionRow = typeof cashSessions.$inferSelect;

export async function openCashSession(
  ctx: CashSessionContext,
  input: OpenCashSessionInput
): Promise<OpenCashSessionResult<OpenedCashSessionRow>> {
  const log = ctx.log ?? fallbackLog;

  if (!ctx.siteId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_SITE_REQUIRED',
      message: 'An active site is required before opening a cash session',
    });
  }

  const registerName = normalizeRegisterName(input.registerName);
  assertOpeningFloatMatchesDenominations(input.openingFloat, input.denominations);
  const openingFloat = roundMoney(input.openingFloat);

  const existingCashierSession = await getActiveCashSessionForCashier(
    ctx.db,
    ctx.tenantId,
    ctx.siteId,
    ctx.user.id
  );

  if (existingCashierSession) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_ALREADY_OPEN_FOR_CASHIER',
      message: 'This cashier already has an open cash session for the active site',
      details: {
        registerName: existingCashierSession.registerName,
        openedAt: existingCashierSession.openedAt,
      },
    });
  }

  const existingRegisterSession = await getOpenCashSessionForRegister(
    ctx.db,
    ctx.tenantId,
    ctx.siteId,
    registerName
  );

  if (existingRegisterSession) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_ALREADY_OPEN_FOR_REGISTER',
      message: 'The selected register already has an open cash session',
      details: {
        registerName,
        cashierId: existingRegisterSession.cashierId,
        openedAt: existingRegisterSession.openedAt,
      },
    });
  }

  const now = new Date().toISOString();
  const id = nanoid();
  let auditLogId: string | null = null;

  ctx.db.transaction(tx => {
    tx.insert(cashSessions)
      .values({
        id,
        tenantId: ctx.tenantId,
        siteId: ctx.siteId as string,
        cashierId: ctx.user.id,
        registerName,
        openingFloat,
        openingCountDenominations: input.denominations,
        expectedBalance: openingFloat,
        actualCount: null,
        actualCountDenominations: null,
        overShort: null,
        status: 'open',
        openedAt: now,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    auditLogId = writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: 'cash_session.open',
      resourceType: 'cash_session',
      resourceId: id,
      after: {
        status: 'open',
        registerName,
        openingFloat,
        openedAt: now,
      },
      metadata: {
        siteId: ctx.siteId as string,
        registerName,
      },
    });
  });

  // Post-commit: register-template upsert preserves the legacy ordering
  // (router previously called this AFTER the insert at line 349). Moving
  // it inside the tx would change behavior on duplicate-template race
  // windows.
  await ensureRegisterAssignmentTemplate(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    registerName,
    openingFloat,
    denominations: input.denominations,
  });

  const created = await ctx.db
    .select()
    .from(cashSessions)
    .where(and(eq(cashSessions.id, id), eq(cashSessions.tenantId, ctx.tenantId)))
    .get();

  if (!created) {
    throw new Error('Failed to load the created cash session');
  }

  const journalEventId = await lookupCashSessionJournalEventId(
    ctx.db,
    ctx.tenantId,
    ctx.envelope?.operationId
  );
  if (journalEventId) {
    const effects: CashSessionJournalEffectInput[] = [
      {
        kind: 'session_open',
        resourceType: 'cash_sessions',
        resourceId: id,
        effectData: {
          siteId: ctx.siteId,
          registerName,
          openingFloat,
        },
      },
    ];
    if (auditLogId) {
      effects.push({
        kind: 'audit_log',
        resourceType: 'audit_logs',
        resourceId: auditLogId,
        effectData: { action: 'cash_session.open' },
      });
    }
    await emitCashSessionEffects(ctx.db, log, journalEventId, effects);
  }

  return { session: created, journalEventId };
}
