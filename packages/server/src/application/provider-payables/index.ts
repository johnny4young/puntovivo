import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  providerPayableAllocations,
  providerPayableCredits,
  providerPayableInvoices,
  providerPayablePayments,
  providers,
  purchases,
  sites,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { calendarDayInTimeZone } from '../../services/reports/day-window.js';
import {
  assertCashSessionStillOpen,
  insertCashMovement,
  requireActiveCashSession,
} from '../../services/cash-session.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';
import type {
  CreateProviderInvoiceInput,
  CreateProviderOpeningBalanceInput,
  RecordProviderCreditInput,
  RecordProviderPaymentInput,
} from '../../trpc/schemas/providerPayables.js';

export interface CriticalProviderPayableContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  user: { id: string };
  envelope: { operationId: string; idempotencyKey: string };
  deviceId: string;
  completeInTransaction: (db: DatabaseInstance, resultRef: unknown) => void;
}

type AllocationInput = { invoiceId: string; amount: number };

// Allocation rows reference their payment/credit source. Give the source a
// narrowly higher priority than the ordinary manual-conflict default (5) so a
// remote drain cannot apply a child before its same-command parent when their
// created_at values land in the same millisecond.
const PROVIDER_PAYABLE_SOURCE_SYNC_PRIORITY = 5.1;

function requireSiteId(ctx: Pick<CriticalProviderPayableContext, 'siteId'>): string {
  if (!ctx.siteId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PROVIDER_PAYABLE_SITE_REQUIRED',
      message: 'An active site is required',
    });
  }
  return ctx.siteId;
}

function assertProvider(tx: DatabaseInstance, tenantId: string, providerId: string): void {
  const row = tx
    .select({ id: providers.id })
    .from(providers)
    .where(and(eq(providers.id, providerId), eq(providers.tenantId, tenantId)))
    .get();
  if (!row) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'PROVIDER_PAYABLE_PROVIDER_NOT_FOUND',
      message: 'Provider not found',
    });
  }
}

function assertDocumentAvailable(
  tx: DatabaseInstance,
  tenantId: string,
  providerId: string,
  documentNumber: string,
  kind: 'invoice' | 'credit'
): void {
  const table = kind === 'invoice' ? providerPayableInvoices : providerPayableCredits;
  const existing = tx
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.tenantId, tenantId),
        eq(table.providerId, providerId),
        eq(table.documentNumber, documentNumber)
      )
    )
    .get();
  if (existing) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PROVIDER_PAYABLE_DOCUMENT_DUPLICATE',
      message: 'The supplier document number is already registered',
    });
  }
}

function syncContext(ctx: CriticalProviderPayableContext, tx: DatabaseInstance) {
  return { ...ctx, db: tx };
}

export function createProviderInvoice(
  ctx: CriticalProviderPayableContext,
  input: CreateProviderInvoiceInput
) {
  const now = new Date().toISOString();
  const invoiceId = nanoid();
  const amount = roundMoney(input.amount);

  return ctx.db.transaction(
    tx => {
      assertProvider(tx, ctx.tenantId, input.providerId);
      assertDocumentAvailable(tx, ctx.tenantId, input.providerId, input.documentNumber, 'invoice');

      let siteId = requireSiteId(ctx);
      if (input.purchaseId) {
        const purchase = tx
          .select({
            id: purchases.id,
            providerId: purchases.providerId,
            siteId: purchases.siteId,
            status: purchases.status,
          })
          .from(purchases)
          .where(and(eq(purchases.id, input.purchaseId), eq(purchases.tenantId, ctx.tenantId)))
          .get();
        if (!purchase || purchase.providerId !== input.providerId) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'PROVIDER_PAYABLE_PURCHASE_MISMATCH',
            message: 'Purchase does not belong to the selected provider',
          });
        }
        if (purchase.status !== 'completed') {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'PROVIDER_PAYABLE_PURCHASE_NOT_COMPLETED',
            message: 'Only a completed purchase can be linked to a supplier invoice',
          });
        }
        const alreadyLinked = tx
          .select({ id: providerPayableInvoices.id })
          .from(providerPayableInvoices)
          .where(
            and(
              eq(providerPayableInvoices.tenantId, ctx.tenantId),
              eq(providerPayableInvoices.purchaseId, input.purchaseId)
            )
          )
          .get();
        if (alreadyLinked) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'PROVIDER_PAYABLE_PURCHASE_ALREADY_INVOICED',
            message: 'Purchase already has a supplier invoice',
          });
        }
        siteId = purchase.siteId;
      }

      tx.insert(providerPayableInvoices)
        .values({
          id: invoiceId,
          tenantId: ctx.tenantId,
          providerId: input.providerId,
          siteId,
          purchaseId: input.purchaseId ?? null,
          kind: 'invoice',
          documentNumber: input.documentNumber,
          issuedAt: input.issuedAt,
          dueAt: input.dueAt,
          amount,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'provider_payable.invoice.create',
        resourceType: 'provider_payable',
        resourceId: invoiceId,
        before: null,
        after: {
          providerId: input.providerId,
          purchaseId: input.purchaseId ?? null,
          documentNumber: input.documentNumber,
          amount,
          dueAt: input.dueAt,
        },
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(syncContext(ctx, tx), {
        entityType: 'provider_payable_invoices',
        entityId: invoiceId,
        operation: 'create',
        data: { id: invoiceId, providerId: input.providerId, siteId, amount },
      });
      const result = { id: invoiceId, providerId: input.providerId, amount };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export function createProviderOpeningBalance(
  ctx: CriticalProviderPayableContext,
  input: CreateProviderOpeningBalanceInput
) {
  const now = new Date().toISOString();
  const invoiceId = nanoid();
  const siteId = requireSiteId(ctx);
  const amount = roundMoney(input.amount);
  const documentNumber = `OPEN-${input.asOf.slice(0, 10)}-${invoiceId.slice(-6).toUpperCase()}`;

  return ctx.db.transaction(
    tx => {
      assertProvider(tx, ctx.tenantId, input.providerId);
      tx.insert(providerPayableInvoices)
        .values({
          id: invoiceId,
          tenantId: ctx.tenantId,
          providerId: input.providerId,
          siteId,
          purchaseId: null,
          kind: 'opening_balance',
          documentNumber,
          issuedAt: input.asOf,
          dueAt: input.dueAt,
          amount,
          notes: input.note,
          createdBy: ctx.user.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'provider_payable.opening.create',
        resourceType: 'provider_payable',
        resourceId: invoiceId,
        before: null,
        after: { providerId: input.providerId, documentNumber, amount, asOf: input.asOf },
        metadata: { note: input.note },
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(syncContext(ctx, tx), {
        entityType: 'provider_payable_invoices',
        entityId: invoiceId,
        operation: 'create',
        data: {
          id: invoiceId,
          providerId: input.providerId,
          siteId,
          amount,
          kind: 'opening_balance',
        },
      });
      const result = { id: invoiceId, providerId: input.providerId, amount };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

function insertAllocations(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    providerId: string;
    actorId: string;
    sourceType: 'payment' | 'credit';
    sourceId: string;
    sourceAmount: number;
    allocations: AllocationInput[];
    now: string;
    sync: ReturnType<typeof syncContext>;
  }
): string[] {
  const allocationTotal = roundMoney(
    args.allocations.reduce((sum, allocation) => sum + roundMoney(allocation.amount), 0)
  );
  if (allocationTotal !== args.sourceAmount) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PROVIDER_PAYABLE_ALLOCATION_TOTAL_MISMATCH',
      message: 'The allocations must equal the payment or credit amount',
      details: { amount: args.sourceAmount, allocated: allocationTotal },
    });
  }

  const invoiceIds = args.allocations.map(allocation => allocation.invoiceId);
  if (new Set(invoiceIds).size !== invoiceIds.length) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PROVIDER_PAYABLE_ALLOCATION_DUPLICATE',
      message: 'Each invoice can be allocated only once per transaction',
    });
  }
  const invoices = tx
    .select({ id: providerPayableInvoices.id, amount: providerPayableInvoices.amount })
    .from(providerPayableInvoices)
    .where(
      and(
        eq(providerPayableInvoices.tenantId, args.tenantId),
        eq(providerPayableInvoices.providerId, args.providerId),
        inArray(providerPayableInvoices.id, invoiceIds)
      )
    )
    .all();
  if (invoices.length !== invoiceIds.length) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'PROVIDER_PAYABLE_INVOICE_NOT_FOUND',
      message: 'One or more supplier invoices were not found',
    });
  }
  const allocatedRows = tx
    .select({
      invoiceId: providerPayableAllocations.invoiceId,
      amount: sql<number>`COALESCE(SUM(${providerPayableAllocations.amount}), 0)`,
    })
    .from(providerPayableAllocations)
    .where(
      and(
        eq(providerPayableAllocations.tenantId, args.tenantId),
        inArray(providerPayableAllocations.invoiceId, invoiceIds)
      )
    )
    .groupBy(providerPayableAllocations.invoiceId)
    .all();
  const alreadyAllocated = new Map(
    allocatedRows.map(row => [row.invoiceId, roundMoney(Number(row.amount))] as const)
  );
  const invoiceById = new Map(invoices.map(invoice => [invoice.id, invoice] as const));
  const allocationIds: string[] = [];
  for (const allocation of args.allocations) {
    const amount = roundMoney(allocation.amount);
    const invoice = invoiceById.get(allocation.invoiceId)!;
    const outstanding = roundMoney(invoice.amount - (alreadyAllocated.get(invoice.id) ?? 0));
    if (amount > outstanding) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PROVIDER_PAYABLE_ALLOCATION_EXCEEDS_OUTSTANDING',
        message: 'Allocation exceeds the invoice outstanding amount',
        details: { invoiceId: invoice.id, outstanding, amount },
      });
    }
    const allocationId = nanoid();
    tx.insert(providerPayableAllocations)
      .values({
        id: allocationId,
        tenantId: args.tenantId,
        providerId: args.providerId,
        invoiceId: invoice.id,
        sourceType: args.sourceType,
        paymentId: args.sourceType === 'payment' ? args.sourceId : null,
        creditId: args.sourceType === 'credit' ? args.sourceId : null,
        amount,
        createdBy: args.actorId,
        syncStatus: 'pending',
        syncVersion: 1,
        createdAt: args.now,
      })
      .run();
    enqueueSyncInTransaction(args.sync, {
      entityType: 'provider_payable_allocations',
      entityId: allocationId,
      operation: 'create',
      data: {
        id: allocationId,
        providerId: args.providerId,
        invoiceId: invoice.id,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        amount,
      },
    });
    allocationIds.push(allocationId);
  }
  return allocationIds;
}

export async function recordProviderPayment(
  ctx: CriticalProviderPayableContext,
  input: RecordProviderPaymentInput
) {
  const now = new Date().toISOString();
  const paymentId = nanoid();
  const siteId = requireSiteId(ctx);
  const amount = roundMoney(input.amount);
  // A supplier payment marked as cash is a real drawer outflow. Bind it to
  // the authenticated operator's active session before reserving the writer;
  // non-cash methods remain independent from the drawer.
  const activeCashSession =
    input.method === 'cash'
      ? await requireActiveCashSession(ctx.db, ctx.tenantId, siteId, ctx.user.id)
      : null;
  return ctx.db.transaction(
    tx => {
      assertProvider(tx, ctx.tenantId, input.providerId);
      tx.insert(providerPayablePayments)
        .values({
          id: paymentId,
          tenantId: ctx.tenantId,
          providerId: input.providerId,
          siteId,
          amount,
          method: input.method,
          reference: input.reference ?? null,
          paidAt: input.paidAt,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();
      enqueueSyncInTransaction(syncContext(ctx, tx), {
        entityType: 'provider_payable_payments',
        entityId: paymentId,
        operation: 'create',
        data: { id: paymentId, providerId: input.providerId, siteId, amount },
        priority: PROVIDER_PAYABLE_SOURCE_SYNC_PRIORITY,
      });
      const allocationIds = insertAllocations(tx, {
        tenantId: ctx.tenantId,
        providerId: input.providerId,
        actorId: ctx.user.id,
        sourceType: 'payment',
        sourceId: paymentId,
        sourceAmount: amount,
        allocations: input.allocations,
        now,
        sync: syncContext(ctx, tx),
      });
      let cashMovementId: string | null = null;
      if (activeCashSession) {
        assertCashSessionStillOpen(tx, ctx.tenantId, activeCashSession.id);
        cashMovementId = insertCashMovement({
          tx,
          tenantId: ctx.tenantId,
          sessionId: activeCashSession.id,
          type: 'paid_out',
          amount,
          referenceId: paymentId,
          note: `Supplier payment ${input.reference ?? paymentId}`,
          createdBy: ctx.user.id,
          createdAt: now,
        });
        if (!cashMovementId) {
          throwServerError({
            trpcCode: 'INTERNAL_SERVER_ERROR',
            errorCode: 'CASH_MOVEMENT_PERSIST_FAILED',
            message: 'Failed to persist the supplier cash payment movement',
          });
        }
      }
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'provider_payable.payment.create',
        resourceType: 'provider_payable',
        resourceId: paymentId,
        before: null,
        after: { providerId: input.providerId, amount, method: input.method },
        metadata: {
          invoiceIds: input.allocations.map(allocation => allocation.invoiceId),
          cashMovementId,
        },
        operationId: ctx.envelope.operationId,
      });
      const result = {
        id: paymentId,
        providerId: input.providerId,
        amount,
        allocationIds,
        cashMovementId,
      };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export function recordProviderCredit(
  ctx: CriticalProviderPayableContext,
  input: RecordProviderCreditInput
) {
  const now = new Date().toISOString();
  const creditId = nanoid();
  const siteId = requireSiteId(ctx);
  const amount = roundMoney(input.amount);
  return ctx.db.transaction(
    tx => {
      assertProvider(tx, ctx.tenantId, input.providerId);
      assertDocumentAvailable(tx, ctx.tenantId, input.providerId, input.documentNumber, 'credit');
      tx.insert(providerPayableCredits)
        .values({
          id: creditId,
          tenantId: ctx.tenantId,
          providerId: input.providerId,
          siteId,
          amount,
          documentNumber: input.documentNumber,
          creditedAt: input.creditedAt,
          reason: input.reason,
          createdBy: ctx.user.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();
      enqueueSyncInTransaction(syncContext(ctx, tx), {
        entityType: 'provider_payable_credits',
        entityId: creditId,
        operation: 'create',
        data: { id: creditId, providerId: input.providerId, siteId, amount },
        priority: PROVIDER_PAYABLE_SOURCE_SYNC_PRIORITY,
      });
      const allocationIds = insertAllocations(tx, {
        tenantId: ctx.tenantId,
        providerId: input.providerId,
        actorId: ctx.user.id,
        sourceType: 'credit',
        sourceId: creditId,
        sourceAmount: amount,
        allocations: input.allocations,
        now,
        sync: syncContext(ctx, tx),
      });
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'provider_payable.credit.create',
        resourceType: 'provider_payable',
        resourceId: creditId,
        before: null,
        after: {
          providerId: input.providerId,
          documentNumber: input.documentNumber,
          amount,
        },
        metadata: { invoiceIds: input.allocations.map(allocation => allocation.invoiceId) },
        operationId: ctx.envelope.operationId,
      });
      const result = { id: creditId, providerId: input.providerId, amount, allocationIds };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

function businessDayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
  return Number.isFinite(day) ? day : null;
}

function currentBusinessDayNumber(now: Date, timeZone: string): number {
  const currentDay = businessDayNumber(calendarDayInTimeZone(now, timeZone));
  if (currentDay === null) {
    throw new Error('Resolved tenant calendar day is invalid');
  }
  return currentDay;
}

export async function getProviderPayableOverview(
  db: DatabaseInstance,
  tenantId: string,
  providerId: string,
  now = new Date()
) {
  assertProvider(db, tenantId, providerId);
  const tenantLocale = await resolveTenantLocale(db, tenantId);
  const invoices = db
    .select({
      id: providerPayableInvoices.id,
      kind: providerPayableInvoices.kind,
      documentNumber: providerPayableInvoices.documentNumber,
      purchaseId: providerPayableInvoices.purchaseId,
      purchaseNumber: purchases.purchaseNumber,
      siteId: providerPayableInvoices.siteId,
      siteName: sites.name,
      issuedAt: providerPayableInvoices.issuedAt,
      dueAt: providerPayableInvoices.dueAt,
      amount: providerPayableInvoices.amount,
      notes: providerPayableInvoices.notes,
      createdAt: providerPayableInvoices.createdAt,
    })
    .from(providerPayableInvoices)
    .innerJoin(sites, eq(providerPayableInvoices.siteId, sites.id))
    .leftJoin(
      purchases,
      and(
        eq(providerPayableInvoices.purchaseId, purchases.id),
        eq(purchases.tenantId, tenantId),
        eq(purchases.providerId, providerId)
      )
    )
    .where(
      and(
        eq(providerPayableInvoices.tenantId, tenantId),
        eq(providerPayableInvoices.providerId, providerId),
        eq(sites.tenantId, tenantId)
      )
    )
    .orderBy(asc(providerPayableInvoices.dueAt), asc(providerPayableInvoices.createdAt))
    .all();
  const providerInvoiceIds = db
    .select({ id: providerPayableInvoices.id })
    .from(providerPayableInvoices)
    .where(
      and(
        eq(providerPayableInvoices.tenantId, tenantId),
        eq(providerPayableInvoices.providerId, providerId)
      )
    );
  const allocations = db
    .select({
      invoiceId: providerPayableAllocations.invoiceId,
      amount: sql<number>`COALESCE(SUM(${providerPayableAllocations.amount}), 0)`,
    })
    .from(providerPayableAllocations)
    .where(
      and(
        eq(providerPayableAllocations.tenantId, tenantId),
        eq(providerPayableAllocations.providerId, providerId),
        inArray(providerPayableAllocations.invoiceId, providerInvoiceIds)
      )
    )
    .groupBy(providerPayableAllocations.invoiceId)
    .all();
  const allocatedByInvoice = new Map(
    allocations.map(row => [row.invoiceId, roundMoney(Number(row.amount))] as const)
  );
  const openInvoices = invoices
    .map(invoice => {
      const allocated = allocatedByInvoice.get(invoice.id) ?? 0;
      const outstanding = roundMoney(invoice.amount - allocated);
      return {
        ...invoice,
        allocated,
        outstanding,
        status:
          outstanding <= 0
            ? ('paid' as const)
            : allocated > 0
              ? ('partial' as const)
              : ('open' as const),
      };
    })
    .filter(invoice => invoice.outstanding > 0);

  const paymentTotal = Number(
    db
      .select({ amount: sql<number>`COALESCE(SUM(${providerPayablePayments.amount}), 0)` })
      .from(providerPayablePayments)
      .where(
        and(
          eq(providerPayablePayments.tenantId, tenantId),
          eq(providerPayablePayments.providerId, providerId)
        )
      )
      .get()?.amount ?? 0
  );
  const creditTotal = Number(
    db
      .select({ amount: sql<number>`COALESCE(SUM(${providerPayableCredits.amount}), 0)` })
      .from(providerPayableCredits)
      .where(
        and(
          eq(providerPayableCredits.tenantId, tenantId),
          eq(providerPayableCredits.providerId, providerId)
        )
      )
      .get()?.amount ?? 0
  );
  const invoiceTotal = roundMoney(invoices.reduce((sum, invoice) => sum + invoice.amount, 0));
  const aging = { current: 0, days1To30: 0, days31To60: 0, days61To90: 0, daysOver90: 0 };
  const today = currentBusinessDayNumber(now, tenantLocale.timezone);
  for (const invoice of openInvoices) {
    const dueDay = businessDayNumber(invoice.dueAt);
    const days = dueDay === null ? 0 : Math.max(0, today - dueDay);
    const key =
      dueDay === null || dueDay >= today
        ? 'current'
        : days <= 30
          ? 'days1To30'
          : days <= 60
            ? 'days31To60'
            : days <= 90
              ? 'days61To90'
              : 'daysOver90';
    aging[key] = roundMoney(aging[key] + invoice.outstanding);
  }

  const payments = db
    .select({
      id: providerPayablePayments.id,
      occurredAt: providerPayablePayments.paidAt,
      amount: providerPayablePayments.amount,
      reference: providerPayablePayments.reference,
      notes: providerPayablePayments.notes,
      method: providerPayablePayments.method,
      createdAt: providerPayablePayments.createdAt,
    })
    .from(providerPayablePayments)
    .where(
      and(
        eq(providerPayablePayments.tenantId, tenantId),
        eq(providerPayablePayments.providerId, providerId)
      )
    )
    .all();
  const credits = db
    .select({
      id: providerPayableCredits.id,
      occurredAt: providerPayableCredits.creditedAt,
      amount: providerPayableCredits.amount,
      documentNumber: providerPayableCredits.documentNumber,
      reason: providerPayableCredits.reason,
      createdAt: providerPayableCredits.createdAt,
    })
    .from(providerPayableCredits)
    .where(
      and(
        eq(providerPayableCredits.tenantId, tenantId),
        eq(providerPayableCredits.providerId, providerId)
      )
    )
    .all();
  const chronological = [
    ...invoices.map(invoice => ({
      id: invoice.id,
      kind:
        invoice.kind === 'opening_balance' ? ('opening_balance' as const) : ('invoice' as const),
      occurredAt: invoice.issuedAt,
      amount: invoice.amount,
      reference: invoice.documentNumber,
      note: invoice.notes,
      recordedAt: invoice.createdAt,
      sortOrder: 0,
    })),
    ...payments.map(payment => ({
      id: payment.id,
      kind: 'payment' as const,
      occurredAt: payment.occurredAt,
      amount: -payment.amount,
      reference: payment.reference ?? payment.method,
      note: payment.notes,
      recordedAt: payment.createdAt,
      sortOrder: 2,
    })),
    ...credits.map(credit => ({
      id: credit.id,
      kind: 'credit' as const,
      occurredAt: credit.occurredAt,
      amount: -credit.amount,
      reference: credit.documentNumber,
      note: credit.reason,
      recordedAt: credit.createdAt,
      sortOrder: 1,
    })),
  ].sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) ||
      a.sortOrder - b.sortOrder ||
      a.recordedAt.localeCompare(b.recordedAt) ||
      a.id.localeCompare(b.id)
  );
  let running = 0;
  const statement = chronological
    .map(({ recordedAt: _recordedAt, sortOrder: _sortOrder, ...entry }) => {
      running = roundMoney(running + entry.amount);
      return { ...entry, balanceAfter: running };
    })
    .reverse();

  const availablePurchases = db
    .select({
      id: purchases.id,
      purchaseNumber: purchases.purchaseNumber,
      total: purchases.total,
      siteId: purchases.siteId,
      siteName: sites.name,
      createdAt: purchases.createdAt,
    })
    .from(purchases)
    .innerJoin(sites, eq(purchases.siteId, sites.id))
    .leftJoin(
      providerPayableInvoices,
      and(
        eq(providerPayableInvoices.tenantId, tenantId),
        eq(providerPayableInvoices.purchaseId, purchases.id)
      )
    )
    .where(
      and(
        eq(purchases.tenantId, tenantId),
        eq(purchases.providerId, providerId),
        eq(purchases.status, 'completed'),
        eq(sites.tenantId, tenantId),
        isNull(providerPayableInvoices.id)
      )
    )
    .orderBy(desc(purchases.createdAt))
    .limit(100)
    .all();

  return {
    totals: {
      invoices: invoiceTotal,
      payments: roundMoney(paymentTotal),
      credits: roundMoney(creditTotal),
      balance: roundMoney(invoiceTotal - paymentTotal - creditTotal),
    },
    aging,
    invoices: invoices.map(invoice => {
      const allocated = allocatedByInvoice.get(invoice.id) ?? 0;
      const outstanding = roundMoney(invoice.amount - allocated);
      return {
        ...invoice,
        allocated,
        outstanding,
        status:
          outstanding <= 0
            ? ('paid' as const)
            : allocated > 0
              ? ('partial' as const)
              : ('open' as const),
      };
    }),
    openInvoices,
    statement,
    availablePurchases,
  };
}
