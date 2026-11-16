/**
 * Shift handoff: the outgoing cashier closes their session and leaves a signed
 * row for whoever takes the register next; the incoming cashier opens theirs
 * linked to it. See docs/architecture/0036-shift-handoff-and-guided-close.md.
 *
 * @module application/cash-sessions/handoff
 */
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  cashSessionHandoffs,
  cashSessions,
  hardwareOutbox,
  managerApprovalRequests,
  sales,
  sitePeripherals,
  users,
  type CashHandoffNotice,
  type CashHandoffReceiveMode,
  type CashSessionDenomination,
  type CashSessionHandoff,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { verifyOwnStaffPin } from '../../security/ownStaffPin.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  getActiveCashSessionForCashier,
  getCashSessionDenominationTotal,
  normalizeRegisterName,
} from '../../services/cash-session.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { closeCashSession } from './closeCashSession.js';
import { openCashSession } from './openCashSession.js';
import type { CashSessionContext } from './types.js';

/** The two smallest denominations of the count sheet are what change is made of. */
const LOW_CHANGE_DENOMINATIONS = 2;
const LOW_CHANGE_MIN_COUNT = 5;
const RECOUNT_MATCH_EPSILON = 0.009;
const FAILED_PRINT_STATUSES = ['failed', 'retrying', 'dead_letter'] as const;

/** Denominations of the count that leave the next cashier short of change. */
export function detectLowChange(denominations: readonly CashSessionDenomination[]): number[] {
  return [...denominations]
    .sort((a, b) => a.value - b.value)
    .slice(0, LOW_CHANGE_DENOMINATIONS)
    .filter(denomination => denomination.count < LOW_CHANGE_MIN_COUNT)
    .map(denomination => denomination.value);
}

export interface HandoffDraft {
  id: string;
  label: string;
  total: number;
  suspendedAt: string;
}

/**
 * Parked retail drafts the cashier owns at this site. Table checks are left
 * out: any cashier at the site can already take those over.
 */
function listOwnedParkedDrafts(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  userId: string
): HandoffDraft[] {
  return db
    .select({
      id: sales.id,
      label: sql<string>`coalesce(${sales.suspendedLabel}, ${sales.saleNumber})`,
      total: sales.total,
      suspendedAt: sql<string>`${sales.suspendedAt}`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.tenantId, tenantId),
        eq(sales.status, 'draft'),
        isNotNull(sales.suspendedAt),
        isNull(sales.tableId),
        sql`(${sales.suspendedBy} = ${userId} OR (${sales.suspendedBy} IS NULL AND ${sales.createdBy} = ${userId}))`,
        sql`(${sales.cashSessionId} IS NULL OR ${sales.cashSessionId} IN (SELECT id FROM ${cashSessions} WHERE ${cashSessions.siteId} = ${siteId} AND ${cashSessions.tenantId} = ${tenantId}))`
      )
    )
    .orderBy(asc(sales.suspendedAt))
    .all();
}

function printerNotice(db: DatabaseInstance, tenantId: string, siteId: string) {
  const row = db
    .select({
      count: sql<number>`count(*)`,
      since: sql<string | null>`min(${hardwareOutbox.createdAt})`,
    })
    .from(hardwareOutbox)
    .innerJoin(
      sitePeripherals,
      and(
        eq(sitePeripherals.id, hardwareOutbox.peripheralId),
        eq(sitePeripherals.tenantId, tenantId)
      )
    )
    .where(
      and(
        eq(hardwareOutbox.tenantId, tenantId),
        eq(sitePeripherals.siteId, siteId),
        inArray(hardwareOutbox.status, [...FAILED_PRINT_STATUSES])
      )
    )
    .get();
  return row && row.count > 0 ? { count: row.count, since: row.since } : null;
}

function buildNotices(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  denominations: readonly CashSessionDenomination[]
): CashHandoffNotice[] {
  const notices: CashHandoffNotice[] = [];
  const lowChange = detectLowChange(denominations);
  if (lowChange.length > 0) {
    notices.push({ kind: 'low_change', values: lowChange, count: 0, since: null });
  }
  const printer = printerNotice(db, tenantId, siteId);
  if (printer) {
    notices.push({ kind: 'printer', values: [], count: printer.count, since: printer.since });
  }
  return notices;
}

function requireSite(ctx: CashSessionContext): string {
  if (!ctx.siteId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_SITE_REQUIRED',
      message: 'An active site is required for a shift handoff',
    });
  }
  return ctx.siteId;
}

/**
 * What the outgoing cashier is about to hand over. Never carries the expected
 * balance: the count stays blind for the cashier.
 */
export async function previewHandOut(
  ctx: CashSessionContext,
  denominations: readonly CashSessionDenomination[]
) {
  const siteId = requireSite(ctx);
  const session = await getActiveCashSessionForCashier(ctx.db, ctx.tenantId, siteId, ctx.user.id);
  if (!session) return null;

  const shiftSales = ctx.db
    .select({ total: sales.total, at: sales.createdAt })
    .from(sales)
    .where(
      and(
        eq(sales.tenantId, ctx.tenantId),
        eq(sales.cashSessionId, session.id),
        eq(sales.status, 'completed')
      )
    )
    .orderBy(asc(sales.createdAt))
    .all();

  const now = new Date().toISOString();
  const approvals = ctx.db
    .select({
      id: managerApprovalRequests.id,
      summary: managerApprovalRequests.summary,
      requestedAt: managerApprovalRequests.requestedAt,
    })
    .from(managerApprovalRequests)
    .where(
      and(
        eq(managerApprovalRequests.tenantId, ctx.tenantId),
        eq(managerApprovalRequests.siteId, siteId),
        eq(managerApprovalRequests.requesterId, ctx.user.id),
        eq(managerApprovalRequests.status, 'pending'),
        gte(managerApprovalRequests.expiresAt, now)
      )
    )
    .orderBy(asc(managerApprovalRequests.requestedAt))
    .all();

  return {
    sessionId: session.id,
    registerName: session.registerName,
    openedAt: session.openedAt,
    generatedAt: now,
    salesTotal: roundMoney(shiftSales.reduce((sum, sale) => roundMoney(sum + sale.total), 0)),
    salesCount: shiftSales.length,
    /** One point per sale so the client can draw the shift curve at any width. */
    salesCurve: shiftSales.map(sale => ({ at: sale.at, total: sale.total })),
    countedTotal: getCashSessionDenominationTotal([...denominations]),
    drafts: listOwnedParkedDrafts(ctx.db, ctx.tenantId, siteId, ctx.user.id),
    approvals: approvals.map(approval => ({
      id: approval.id,
      label: approval.summary.label,
      amount: approval.summary.amount ?? null,
      requestedAt: approval.requestedAt,
    })),
    notices: buildNotices(ctx.db, ctx.tenantId, siteId, denominations),
  };
}

export interface HandOutShiftInput {
  actualCount: number;
  denominations: CashSessionDenomination[];
  note: string | null;
}

/**
 * Close the caller's session and record the handoff in the same transaction,
 * so a drawer is never closed for handoff without the row that says so.
 */
export async function handOutShift(ctx: CashSessionContext, input: HandOutShiftInput) {
  const siteId = requireSite(ctx);
  const signer = ctx.db
    .select({ name: users.name })
    .from(users)
    .where(and(eq(users.id, ctx.user.id), eq(users.tenantId, ctx.tenantId)))
    .get();
  if (!signer) {
    throwServerError({
      trpcCode: 'UNAUTHORIZED',
      errorCode: 'AUTH_USER_NOT_FOUND',
      message: 'The authenticated cashier no longer exists in this tenant',
    });
  }

  const handoffId = nanoid();
  const note = input.note?.trim() ? input.note.trim() : null;
  let carriedSaleIds: string[] = [];
  let notices: CashHandoffNotice[] = [];

  const closed = await closeCashSession(ctx, input, {
    inTransaction: (tx, session) => {
      carriedSaleIds = listOwnedParkedDrafts(tx, ctx.tenantId, siteId, ctx.user.id).map(
        draft => draft.id
      );
      notices = buildNotices(tx, ctx.tenantId, siteId, input.denominations);
      const closedRow = tx
        .select({ registerName: cashSessions.registerName, actualCount: cashSessions.actualCount })
        .from(cashSessions)
        .where(and(eq(cashSessions.id, session.id), eq(cashSessions.tenantId, ctx.tenantId)))
        .get();
      tx.insert(cashSessionHandoffs)
        .values({
          id: handoffId,
          tenantId: ctx.tenantId,
          siteId,
          registerName: closedRow!.registerName,
          fromSessionId: session.id,
          fromUserId: ctx.user.id,
          fromUserName: signer.name,
          countedTotal: closedRow!.actualCount ?? 0,
          countedDenominations: input.denominations,
          note,
          carriedSaleIds,
          notices,
          createdAt: session.at,
        })
        .run();
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'cash_session.handoff_out',
        resourceType: 'cash_session',
        resourceId: session.id,
        after: { handoffId, carriedSales: carriedSaleIds.length, hasNote: note !== null },
        metadata: { siteId, registerName: closedRow!.registerName },
        operationId: ctx.envelope?.operationId,
      });
    },
  });

  return {
    handoffId,
    sessionId: closed.session.id,
    registerName: closed.session.registerName,
    countedTotal: closed.session.actualCount ?? 0,
    carriedSaleIds,
    signedBy: signer.name,
    signedAt: closed.session.closedAt ?? new Date().toISOString(),
  };
}

function presentPendingHandoff(db: DatabaseInstance, handoff: CashSessionHandoff) {
  const drafts =
    handoff.carriedSaleIds.length === 0
      ? []
      : db
          .select({
            id: sales.id,
            label: sql<string>`coalesce(${sales.suspendedLabel}, ${sales.saleNumber})`,
            total: sales.total,
            suspendedAt: sql<string>`${sales.suspendedAt}`,
          })
          .from(sales)
          .where(
            and(
              eq(sales.tenantId, handoff.tenantId),
              inArray(sales.id, handoff.carriedSaleIds),
              eq(sales.status, 'draft'),
              isNotNull(sales.suspendedAt)
            )
          )
          .orderBy(asc(sales.suspendedAt))
          .all();
  return {
    id: handoff.id,
    registerName: handoff.registerName,
    fromUserId: handoff.fromUserId,
    fromUserName: handoff.fromUserName,
    createdAt: handoff.createdAt,
    note: handoff.note,
    countedTotal: handoff.countedTotal,
    countedDenominations: handoff.countedDenominations,
    notices: handoff.notices,
    drafts,
  };
}

/**
 * Handoffs still waiting at the site. One stops waiting when it is received
 * or when the register was opened again without it.
 */
export function listPendingHandoffs(ctx: CashSessionContext) {
  const siteId = requireSite(ctx);
  const rows = ctx.db
    .select()
    .from(cashSessionHandoffs)
    .where(
      and(
        eq(cashSessionHandoffs.tenantId, ctx.tenantId),
        eq(cashSessionHandoffs.siteId, siteId),
        isNull(cashSessionHandoffs.toSessionId),
        sql`NOT EXISTS (
          SELECT 1 FROM ${cashSessions}
          WHERE ${cashSessions.tenantId} = ${ctx.tenantId}
            AND ${cashSessions.siteId} = ${siteId}
            AND ${cashSessions.registerName} = ${cashSessionHandoffs.registerName}
            AND ${cashSessions.openedAt} > ${cashSessionHandoffs.createdAt}
        )`
      )
    )
    .orderBy(desc(cashSessionHandoffs.createdAt))
    .all();
  // Only the latest handoff of a register is the drawer that is actually there.
  const latestByRegister = new Map<string, CashSessionHandoff>();
  for (const row of rows) {
    const key = normalizeRegisterName(row.registerName);
    if (!latestByRegister.has(key)) latestByRegister.set(key, row);
  }
  return [...latestByRegister.values()].map(row => presentPendingHandoff(ctx.db, row));
}

export interface ReceiveShiftInput {
  handoffId: string;
  mode: CashHandoffReceiveMode;
  denominations: CashSessionDenomination[];
  pin: string | null;
}

function throwHandoffNotFound(): never {
  return throwServerError({
    trpcCode: 'NOT_FOUND',
    errorCode: 'CASH_HANDOFF_NOT_FOUND',
    message: 'No handoff waits on that register',
  });
}

function throwAlreadyReceived(): never {
  return throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'CASH_HANDOFF_ALREADY_RECEIVED',
    message: 'The drawer was already received or the register was opened again',
  });
}

/** A cashier with a staff PIN confirms with it; without one the session is the proof. */
async function confirmReceiver(ctx: CashSessionContext, pin: string | null): Promise<string> {
  const result = await verifyOwnStaffPin(ctx.db, ctx.tenantId, ctx.user.id, pin);
  if (result.status === 'unknown_user') {
    throwServerError({
      trpcCode: 'UNAUTHORIZED',
      errorCode: 'AUTH_USER_NOT_FOUND',
      message: 'The authenticated cashier no longer exists in this tenant',
    });
  }
  if (result.status === 'invalid') {
    throwServerError({
      trpcCode: 'UNAUTHORIZED',
      errorCode: 'CASH_HANDOFF_PIN_INVALID',
      message: 'The PIN is missing or does not match',
    });
  }
  return result.name;
}

/**
 * Open the incoming cashier's session linked to the handoff. The link, the
 * recount and the reassignment of the carried drafts commit with the open, so
 * two cashiers cannot both receive the same drawer.
 */
export async function receiveShift(ctx: CashSessionContext, input: ReceiveShiftInput) {
  const siteId = requireSite(ctx);
  const handoff = ctx.db
    .select()
    .from(cashSessionHandoffs)
    .where(
      and(
        eq(cashSessionHandoffs.id, input.handoffId),
        eq(cashSessionHandoffs.tenantId, ctx.tenantId),
        eq(cashSessionHandoffs.siteId, siteId)
      )
    )
    .get();
  if (!handoff) throwHandoffNotFound();
  if (handoff.toSessionId !== null) throwAlreadyReceived();
  if (handoff.fromUserId === ctx.user.id) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_HANDOFF_SAME_CASHIER',
      message: 'The cashier who handed the drawer over cannot receive it',
    });
  }

  const receiverName = await confirmReceiver(ctx, input.pin);
  const openingFloat = getCashSessionDenominationTotal(input.denominations);
  const counted = input.mode === 'counted_drawer';
  const recountDifference = counted ? roundMoney(openingFloat - handoff.countedTotal) : null;
  let reassignedSaleIds: string[] = [];

  const opened = await openCashSession(
    ctx,
    { registerName: handoff.registerName, openingFloat, denominations: input.denominations },
    {
      inTransaction: (tx, session) => {
        const claimed = tx
          .update(cashSessionHandoffs)
          .set({
            toSessionId: session.id,
            toUserId: ctx.user.id,
            toUserName: receiverName,
            receiveMode: input.mode,
            recountTotal: counted ? openingFloat : null,
            recountDenominations: counted ? input.denominations : null,
            recountDifference,
            receivedAt: session.at,
          })
          .where(
            and(
              eq(cashSessionHandoffs.id, handoff.id),
              eq(cashSessionHandoffs.tenantId, ctx.tenantId),
              isNull(cashSessionHandoffs.toSessionId)
            )
          )
          .run();
        // The register may also have been opened without the handoff in between.
        const reopened = tx
          .select({ id: cashSessions.id })
          .from(cashSessions)
          .where(
            and(
              eq(cashSessions.tenantId, ctx.tenantId),
              eq(cashSessions.siteId, siteId),
              eq(cashSessions.registerName, handoff.registerName),
              gt(cashSessions.openedAt, handoff.createdAt),
              sql`${cashSessions.id} != ${session.id}`
            )
          )
          .get();
        if (claimed.changes !== 1 || reopened) throwAlreadyReceived();

        reassignedSaleIds = reassignCarriedDrafts(tx, ctx, handoff, session.at);
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'cash_session.handoff_receive',
          resourceType: 'cash_session',
          resourceId: session.id,
          after: {
            handoffId: handoff.id,
            mode: input.mode,
            recountDifference,
            reassignedSales: reassignedSaleIds.length,
          },
          metadata: {
            siteId,
            registerName: handoff.registerName,
            fromSessionId: handoff.fromSessionId,
            fromUserId: handoff.fromUserId,
          },
          operationId: ctx.envelope?.operationId,
        });
      },
    }
  );

  return {
    handoffId: handoff.id,
    session: opened.session,
    attendanceShiftStarted: opened.attendanceShiftStarted,
    recountDifference,
    matches: recountDifference === null || Math.abs(recountDifference) <= RECOUNT_MATCH_EPSILON,
    reassignedSaleIds,
  };
}

/**
 * Move the carried drafts to the incoming cashier. Only drafts still parked
 * and still owned by the outgoing cashier move, the same ownership the drafts
 * list uses, so one a manager took over in between stays where it is.
 */
function reassignCarriedDrafts(
  tx: DatabaseInstance,
  ctx: CashSessionContext,
  handoff: CashSessionHandoff,
  at: string
): string[] {
  if (handoff.carriedSaleIds.length === 0) return [];
  const owned = tx
    .select({ id: sales.id, syncVersion: sales.syncVersion })
    .from(sales)
    .where(
      and(
        eq(sales.tenantId, ctx.tenantId),
        inArray(sales.id, handoff.carriedSaleIds),
        eq(sales.status, 'draft'),
        isNotNull(sales.suspendedAt),
        sql`(${sales.suspendedBy} = ${handoff.fromUserId} OR (${sales.suspendedBy} IS NULL AND ${sales.createdBy} = ${handoff.fromUserId}))`,
        // Same site rule as the hand-out, in case a draft was parked again elsewhere.
        sql`(${sales.cashSessionId} IS NULL OR ${sales.cashSessionId} IN (SELECT id FROM ${cashSessions} WHERE ${cashSessions.siteId} = ${handoff.siteId} AND ${cashSessions.tenantId} = ${ctx.tenantId}))`
      )
    )
    .all();
  for (const draft of owned) {
    const syncVersion = (draft.syncVersion ?? 0) + 1;
    tx.update(sales)
      .set({ suspendedBy: ctx.user.id, syncStatus: 'pending', syncVersion, updatedAt: at })
      .where(and(eq(sales.id, draft.id), eq(sales.tenantId, ctx.tenantId)))
      .run();
    enqueueSyncInTransaction(
      {
        db: tx,
        tenantId: ctx.tenantId,
        envelope: ctx.envelope ?? null,
        deviceId: ctx.deviceId ?? null,
      },
      {
        entityType: 'sales',
        entityId: draft.id,
        operation: 'update',
        data: { id: draft.id, status: 'draft', suspendedBy: ctx.user.id, syncVersion },
      }
    );
  }
  return owned.map(draft => draft.id);
}

/** Handoffs created inside a window, newest first, for the manager's day. */
export function listHandoffsBetween(
  db: DatabaseInstance,
  tenantId: string,
  startIso: string,
  endExclusiveIso: string
) {
  return db
    .select({
      id: cashSessionHandoffs.id,
      siteId: cashSessionHandoffs.siteId,
      registerName: cashSessionHandoffs.registerName,
      fromUserName: cashSessionHandoffs.fromUserName,
      toUserName: cashSessionHandoffs.toUserName,
      createdAt: cashSessionHandoffs.createdAt,
      receivedAt: cashSessionHandoffs.receivedAt,
      recountDifference: cashSessionHandoffs.recountDifference,
    })
    .from(cashSessionHandoffs)
    .where(
      and(
        eq(cashSessionHandoffs.tenantId, tenantId),
        gte(cashSessionHandoffs.createdAt, startIso),
        sql`${cashSessionHandoffs.createdAt} < ${endExclusiveIso}`
      )
    )
    .orderBy(desc(cashSessionHandoffs.createdAt))
    .all();
}
