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
import { salePayments, sales, siteTransferDestinations } from '../../db/schema.js';
import { planTransferAdjustment } from '../../application/sales/transfer-adjustment.js';
import { transferConfirmationColumns } from '../../application/sales/transfer-confirmation.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../audit-logs.js';

const PENDING_STATUSES = ['pending', 'customer_reported', 'needs_reconciliation'] as const;
type PendingTransferStatus = (typeof PENDING_STATUSES)[number];

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

  return db
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
    .where(and(...conditions, ...(args.siteId ? [eq(siteTransferDestinations.siteId, args.siteId)] : [])))
    .orderBy(desc(salePayments.createdAt))
    .limit(args.limit ?? 100)
    .all();
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
 * A verified amount different from what the sale expected is never applied
 * silently: the plan reports the surplus and the tender is parked in
 * `needs_reconciliation` so a human decides. The sale total is not rewritten.
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
  const sale = db
    .select({ total: sales.total })
    .from(sales)
    .where(and(eq(sales.id, args.saleId), eq(sales.tenantId, args.tenantId)))
    .get();
  if (!sale) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sale not found' });

  const tenders = db
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
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only transfer tenders take a deposit' });
  }
  if (target.confirmationStatus === 'provider_confirmed') {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This transfer was already confirmed by the provider',
    });
  }

  const plan = planTransferAdjustment({
    tenders: tenders.map(tender => ({
      method: tender.method,
      amount: tender.amount,
      reference: tender.reference,
    })),
    targetIndex,
    verifiedAmount: args.verifiedAmount,
    reference: args.reference,
    saleTotal: roundMoney(sale.total),
  });
  // A transfer is confirmed only when the verified money covers what the sale
  // expected. An excess or a shortfall both land in reconciliation: neither is
  // allowed to silently rewrite the sale, and a partial deposit must not make
  // the tender look paid while the customer still owes the rest.
  const covered = roundMoney(args.verifiedAmount) + 0.005 >= roundMoney(target.amount);
  const exact = covered && plan.surplusAmount <= 0.005;
  const status = exact ? 'manual_confirmed' : 'needs_reconciliation';
  const now = new Date().toISOString();

  db.transaction(tx => {
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
        and(
          eq(salePayments.id, args.salePaymentId),
          eq(salePayments.tenantId, args.tenantId)
        )
      )
      .run();
    writeAuditLog({
      tx,
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: 'sale_payment.transfer_manual_confirmed',
      resourceType: 'sale',
      resourceId: args.saleId,
      before: { confirmationStatus: target.confirmationStatus, amount: target.amount },
      after: {
        salePaymentId: args.salePaymentId,
        verifiedAmount: roundMoney(args.verifiedAmount),
        appliedAmount: plan.appliedAmount,
        surplusAmount: plan.surplusAmount,
        status,
        valueDate: args.valueDate,
        note: args.note,
        idempotencyKey: args.idempotencyKey ?? null,
      },
      ...(args.operationId !== undefined ? { operationId: args.operationId } : {}),
    });
  });

  return { appliedAmount: plan.appliedAmount, surplusAmount: plan.surplusAmount, status };
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
