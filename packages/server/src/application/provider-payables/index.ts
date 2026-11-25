import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { roundQuantity } from '@puntovivo/shared/unit-math';

import type { DatabaseInstance } from '../../db/index.js';
import {
  providerPayableAllocations,
  providerPayableCredits,
  providerPayableInvoicePurchases,
  providerPayableInvoices,
  providerPayablePayments,
  providers,
  purchaseItems,
  purchaseReturnItems,
  purchaseReturns,
  purchases,
  sites,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { readAvailableProviderPurchases } from './available-purchases.js';
/**
 * Backward-compatible cap on the overview preview. The invoice picker uses
 * its separate bounded, searchable endpoint; the overview still returns the
 * true count beside this preview as `availablePurchasesTotal`.
 */
const AVAILABLE_PURCHASES_LIMIT = 100;

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
  AvailableProviderPurchasesInput,
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

// Rows that are the parent of another row written by the same command — the
// invoice of its purchase links, a supplier payment or credit of its
// allocations — are enqueued narrowly above the ordinary manual-conflict
// default (5) so a remote drain cannot apply a child before its same-command
// parent when their created_at values land in the same millisecond. The
// children keep that default, which is what makes the pair ordered.
const PROVIDER_PAYABLE_PARENT_SYNC_PRIORITY = 5.1;

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

      // A purchase-linked invoice inherits the purchase's authoritative site,
      // so the ambient active site is only required when there is no purchase
      // to inherit from. Requiring it up front rejected linked invoices that
      // had a perfectly good site waiting to be read below.
      //
      // Consolidation: purchaseIds takes precedence over the legacy single
      // purchaseId and may carry several deliveries (remisiones) that one
      // final invoice covers. The legacy column keeps the single-purchase link
      // for compatibility; the bridge table is the complete source of truth.
      const linkedPurchaseIds = input.purchaseIds?.length
        ? input.purchaseIds
        : input.purchaseId
          ? [input.purchaseId]
          : [];

      let siteId: string;
      if (linkedPurchaseIds.length > 0) {
        const seenPurchaseIds = new Set<string>();
        const linkedSiteIds = new Set<string>();
        for (const purchaseId of linkedPurchaseIds) {
          if (seenPurchaseIds.has(purchaseId)) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'PROVIDER_PAYABLE_PURCHASE_DUPLICATED',
              message: 'A purchase cannot be listed twice in one invoice',
            });
          }
          seenPurchaseIds.add(purchaseId);
          const purchase = tx
            .select({
              id: purchases.id,
              providerId: purchases.providerId,
              siteId: purchases.siteId,
              status: purchases.status,
            })
            .from(purchases)
            .where(and(eq(purchases.id, purchaseId), eq(purchases.tenantId, ctx.tenantId)))
            .get();
          if (!purchase || purchase.providerId !== input.providerId) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'PROVIDER_PAYABLE_PURCHASE_MISMATCH',
              message: 'Purchase does not belong to the selected provider',
            });
          }
          if (purchase.status !== 'completed' && purchase.status !== 'partial_returned') {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'PROVIDER_PAYABLE_PURCHASE_NOT_COMPLETED',
              message:
                'Only a completed or partially returned purchase can be linked to a supplier invoice',
            });
          }
          // Invoiced twice is impossible: legacy column, bridge, either.
          const alreadyLinked =
            tx
              .select({ id: providerPayableInvoices.id })
              .from(providerPayableInvoices)
              .where(
                and(
                  eq(providerPayableInvoices.tenantId, ctx.tenantId),
                  eq(providerPayableInvoices.purchaseId, purchaseId)
                )
              )
              .get() ??
            tx
              .select({ id: providerPayableInvoicePurchases.id })
              .from(providerPayableInvoicePurchases)
              .where(
                and(
                  eq(providerPayableInvoicePurchases.tenantId, ctx.tenantId),
                  eq(providerPayableInvoicePurchases.purchaseId, purchaseId)
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
          linkedSiteIds.add(purchase.siteId);
        }
        if (linkedSiteIds.size > 1) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'PROVIDER_PAYABLE_PURCHASE_SITE_MISMATCH',
            message: 'Purchases consolidated by one invoice must belong to the same site',
          });
        }
        siteId = [...linkedSiteIds][0]!;
      } else {
        siteId = requireSiteId(ctx);
      }

      // Strict line-by-line reconciliation (owner decision D1): when invoice
      // lines are provided — mandatory when consolidating several purchases —
      // every product received across the linked purchases must match its
      // invoice line in base-unit quantity and in line total, and the lines
      // must add up to the invoice amount. Any difference rejects the invoice
      // with the per-product detail; accepting a difference stays an explicit
      // admin decision in a follow-up.
      if (input.lines?.length) {
        const received = tx
          .select({
            productId: purchaseItems.productId,
            baseQuantity: sql<number>`sum(${purchaseItems.quantity} * ${purchaseItems.unitEquivalence})`,
            lineTotal: sql<number>`sum(${purchaseItems.total})`,
          })
          .from(purchaseItems)
          .where(inArray(purchaseItems.purchaseId, linkedPurchaseIds))
          .groupBy(purchaseItems.productId)
          .all();
        const receivedByProduct = new Map(received.map(row => [row.productId, row]));

        // Goods sent back to the provider leave the store, so they cannot be
        // invoiced: what reconciles is received minus returned, in base units
        // and in value. Without this netting, a partially returned delivery
        // reconciled as if nothing had come back.
        const returned = tx
          .select({
            productId: purchaseReturnItems.productId,
            baseQuantity: sql<number>`sum(${purchaseReturnItems.quantity} * ${purchaseReturnItems.unitEquivalence})`,
            lineTotal: sql<number>`sum(${purchaseReturnItems.total})`,
          })
          .from(purchaseReturnItems)
          .innerJoin(purchaseReturns, eq(purchaseReturnItems.purchaseReturnId, purchaseReturns.id))
          .where(
            and(
              eq(purchaseReturns.tenantId, ctx.tenantId),
              inArray(purchaseReturns.purchaseId, linkedPurchaseIds)
            )
          )
          .groupBy(purchaseReturnItems.productId)
          .all();
        const returnedByProduct = new Map(returned.map(row => [row.productId, row]));

        const lineTotalsByProduct = new Map<string, { quantity: number; lineTotal: number }>();
        for (const line of input.lines) {
          const current = lineTotalsByProduct.get(line.productId) ?? { quantity: 0, lineTotal: 0 };
          const lineQuantity = current.quantity + line.quantity;
          const lineTotal = current.lineTotal + roundMoney(line.quantity * line.unitCost);
          lineTotalsByProduct.set(line.productId, { quantity: lineQuantity, lineTotal });
        }

        const discrepancies: string[] = [];
        const productIds = new Set([...receivedByProduct.keys(), ...lineTotalsByProduct.keys()]);
        for (const productId of productIds) {
          const receivedRow = receivedByProduct.get(productId);
          const returnedRow = returnedByProduct.get(productId);
          const invoiceRow = lineTotalsByProduct.get(productId);
          const receivedQuantity = receivedRow ? Number(receivedRow.baseQuantity) : 0;
          const returnedQuantity = returnedRow ? Number(returnedRow.baseQuantity) : 0;
          const netQuantity = roundQuantity(receivedQuantity - returnedQuantity, 12);
          const receivedTotal = receivedRow ? roundMoney(Number(receivedRow.lineTotal)) : 0;
          const returnedTotal = returnedRow ? roundMoney(Number(returnedRow.lineTotal)) : 0;
          const netTotal = roundMoney(receivedTotal - returnedTotal);
          const invoiceQuantity = invoiceRow?.quantity ?? 0;
          const invoiceTotal = invoiceRow ? roundMoney(invoiceRow.lineTotal) : 0;
          if (Math.abs(netQuantity - invoiceQuantity) > 1e-9) {
            discrepancies.push(
              `product ${productId}: invoiced ${invoiceQuantity} but received ${netQuantity} base units after ${returnedQuantity} returned`
            );
          } else if (Math.abs(netTotal - invoiceTotal) > 0.005) {
            discrepancies.push(
              `product ${productId}: invoiced ${invoiceTotal.toFixed(2)} but received ${netTotal.toFixed(2)} after ${returnedTotal.toFixed(2)} returned`
            );
          }
        }
        if (discrepancies.length > 0) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'PROVIDER_PAYABLE_INVOICE_LINES_MISMATCH',
            message: `Invoice lines do not match the received goods: ${discrepancies.join('; ')}`,
          });
        }

        const linesTotal = roundMoney(
          [...lineTotalsByProduct.values()].reduce((sum, row) => sum + row.lineTotal, 0)
        );
        if (Math.abs(linesTotal - amount) > 0.005) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'PROVIDER_PAYABLE_INVOICE_AMOUNT_MISMATCH',
            message: `Invoice amount ${amount.toFixed(2)} does not match its lines total ${linesTotal.toFixed(2)}`,
          });
        }
      }

      tx.insert(providerPayableInvoices)
        .values({
          id: invoiceId,
          tenantId: ctx.tenantId,
          providerId: input.providerId,
          siteId,
          purchaseId: linkedPurchaseIds.length === 1 ? linkedPurchaseIds[0]! : null,
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

      // The bridge is the complete source of truth: every linked purchase,
      // legacy-single or consolidated, lands here.
      const invoicePurchaseLinkIdsByPurchase = new Map<string, string>();
      for (const purchaseId of linkedPurchaseIds) {
        const linkId = nanoid();
        invoicePurchaseLinkIdsByPurchase.set(purchaseId, linkId);
        tx.insert(providerPayableInvoicePurchases)
          .values({
            id: linkId,
            tenantId: ctx.tenantId,
            invoiceId,
            purchaseId,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
      }

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
          purchaseId: linkedPurchaseIds.length === 1 ? linkedPurchaseIds[0]! : null,
          purchaseIds: linkedPurchaseIds,
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
        data: { id: invoiceId, providerId: input.providerId, siteId, amount, purchaseIds: linkedPurchaseIds },
        priority: PROVIDER_PAYABLE_PARENT_SYNC_PRIORITY,
      });
      // Parent-before-child: each covered purchase link follows its invoice so
      // a synced copy can reconstruct what the consolidating factura covers —
      // the legacy column alone cannot carry several purchases. The links keep
      // the manual default priority, below the invoice above them.
      for (const purchaseId of linkedPurchaseIds) {
        enqueueSyncInTransaction(syncContext(ctx, tx), {
          entityType: 'provider_payable_invoice_purchases',
          entityId: invoicePurchaseLinkIdsByPurchase.get(purchaseId)!,
          operation: 'create',
          data: { invoiceId, purchaseId },
        });
      }
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
        priority: PROVIDER_PAYABLE_PARENT_SYNC_PRIORITY,
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
        priority: PROVIDER_PAYABLE_PARENT_SYNC_PRIORITY,
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

  // Preserve the legacy overview projection while the searchable picker uses
  // its own bounded endpoint instead of re-fetching the entire account ledger.
  const purchasePage = readAvailableProviderPurchases(db, tenantId, {
    providerId,
    search: '',
    page: 1,
    perPage: AVAILABLE_PURCHASES_LIMIT,
  });
  const availablePurchases = purchasePage.items;
  const availablePurchasesTotal = purchasePage.total;

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
    availablePurchasesTotal,
    availablePurchasesTruncated: availablePurchasesTotal > availablePurchases.length,
  };
}

/** Manager-facing picker; the full overview remains backward compatible. */
export function listAvailableProviderPurchases(
  db: DatabaseInstance,
  tenantId: string,
  input: AvailableProviderPurchasesInput
) {
  assertProvider(db, tenantId, input.providerId);
  return readAvailableProviderPurchases(db, tenantId, input);
}
