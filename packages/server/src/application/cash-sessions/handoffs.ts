/**
 * Mid-day register handoff. Both steps run inside the close and open use-cases
 * so every drawer invariant holds and the handoff row commits with them.
 */
import { SALES_ROLES } from '@puntovivo/shared/roles';
import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  cashSessionHandoffs,
  cashSessions,
  sales,
  users,
  type CashHandoffReceiveMode,
  type CashHandoffSignature,
  type CashSessionDenomination,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { readStaffPinHash, verifyOwnStaffPin } from '../../security/staffPinCheck.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { getClosingCountTotal } from '../../services/cash-session.js';
import { parkedDraftOwnedBy } from '../sales/draft-ownership.js';
import { closeCashSession } from './closeCashSession.js';
import { openCashSession } from './openCashSession.js';
import type { CashSessionContext, CashSessionTransaction, OpenCashSessionResult } from './types.js';

export interface StartCashHandoffInput {
  actualCount: number;
  denominations: CashSessionDenomination[];
  note?: string | null | undefined;
  toCashierId?: string | null | undefined;
  pin?: string | null | undefined;
}

export interface ReceiveCashHandoffInput {
  handoffId: string;
  mode: CashHandoffReceiveMode;
  /** Recount of the kept drawer, or the float of the new one. */
  count: number;
  denominations: CashSessionDenomination[];
  pin?: string | null | undefined;
}

/**
 * Sign with the actor's staff PIN when one is enrolled. Users without a PIN
 * sign with their authenticated session, and the row records which it was.
 */
async function signAsActor(
  db: DatabaseInstance,
  tenantId: string,
  userId: string,
  pin: string | null | undefined
): Promise<CashHandoffSignature> {
  const staffPinHash = readStaffPinHash(db, tenantId, userId);
  if (!staffPinHash && !pin) return 'session';
  if (staffPinHash && !pin) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_HANDOFF_PIN_REQUIRED',
      message: 'Enter your staff PIN to sign the handoff',
    });
  }
  if (!(await verifyOwnStaffPin(db, { tenantId, userId, staffPinHash }, pin!))) {
    throwServerError({
      // Not 401: the client refreshes and resends on 401, which would count one wrong PIN twice.
      trpcCode: 'FORBIDDEN',
      errorCode: 'CASH_HANDOFF_PIN_INVALID',
      message: 'The staff PIN does not match',
    });
  }
  return 'pin';
}

function requireSite(ctx: CashSessionContext): string {
  if (!ctx.siteId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_SITE_REQUIRED',
      message: 'An active site is required for a register handoff',
    });
  }
  return ctx.siteId;
}

/**
 * Retail drafts the outgoing cashier parked at this site by the handoff; later
 * parks on another register stay theirs, and restaurant checks stay with their table.
 */
function parkedDraftsOf(tenantId: string, siteId: string, cashierId: string, handedOverAt: string) {
  return and(
    eq(sales.tenantId, tenantId),
    lte(sales.suspendedAt, handedOverAt),
    eq(sales.status, 'draft'),
    isNotNull(sales.suspendedAt),
    isNull(sales.tableId),
    parkedDraftOwnedBy(cashierId),
    inArray(
      sales.cashSessionId,
      sql`(select ${cashSessions.id} from ${cashSessions} where ${cashSessions.tenantId} = ${tenantId} and ${cashSessions.siteId} = ${siteId})`
    )
  );
}

const fromCashier = alias(users, 'from_cashier');
const toCashier = alias(users, 'to_cashier');

/** The handoff as either cashier may see it: counts, never the expected balance. */
export function listCashHandoffs(
  db: DatabaseInstance,
  where: { tenantId: string; siteId?: string; ids?: string[]; status?: 'pending' }
) {
  const conditions = [eq(cashSessionHandoffs.tenantId, where.tenantId)];
  if (where.siteId) conditions.push(eq(cashSessionHandoffs.siteId, where.siteId));
  if (where.ids) conditions.push(inArray(cashSessionHandoffs.id, where.ids));
  if (where.status) conditions.push(eq(cashSessionHandoffs.status, where.status));
  const rows = db
    .select({
      id: cashSessionHandoffs.id,
      siteId: cashSessionHandoffs.siteId,
      registerName: cashSessionHandoffs.registerName,
      status: cashSessionHandoffs.status,
      fromSessionId: cashSessionHandoffs.fromSessionId,
      fromCashierId: cashSessionHandoffs.fromCashierId,
      fromCashierName: fromCashier.name,
      toCashierId: cashSessionHandoffs.toCashierId,
      toCashierName: toCashier.name,
      toSessionId: cashSessionHandoffs.toSessionId,
      outgoingCount: cashSessionHandoffs.outgoingCount,
      outgoingDenominations: cashSessionHandoffs.outgoingDenominations,
      note: cashSessionHandoffs.note,
      fromSignature: cashSessionHandoffs.fromSignature,
      handedOverAt: cashSessionHandoffs.handedOverAt,
      receiveMode: cashSessionHandoffs.receiveMode,
      receivedCount: cashSessionHandoffs.receivedCount,
      receivedDenominations: cashSessionHandoffs.receivedDenominations,
      toSignature: cashSessionHandoffs.toSignature,
      reassignedDraftCount: cashSessionHandoffs.reassignedDraftCount,
      receivedAt: cashSessionHandoffs.receivedAt,
    })
    .from(cashSessionHandoffs)
    .innerJoin(fromCashier, eq(fromCashier.id, cashSessionHandoffs.fromCashierId))
    .leftJoin(toCashier, eq(toCashier.id, cashSessionHandoffs.toCashierId))
    .where(and(...conditions))
    .orderBy(asc(cashSessionHandoffs.handedOverAt))
    .all();

  // Parked sales that pass to whoever receives the drawer, read once per outgoing cashier.
  const draftsByOwner = new Map<string, DraftPreview[]>();
  const draftsOf = (siteId: string, cashierId: string, handedOverAt: string) => {
    const key = `${siteId}:${cashierId}:${handedOverAt}`;
    let drafts = draftsByOwner.get(key);
    if (!drafts) {
      drafts = db
        .select({
          id: sales.id,
          saleNumber: sales.saleNumber,
          label: sales.suspendedLabel,
          total: sales.total,
          suspendedAt: sales.suspendedAt,
        })
        .from(sales)
        .where(parkedDraftsOf(where.tenantId, siteId, cashierId, handedOverAt))
        .orderBy(asc(sales.suspendedAt))
        .all();
      draftsByOwner.set(key, drafts);
    }
    return drafts;
  };

  return rows.map(row => ({
    ...row,
    countDifference: handoffCountDifference(row),
    drafts:
      row.status === 'pending' ? draftsOf(row.siteId, row.fromCashierId, row.handedOverAt) : [],
  }));
}

export interface DraftPreview {
  id: string;
  saleNumber: string;
  label: string | null;
  total: number;
  suspendedAt: string | null;
}

/** Recount minus the outgoing count; null when the receiver started a new drawer. */
function handoffCountDifference(row: {
  receivedCount: number | null;
  outgoingCount: number;
}): number | null {
  return row.receivedCount === null ? null : roundMoney(row.receivedCount - row.outgoingCount);
}

export type CashHandoffView = ReturnType<typeof listCashHandoffs>[number];

function loadHandoffView(db: DatabaseInstance, tenantId: string, id: string): CashHandoffView {
  const [view] = listCashHandoffs(db, { tenantId, ids: [id] });
  if (!view) {
    throwServerError({
      trpcCode: 'INTERNAL_SERVER_ERROR',
      errorCode: 'CASH_HANDOFF_NOT_FOUND',
      message: 'Failed to load the register handoff',
    });
  }
  return view;
}

/**
 * Close the caller's drawer with a blind count and leave it for the next
 * cashier. The response carries the count, never the expected balance.
 */
export async function startCashHandoff(
  ctx: CashSessionContext,
  input: StartCashHandoffInput
): Promise<CashHandoffView> {
  const toCashierId = input.toCashierId ?? null;
  if (toCashierId) {
    const recipient = ctx.db
      .select({ id: users.id, role: users.role, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.id, toCashierId), eq(users.tenantId, ctx.tenantId)))
      .get();
    if (
      !recipient?.isActive ||
      recipient.id === ctx.user.id ||
      !(SALES_ROLES as readonly string[]).includes(recipient.role)
    ) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'CASH_HANDOFF_RECIPIENT_INVALID',
        message: 'Hand the register to another active cashier, manager or administrator',
        details: { toCashierId },
      });
    }
  }

  const signature = await signAsActor(ctx.db, ctx.tenantId, ctx.user.id, input.pin);
  const handoffId = nanoid();
  const note = input.note?.trim() || null;

  await closeCashSession(
    ctx,
    { actualCount: input.actualCount, denominations: input.denominations },
    {
      withinTransaction: (tx, closed) => {
        tx.insert(cashSessionHandoffs)
          .values({
            id: handoffId,
            tenantId: ctx.tenantId,
            siteId: closed.session.siteId,
            registerName: closed.session.registerName,
            fromSessionId: closed.session.id,
            fromCashierId: ctx.user.id,
            toCashierId,
            status: 'pending',
            outgoingCount: closed.actualCount,
            outgoingDenominations: input.denominations,
            note,
            fromSignature: signature,
            handedOverAt: closed.closedAt,
            createdAt: closed.closedAt,
            updatedAt: closed.closedAt,
          })
          .run();
        const auditLogId = writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'cash_session.handoff',
          resourceType: 'cash_session_handoff',
          resourceId: handoffId,
          after: {
            status: 'pending',
            outgoingCount: closed.actualCount,
            toCashierId,
            hasNote: note !== null,
            signature,
          },
          metadata: {
            siteId: closed.session.siteId,
            registerName: closed.session.registerName,
            fromSessionId: closed.session.id,
          },
          operationId: ctx.envelope?.operationId,
        });
        return [handoffAuditEffect(auditLogId, 'cash_session.handoff')];
      },
    }
  );

  return loadHandoffView(ctx.db, ctx.tenantId, handoffId);
}

function handoffAuditEffect(auditLogId: string, action: string) {
  return {
    kind: 'audit_log',
    resourceType: 'audit_logs',
    resourceId: auditLogId,
    effectData: { action },
  };
}

function assertReceivable(
  handoff: typeof cashSessionHandoffs.$inferSelect | undefined,
  actorId: string
): asserts handoff is typeof cashSessionHandoffs.$inferSelect {
  if (!handoff) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'CASH_HANDOFF_NOT_FOUND',
      message: 'That register handoff does not exist at this site',
    });
  }
  if (handoff.status !== 'pending') {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'CASH_HANDOFF_NOT_PENDING',
      message: 'That register handoff was already received or replaced',
      details: { status: handoff.status },
    });
  }
  if (handoff.fromCashierId === actorId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_HANDOFF_SAME_CASHIER',
      message: 'Another cashier has to receive the register you handed over',
    });
  }
  if (handoff.toCashierId && handoff.toCashierId !== actorId) {
    throwServerError({
      trpcCode: 'FORBIDDEN',
      errorCode: 'CASH_HANDOFF_RECIPIENT_MISMATCH',
      message: 'This register was handed to another cashier',
    });
  }
}

function selectHandoff(
  db: DatabaseInstance | CashSessionTransaction,
  tenantId: string,
  siteId: string,
  id: string
) {
  return db
    .select()
    .from(cashSessionHandoffs)
    .where(
      and(
        eq(cashSessionHandoffs.id, id),
        eq(cashSessionHandoffs.tenantId, tenantId),
        eq(cashSessionHandoffs.siteId, siteId)
      )
    )
    .get();
}

/**
 * Open the caller's session on the handed-over register. A kept drawer opens
 * with the recount and records its difference against the outgoing count; a
 * new drawer opens with its own float. The outgoing cashier's parked retail
 * drafts at this site pass to the receiver in the same transaction.
 */
export async function receiveCashHandoff(
  ctx: CashSessionContext,
  input: ReceiveCashHandoffInput
): Promise<{ handoff: CashHandoffView; opened: OpenCashSessionResult<{ id: string }> }> {
  const siteId = requireSite(ctx);
  const handoff = selectHandoff(ctx.db, ctx.tenantId, siteId, input.handoffId);
  assertReceivable(handoff, ctx.user.id);

  const count = getClosingCountTotal(input.count, input.denominations);
  const kept = input.mode === 'counted_drawer';
  const signature = await signAsActor(ctx.db, ctx.tenantId, ctx.user.id, input.pin);

  const opened = await openCashSession(
    ctx,
    { registerName: handoff.registerName, openingFloat: count, denominations: input.denominations },
    {
      withinTransaction: (tx, opened) => {
        // The PIN check awaited; re-read under the writer before claiming it.
        const current = selectHandoff(tx, ctx.tenantId, siteId, handoff.id);
        assertReceivable(current, ctx.user.id);

        const moved = tx
          .update(sales)
          .set({
            suspendedBy: ctx.user.id,
            syncStatus: 'pending',
            syncVersion: sql`coalesce(${sales.syncVersion}, 0) + 1`,
            updatedAt: opened.openedAt,
          })
          .where(parkedDraftsOf(ctx.tenantId, siteId, current.fromCashierId, current.handedOverAt))
          .returning({ id: sales.id, syncVersion: sales.syncVersion })
          .all();
        for (const draft of moved) {
          enqueueSyncInTransaction(
            {
              db: tx as unknown as DatabaseInstance,
              tenantId: ctx.tenantId,
              envelope: ctx.envelope ?? null,
              deviceId: ctx.deviceId ?? null,
            },
            {
              entityType: 'sales',
              entityId: draft.id,
              operation: 'update',
              data: { id: draft.id, suspendedBy: ctx.user.id, syncVersion: draft.syncVersion },
            }
          );
        }

        const countDifference = kept ? roundMoney(count - current.outgoingCount) : null;
        tx.update(cashSessionHandoffs)
          .set({
            status: 'received',
            toCashierId: ctx.user.id,
            toSessionId: opened.sessionId,
            receiveMode: input.mode,
            receivedCount: kept ? count : null,
            receivedDenominations: kept ? input.denominations : null,
            toSignature: signature,
            reassignedDraftCount: moved.length,
            receivedAt: opened.openedAt,
            updatedAt: opened.openedAt,
          })
          .where(
            and(
              eq(cashSessionHandoffs.id, current.id),
              eq(cashSessionHandoffs.tenantId, ctx.tenantId),
              eq(cashSessionHandoffs.status, 'pending')
            )
          )
          .run();

        const auditLogId = writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'cash_session.handoff_receive',
          resourceType: 'cash_session_handoff',
          resourceId: current.id,
          before: { status: 'pending', toCashierId: current.toCashierId },
          after: {
            status: 'received',
            receiveMode: input.mode,
            receivedCount: kept ? count : null,
            openingFloat: count,
            countDifference,
            signature,
          },
          metadata: {
            siteId,
            registerName: current.registerName,
            fromCashierId: current.fromCashierId,
            toSessionId: opened.sessionId,
            reassignedSaleIds: moved.map(row => row.id),
          },
          operationId: ctx.envelope?.operationId,
        });
        return [handoffAuditEffect(auditLogId, 'cash_session.handoff_receive')];
      },
    }
  );

  return { handoff: loadHandoffView(ctx.db, ctx.tenantId, handoff.id), opened };
}
