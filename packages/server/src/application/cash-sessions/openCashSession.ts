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
import { cashSessions, employeeShifts, sites } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  getOpenEmployeeBreak,
  getOpenEmployeeShift,
} from '../../services/labor/attendance-state.js';
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

/**
 * Open a cash session for the active (tenant, site, cashier).
 *
 * Invariants:
 * - At most ONE open session per cashier per site AND at most one open
 *   session per register: both are enforced as preconditions
 *   (`CASH_SESSION_ALREADY_OPEN_FOR_CASHIER` / `_FOR_REGISTER`) before any
 *   write, so the drawer-ownership model stays one-shift-per-drawer.
 * - The opening float must reconcile against the supplied denomination
 *   breakdown (`assertOpeningFloatMatchesDenominations`); the stored
 *   `openingFloat` and the initial `expectedBalance` are both the
 *   `roundMoney`-ed float, two-decimal clean.
 * - ENG-140d: the same immediate transaction reuses a same-site open labor
 *   shift or creates it, links the drawer to that evidence, and writes every
 *   paired audit row. A session never exists without its labor owner.
 *
 * Preconditions: `ctx.siteId` non-null (`CASH_SESSION_SITE_REQUIRED`).
 *
 * Postconditions: the open row is returned; the register-assignment template
 * is upserted post-commit (preserving the legacy ordering to keep the
 * duplicate-template race window unchanged); best-effort journal effects
 * (`session_open` + `audit_log`) are emitted post-commit and never block the
 * open.
 */
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

  const site = await ctx.db
    .select({ id: sites.id, name: sites.name, isActive: sites.isActive })
    .from(sites)
    .where(and(eq(sites.id, ctx.siteId), eq(sites.tenantId, ctx.tenantId)))
    .get();
  if (!site?.isActive) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_SITE_REQUIRED',
      message: 'An active site is required before opening a cash session',
      details: { siteId: ctx.siteId },
    });
  }

  const now = new Date().toISOString();
  const id = nanoid();
  let auditLogId: string | null = null;
  let employeeShiftAuditLogId: string | null = null;
  let employeeShiftId = '';
  let attendanceShiftStarted = false;

  ctx.db.transaction(
    tx => {
      const currentShift = getOpenEmployeeShift(tx, ctx.tenantId, ctx.user.id);
      if (currentShift && currentShift.siteId !== site.id) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'CASH_SESSION_SHIFT_SITE_MISMATCH',
          message: 'Clock out at the other site before opening this register.',
          details: {
            shiftId: currentShift.id,
            shiftSiteId: currentShift.siteId,
            shiftSiteName: currentShift.siteName,
            requestedSiteId: site.id,
            requestedSiteName: site.name,
          },
        });
      }

      const activeBreak = getOpenEmployeeBreak(tx, ctx.tenantId, ctx.user.id);
      if (activeBreak) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'CASH_SESSION_EMPLOYEE_BREAK_ACTIVE',
          message: 'End the active break before opening a register.',
          details: {
            breakId: activeBreak.id,
            shiftId: activeBreak.employeeShiftId,
            startedAt: activeBreak.startedAt,
          },
        });
      }

      employeeShiftId = currentShift?.id ?? nanoid();
      attendanceShiftStarted = !currentShift;
      if (!currentShift) {
        tx.insert(employeeShifts)
          .values({
            id: employeeShiftId,
            tenantId: ctx.tenantId,
            userId: ctx.user.id,
            siteId: site.id,
            clockedInAt: now,
            clockedOutAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        employeeShiftAuditLogId = writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'employee_shift.clock_in',
          resourceType: 'employee_shift',
          resourceId: employeeShiftId,
          before: null,
          after: {
            userId: ctx.user.id,
            siteId: site.id,
            clockedInAt: now,
            clockedOutAt: null,
          },
          metadata: {
            siteName: site.name,
            source: 'cash_session.open',
            registerName,
          },
          operationId: ctx.envelope?.operationId,
        });
      }

      tx.insert(cashSessions)
        .values({
          id,
          tenantId: ctx.tenantId,
          siteId: site.id,
          cashierId: ctx.user.id,
          employeeShiftId,
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
          employeeShiftId,
        },
        metadata: {
          siteId: site.id,
          registerName,
          employeeShiftId,
          attendanceShiftStarted,
        },
        operationId: ctx.envelope?.operationId,
      });
    },
    { behavior: 'immediate' }
  );

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
    throwServerError({
      trpcCode: 'INTERNAL_SERVER_ERROR',
      errorCode: 'CASH_SESSION_LOAD_FAILED',
      message: 'Failed to load the created cash session',
      details: { tenantId: ctx.tenantId, sessionId: id, operation: 'open' },
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
        kind: 'session_open',
        resourceType: 'cash_sessions',
        resourceId: id,
        effectData: {
          siteId: ctx.siteId,
          registerName,
          openingFloat,
          employeeShiftId,
          attendanceShiftStarted,
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
    if (employeeShiftAuditLogId) {
      effects.push({
        kind: 'audit_log',
        resourceType: 'audit_logs',
        resourceId: employeeShiftAuditLogId,
        effectData: { action: 'employee_shift.clock_in' },
      });
    }
    await emitCashSessionEffects(ctx.db, log, journalEventId, effects);
  }

  return { session: created, journalEventId, attendanceShiftStarted };
}
