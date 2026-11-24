/**
 * Transfer reconciliation surface (Fase 5.4 / 5.5).
 *
 * Everything here reads and writes the tables that already exist. A manual
 * deposit is not a separate kind of record: it is the transfer tender itself,
 * moved along the confirmation lifecycle by `planTransferAdjustment`, with an
 * audit row naming the operator who verified the money.
 *
 * @module services/payments/transfer-reconciliation
 */
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import type { DatabaseInstance } from '../../db/index.js';
import { auditLogs, salePayments, sales, siteTransferDestinations } from '../../db/schema.js';
import {
  summarizeDeposits,
  type DepositAccumulation,
  type DepositAccumulationStatus,
} from '../../application/sales/transfer-adjustment.js';
import {
  isTransferConfirmed,
  transferConfirmationColumns,
} from '../../application/sales/transfer-confirmation.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../audit-logs.js';

const PENDING_STATUSES = ['pending', 'customer_reported', 'needs_reconciliation'] as const;
type PendingTransferStatus = (typeof PENDING_STATUSES)[number];

/** The immutable audit action that records one deposit movement. */
const DEPOSIT_AUDIT_ACTION = 'sale_payment.transfer_manual_confirmed';

export interface PendingTransferRow {
  salePaymentId: string;
  saleId: string;
  saleNumber: string | null;
  siteId: string | null;
  amount: number;
  reference: string | null;
  confirmationStatus: string | null;
  confirmationSource: string | null;
  confirmedAt: string | null;
  destinationSnapshot: { id: string; label: string; kind: string } | null;
  createdAt: string;
  /**
   * Money the deposit chain applied to this tender, accumulated across every
   * movement and capped at `amount`. Not the last reported instalment.
   */
  appliedAmount: number;
  /** Received money above `amount`: reported, never applied to the sale. */
  surplusAmount: number;
}

/** One recorded deposit movement, as the immutable audit chain preserves it. */
interface RecordedDeposit {
  salePaymentId: string;
  /** The movement's own amount (never the tender's running total). */
  verifiedAmount: number;
  /** Cumulative applied amount at the time the movement was recorded. */
  appliedAmount: number;
  /** Cumulative surplus at the time the movement was recorded. */
  surplusAmount: number;
  status: DepositAccumulationStatus;
  idempotencyKey: string | null;
}

/**
 * Read one deposit payload without trusting it.
 *
 * The chain is evidence, not a schema: a row can predate a field, or be
 * written by an older build. Anything without a finite positive
 * `verifiedAmount` is skipped instead of counted, so corrupt evidence can never
 * move money.
 */
function readDepositPayload(after: Record<string, unknown> | null): RecordedDeposit | null {
  const salePaymentId = after?.['salePaymentId'];
  const verified = after?.['verifiedAmount'];
  if (typeof salePaymentId !== 'string' || salePaymentId.length === 0) return null;
  if (typeof verified !== 'number') return null;
  const verifiedAmount = roundMoney(verified);
  if (!Number.isFinite(verifiedAmount) || verifiedAmount <= 0) return null;

  const applied = after?.['appliedAmount'];
  const appliedAmount =
    typeof applied === 'number' && Number.isFinite(applied) && applied >= 0
      ? roundMoney(applied)
      : verifiedAmount;
  const surplus = after?.['surplusAmount'];
  const surplusAmount =
    typeof surplus === 'number' && Number.isFinite(surplus) && surplus >= 0
      ? roundMoney(surplus)
      : 0;
  const idempotencyKey = after?.['idempotencyKey'];

  return {
    salePaymentId,
    verifiedAmount,
    appliedAmount,
    surplusAmount,
    // Only an explicit manual confirmation is trusted; every other value (or a
    // corrupt one) leaves the tender for a human decision.
    status: after?.['status'] === 'manual_confirmed' ? 'manual_confirmed' : 'needs_reconciliation',
    idempotencyKey:
      typeof idempotencyKey === 'string' && idempotencyKey.length > 0 ? idempotencyKey : null,
  };
}

/**
 * The deposit chain of the given sales, always tenant-scoped.
 *
 * This is the only source of the accumulated amount: `sale_payments` holds the
 * tender's current state and has no running-total column (and gets none — the
 * design keeps the evidence in the immutable chain). Called inside the writer
 * transaction on the write path, so the aggregate a deposit is applied to can
 * never be stale.
 */
function readRecordedDeposits(
  db: DatabaseInstance,
  args: { tenantId: string; saleIds: readonly string[] }
): RecordedDeposit[] {
  if (args.saleIds.length === 0) return [];
  const rows = db
    .select({ after: auditLogs.after })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, args.tenantId),
        eq(auditLogs.action, DEPOSIT_AUDIT_ACTION),
        inArray(auditLogs.resourceId, [...args.saleIds])
      )
    )
    .all();

  const deposits: RecordedDeposit[] = [];
  for (const row of rows) {
    const deposit = readDepositPayload(row.after);
    if (deposit) deposits.push(deposit);
  }
  return deposits;
}

/**
 * What the recorded deposits add up to, per tender of one sale.
 *
 * The sale read model needs the same arithmetic the reconciliation surface and
 * the deposit write path use: a receipt must show how much of a transfer was
 * actually received and how much money arrived above the tender. One shared
 * derivation, so a printed receipt can never disagree with the tender row.
 * Tenders without a manual deposit chain simply do not appear in the map.
 */
export function accumulateSaleDeposits(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    saleId: string;
    tenders: readonly { id: string; amount: number }[];
  }
): Map<string, DepositAccumulation> {
  const accumulationByTender = new Map<string, DepositAccumulation>();
  if (args.tenders.length === 0) return accumulationByTender;

  const amountsByTender = new Map<string, number[]>();
  for (const deposit of readRecordedDeposits(db, {
    tenantId: args.tenantId,
    saleIds: [args.saleId],
  })) {
    const recorded = amountsByTender.get(deposit.salePaymentId);
    if (recorded) recorded.push(deposit.verifiedAmount);
    else amountsByTender.set(deposit.salePaymentId, [deposit.verifiedAmount]);
  }

  for (const tender of args.tenders) {
    const deposits = amountsByTender.get(tender.id);
    if (!deposits) continue;
    accumulationByTender.set(tender.id, summarizeDeposits(tender.amount, deposits));
  }
  return accumulationByTender;
}

/**
 * Transfer tenders that are not settled yet, with the filters the Operations
 * payments surface offers. Superseded tenders are excluded: they are history,
 * not money owed.
 */
export function listPendingTransfers(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId?: string | undefined;
    status?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    limit?: number | undefined;
  }
): PendingTransferRow[] {
  const conditions = [
    eq(salePayments.tenantId, args.tenantId),
    eq(salePayments.method, 'transfer'),
    args.status
      ? eq(salePayments.confirmationStatus, args.status as PendingTransferStatus)
      : inArray(salePayments.confirmationStatus, [...PENDING_STATUSES]),
  ];
  if (args.from) conditions.push(gte(salePayments.createdAt, args.from));
  if (args.to) conditions.push(lte(salePayments.createdAt, args.to));

  const rows = db
    .select({
      salePaymentId: salePayments.id,
      saleId: salePayments.saleId,
      saleNumber: sales.saleNumber,
      siteId: siteTransferDestinations.siteId,
      amount: salePayments.amount,
      reference: salePayments.reference,
      confirmationStatus: salePayments.confirmationStatus,
      confirmationSource: salePayments.confirmationSource,
      confirmedAt: salePayments.confirmedAt,
      destinationSnapshot: salePayments.destinationSnapshot,
      createdAt: salePayments.createdAt,
    })
    .from(salePayments)
    .innerJoin(sales, eq(sales.id, salePayments.saleId))
    //  carries no site column, so the site is the destination's. Tenders
    // written before destinations existed have none and only appear when the
    // surface is not filtered by site.
    .leftJoin(
      siteTransferDestinations,
      eq(siteTransferDestinations.id, salePayments.transferDestinationId)
    )
    .where(
      and(...conditions, ...(args.siteId ? [eq(siteTransferDestinations.siteId, args.siteId)] : []))
    )
    .orderBy(desc(salePayments.createdAt))
    .limit(args.limit ?? 100)
    .all();

  if (rows.length === 0) return [];

  // The movements behind each tender, in one tenant-scoped read instead of one
  // query per row. Both the write path and this projection go through
  // `summarizeDeposits`, so the surface never invents its own client-side sum.
  const depositsByTender = new Map<string, number[]>();
  for (const deposit of readRecordedDeposits(db, {
    tenantId: args.tenantId,
    saleIds: [...new Set(rows.map(row => row.saleId))],
  })) {
    const recorded = depositsByTender.get(deposit.salePaymentId);
    if (recorded) recorded.push(deposit.verifiedAmount);
    else depositsByTender.set(deposit.salePaymentId, [deposit.verifiedAmount]);
  }

  return rows.map(row => {
    const accumulation = summarizeDeposits(
      row.amount,
      depositsByTender.get(row.salePaymentId) ?? []
    );
    // A tender confirmed without a manual deposit chain (a reference typed at
    // the register, or a provider verdict) is applied in full: there are no
    // movements to accumulate.
    const settled = isTransferConfirmed(row.confirmationStatus);
    return {
      ...row,
      appliedAmount: settled ? roundMoney(row.amount) : accumulation.appliedAmount,
      surplusAmount: settled ? 0 : accumulation.surplusAmount,
    };
  });
}

/** Totals for one sale, so the surface can show confirmed vs pending money. */
export function saleTransferTotals(
  db: DatabaseInstance,
  tenantId: string,
  saleId: string
): { total: number; confirmed: number; pending: number } {
  const sale = db
    .select({ total: sales.total })
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
    .get();
  if (!sale) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Sale not found' });
  }
  const rows = db
    .select({
      amount: salePayments.amount,
      status: salePayments.confirmationStatus,
      method: salePayments.method,
    })
    .from(salePayments)
    .where(and(eq(salePayments.saleId, saleId), eq(salePayments.tenantId, tenantId)))
    .all();

  let confirmed = 0;
  let pending = 0;
  for (const row of rows) {
    // Superseded tenders were replaced: counting them would double the money.
    if (row.status === 'rejected' || row.status === 'cancelled') continue;
    const amount = roundMoney(row.amount);
    if (row.method !== 'transfer') {
      confirmed += amount;
      continue;
    }
    if (row.status === 'manual_confirmed' || row.status === 'provider_confirmed') {
      confirmed += amount;
    } else {
      pending += amount;
    }
  }
  return { total: roundMoney(sale.total), confirmed, pending };
}

/**
 * Record money the operator actually verified against the bank.
 *
 * The confirmed amount of a transfer tender is the SUM of the deposits applied
 * to it, never the last reported instalment: two legitimate 50 deposits on a
 * 100 tender complete it. A sum that falls short or exceeds the tender is
 * parked in `needs_reconciliation` so a human decides, and the excess is
 * reported as surplus. The sale total is not rewritten.
 *
 * Each call keeps its own immutable `sale_payment.transfer_manual_confirmed`
 * row, written in the same transaction as the tender update. Replaying a
 * movement (`idempotencyKey`) returns the recorded outcome instead of adding
 * the money twice.
 */
export function registerManualDeposit(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    actorId: string;
    saleId: string;
    salePaymentId: string;
    verifiedAmount: number;
    reference: string | null;
    valueDate: string | null;
    note: string | null;
    operationId?: string | undefined;
    idempotencyKey?: string | undefined;
  }
): { appliedAmount: number; surplusAmount: number; status: string } {
  const now = new Date().toISOString();

  // The whole check-and-write runs inside one writer transaction, and the
  // recorded deposits are read inside it: two racing deposits can never both
  // read the same prior total. `immediate` takes the write lock before that
  // read instead of upgrading mid-transaction, so the serialization is not
  // left to chance.
  return db.transaction(
    tx => {
      const sale = tx
        .select({ total: sales.total })
        .from(sales)
        .where(and(eq(sales.id, args.saleId), eq(sales.tenantId, args.tenantId)))
        .get();
      if (!sale) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sale not found' });

      const tenders = tx
        .select({
          id: salePayments.id,
          method: salePayments.method,
          amount: salePayments.amount,
          reference: salePayments.reference,
          confirmationStatus: salePayments.confirmationStatus,
        })
        .from(salePayments)
        .where(and(eq(salePayments.saleId, args.saleId), eq(salePayments.tenantId, args.tenantId)))
        .all();

      const targetIndex = tenders.findIndex(tender => tender.id === args.salePaymentId);
      if (targetIndex < 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Transfer tender not found' });
      }
      const target = tenders[targetIndex]!;
      if (target.method !== 'transfer') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only transfer tenders take a deposit',
        });
      }
      if (target.confirmationStatus === 'provider_confirmed') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This transfer was already confirmed by the provider',
        });
      }

      const recorded = readRecordedDeposits(tx, {
        tenantId: args.tenantId,
        saleIds: [args.saleId],
      }).filter(entry => entry.salePaymentId === args.salePaymentId);

      // A retried movement is not new money: answer with what was already
      // recorded for that key, without a second audit row or tender update.
      if (args.idempotencyKey !== undefined) {
        const replay = recorded.find(entry => entry.idempotencyKey === args.idempotencyKey);
        if (replay) {
          return {
            appliedAmount: replay.appliedAmount,
            surplusAmount: replay.surplusAmount,
            status: replay.status,
          };
        }
      }

      const verifiedAmount = roundMoney(args.verifiedAmount);
      if (!Number.isFinite(verifiedAmount) || verifiedAmount <= 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A deposit requires a positive verified amount',
        });
      }

      // A transfer is confirmed only when the accumulated money covers what the
      // sale expected. An excess or a shortfall both land in reconciliation:
      // neither is allowed to silently rewrite the sale, and a partial deposit
      // must not make the tender look paid while the customer still owes the
      // rest.
      const accumulation = summarizeDeposits(target.amount, [
        ...recorded.map(entry => entry.verifiedAmount),
        verifiedAmount,
      ]);
      const status = accumulation.status;

      tx.update(salePayments)
        .set({
          // A verified amount always lands as manual_confirmed; a mismatch is
          // parked for reconciliation by the status below.
          ...transferConfirmationColumns({
            method: 'transfer',
            reference: args.reference ?? target.reference,
            actorId: args.actorId,
            now,
          }),
          confirmationStatus: status,
          confirmationSource: 'operator',
          confirmedBy: args.actorId,
          confirmedAt: now,
        })
        .where(
          and(eq(salePayments.id, args.salePaymentId), eq(salePayments.tenantId, args.tenantId))
        )
        .run();
      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: DEPOSIT_AUDIT_ACTION,
        resourceType: 'sale',
        resourceId: args.saleId,
        before: { confirmationStatus: target.confirmationStatus, amount: target.amount },
        after: {
          salePaymentId: args.salePaymentId,
          verifiedAmount,
          appliedAmount: accumulation.appliedAmount,
          surplusAmount: accumulation.surplusAmount,
          status,
          valueDate: args.valueDate,
          note: args.note,
          idempotencyKey: args.idempotencyKey ?? null,
        },
        ...(args.operationId !== undefined ? { operationId: args.operationId } : {}),
      });

      return {
        appliedAmount: accumulation.appliedAmount,
        surplusAmount: accumulation.surplusAmount,
        status,
      };
    },
    { behavior: 'immediate' }
  );
}

/** Counters for the reconciliation centre header. */
export function transferReconciliationCounters(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string | null
): Record<string, number> {
  const rows = db
    .select({ status: salePayments.confirmationStatus, count: sql<number>`count(*)` })
    .from(salePayments)
    .leftJoin(
      siteTransferDestinations,
      eq(siteTransferDestinations.id, salePayments.transferDestinationId)
    )
    .where(
      and(
        eq(salePayments.tenantId, tenantId),
        eq(salePayments.method, 'transfer'),
        ...(siteId ? [eq(siteTransferDestinations.siteId, siteId)] : [])
      )
    )
    .groupBy(salePayments.confirmationStatus)
    .all();

  const counters: Record<string, number> = {};
  for (const row of rows) {
    counters[row.status ?? 'legacy_null'] = Number(row.count);
  }
  return counters;
}
