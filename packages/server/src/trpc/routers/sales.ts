/**
 * Sales tRPC Router
 *
 * Sales management with transactional creation.
 *
 * Procedures:
 * - sales.list       (tenant) - List sales with pagination/filtering
 * - sales.getById    (tenant) - Get a single sale with items
 * - sales.create     (tenant) - Create sale + items + inventory movements (transaction)
 * - sales.update     (tenant) - Update payment method/status/notes
 * - sales.returnSale (tenant, manager/admin) - Refund a completed sale and restore stock
 * - sales.void       (tenant, admin) - Void a sale
 *
 * @module trpc/routers/sales
 */

import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import {
  criticalCommandAdminProcedure,
  criticalCommandCashierManagerOrAdminProcedure,
  criticalCommandManagerOrAdminProcedure,
  criticalCommandProcedure,
} from '../middleware/criticalCommand.js';
import {
  cashMovements,
  cashSessions,
  customers,
  fiscalDocuments,
  inventoryMovements,
  products,
  saleItems,
  saleReturns,
  sales,
  syncQueue,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { Context } from '../context.js';
import {
  completeDraftInput,
  createSaleInput,
  discardDraftInput,
  getForReprintInput,
  getSaleInput,
  listDraftsInput,
  listSalesInput,
  resumeSaleInput,
  returnSaleInput,
  suspendSaleInput,
  updateSaleInput,
  voidSaleInput,
} from '../schemas/sales.js';
import { requireActiveCashSession } from '../../services/cash-session.js';
import { getCashMovementSignedAmount } from '../../services/cash-session.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { applyInventoryBalanceDelta } from '../../services/inventory-balances.js';
import { safelyEmitFiscalDocument } from '../../services/fiscal/orchestrator.js';
import { createModuleLogger } from '../../logging/logger.js';
// ENG-054 — `sales.create` and `sales.completeDraft` orchestration now
// lives in `application/sales/completeSale`. The router keeps the
// other procedures (returnSale, void, suspend, resume, listDrafts,
// discardDraft, getForReprint) inline while ENG-055 finishes the
// extraction.
import { completeSale } from '../../application/sales/completeSale.js';
import { getSaleRecord } from '../../application/sales/sale-read.js';

const fiscalRouterLog = createModuleLogger('routers/sales/fiscal');

/**
 * ENG-042 TOCTOU defense for sale lifecycle transactions.
 *
 * `requireActiveCashSession(...)` runs OUTSIDE the transaction (as a
 * fast-fail UX guard, so the common no-session case never opens a
 * BEGIN). This helper re-validates the session is still open against
 * the in-transaction snapshot before any sale write touches
 * `cashSessionId`. Without it, a concurrent `cashSessions.close` between
 * the outer check and the transaction body would silently bind the new
 * sale (or refund / completion) to a now-closed shift.
 *
 * better-sqlite3 single-process serialization keeps the production
 * window small but not zero, and the libSQL/Turso replication planned
 * in ENG-037 will widen it. The defense is also structurally correct
 * for any future runtime (Bun, Deno, multi-process) the project may
 * adopt.
 *
 * Throws `CASH_SESSION_REQUIRED` (already wired in en + es locales) and
 * relies on Drizzle to propagate the throw out of the transaction with
 * rollback intact.
 */
function assertCashSessionStillOpen(
  tx: Pick<DatabaseInstance, 'select'>,
  tenantId: string,
  cashSessionId: string
): void {
  const stillOpen = tx
    .select({ id: cashSessions.id })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.id, cashSessionId),
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.status, 'open')
      )
    )
    .get();

  if (!stillOpen) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_REQUIRED',
      message:
        'Cash session was closed between the precondition check and the transaction body',
      details: { cashSessionId },
    });
  }
}

/**
 * ENG-054 — Local helper that adapts the tRPC `Context` to the
 * `safelyEmitFiscalDocument` signature exported from
 * `services/fiscal/orchestrator`. Keeps the four legacy callsites
 * (returnSale, void, suspend → resume → discardDraft path) compact
 * without leaking the orchestrator's primitive shape across the file.
 */
async function safelyEmitFiscalForCtx(
  ctx: Context,
  args: {
    source: 'sale' | 'return' | 'void';
    sourceId: string;
    saleId: string;
    kind: 'DEE' | 'NC' | 'ND';
    originalCufe?: string;
    reasonCode?: string;
  }
): Promise<void> {
  if (!ctx.tenantId || !ctx.user) return;
  await safelyEmitFiscalDocument({
    db: ctx.db,
    tenantId: ctx.tenantId,
    userId: ctx.user.id,
    log: ctx.req?.server?.log ?? fiscalRouterLog,
    source: args.source,
    sourceId: args.sourceId,
    saleId: args.saleId,
    kind: args.kind,
    originalCufe: args.originalCufe,
    reasonCode: args.reasonCode,
  });
}

// ENG-054 — pure policy primitives + resolved-line / sequential
// types moved to `application/sales/policies.ts` and
// `application/sales/completeSale.ts`. Helpers used only by the
// remaining router-resident procedures (returnSale, void,
// suspend/resume/discardDraft) stay below.

function getNormalizedSaleQuantity(quantity: number, equivalence: number) {
  const normalizedQuantity = quantity * equivalence;

  if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_QUANTITY_NONPOSITIVE',
      message: 'The selected quantity must resolve to a positive stock quantity',
    });
  }

  return normalizedQuantity;
}

function buildVoidedSaleNotes(existingNotes: string | null, reason: string | undefined) {
  if (!reason) {
    return existingNotes;
  }

  return `${existingNotes ? `${existingNotes} | ` : ''}Voided: ${reason}`;
}

function buildReturnedSaleNotes(existingNotes: string | null, reason: string | undefined) {
  if (!reason) {
    return existingNotes;
  }

  return `${existingNotes ? `${existingNotes} | ` : ''}Refunded: ${reason}`;
}

function getPersistedCashContribution(sale: {
  paymentMethod: 'cash' | 'card' | 'transfer' | 'credit' | 'other';
  paymentStatus: 'pending' | 'paid' | 'partial' | 'refunded';
  total: number;
}) {
  if (sale.paymentMethod !== 'cash') {
    return 0;
  }

  if (sale.paymentStatus === 'pending' || sale.paymentStatus === 'refunded') {
    return 0;
  }

  return sale.total;
}

function insertCashMovement(args: {
  tx: Context['db'];
  tenantId: string;
  sessionId: string;
  type: 'sale' | 'refund';
  amount: number;
  referenceId: string;
  note: string;
  createdBy: string;
  createdAt: string;
}) {
  if (args.amount <= 0) {
    return;
  }

  args.tx
    .insert(cashMovements)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      sessionId: args.sessionId,
      type: args.type,
      amount: args.amount,
      referenceId: args.referenceId,
      note: args.note,
      createdBy: args.createdBy,
      createdAt: args.createdAt,
    })
    .run();

  args.tx
    .update(cashSessions)
    .set({
      expectedBalance: sql`${cashSessions.expectedBalance} + ${getCashMovementSignedAmount(args.type, args.amount)}`,
      updatedAt: args.createdAt,
    })
    .where(eq(cashSessions.id, args.sessionId))
    .run();
}

function getRevenueEligibleSaleConditions(tenantId: string) {
  return [
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'completed'),
    sql`${sales.paymentStatus} != 'refunded'`,
  ] as const;
}

// ENG-054 — `getSaleSequentialContext`, `validateCustomer`, and
// `resolveSaleItems` were moved to `application/sales/completeSale.ts`
// because only the fresh-sale path used them. ENG-055 will move the
// remaining legacy helpers (`assertCashSessionStillOpen`,
// `getNormalizedSaleQuantity`, `insertCashMovement`) when it extracts
// returnSale / voidSale / discardDraft.

export const salesRouter = router({
  summary: tenantProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const completedSaleConditions = getRevenueEligibleSaleConditions(ctx.tenantId);

    const [today, totals, pending] = await Promise.all([
      ctx.db
        .select({
          total: sql<number>`coalesce(sum(${sales.total}), 0)`,
        })
        .from(sales)
        .where(
          and(
            ...completedSaleConditions,
            gte(sales.createdAt, startOfToday.toISOString()),
            lte(sales.createdAt, endOfToday.toISOString())
          )
        )
        .get(),
      ctx.db
        .select({
          transactionCount: sql<number>`count(*)`,
          grossTotal: sql<number>`coalesce(sum(${sales.total}), 0)`,
        })
        .from(sales)
        .where(and(...completedSaleConditions))
        .get(),
      ctx.db
        .select({
          total: sql<number>`coalesce(sum(${sales.total}), 0)`,
        })
        .from(sales)
        .where(and(...completedSaleConditions, eq(sales.paymentStatus, 'pending')))
        .get(),
    ]);

    const transactionCount = totals?.transactionCount ?? 0;
    const grossTotal = totals?.grossTotal ?? 0;

    return {
      todaySalesTotal: today?.total ?? 0,
      transactionCount,
      averageOrder: transactionCount > 0 ? grossTotal / transactionCount : 0,
      pendingPaymentsTotal: pending?.total ?? 0,
    };
  }),

  /**
   * List sales for the current tenant with pagination and filtering
   */
  list: tenantProcedure.input(listSalesInput).query(async ({ ctx, input }) => {
    const { page, perPage, customerId, status, paymentStatus, fromDate, toDate } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(sales.tenantId, ctx.tenantId)];
    if (customerId) conditions.push(eq(sales.customerId, customerId));
    if (status) conditions.push(eq(sales.status, status));
    if (paymentStatus) conditions.push(eq(sales.paymentStatus, paymentStatus));
    if (fromDate) conditions.push(gte(sales.createdAt, fromDate));
    if (toDate) conditions.push(lte(sales.createdAt, toDate));

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db
        .select({
          id: sales.id,
          tenantId: sales.tenantId,
          saleNumber: sales.saleNumber,
          customerId: sales.customerId,
          customerName: customers.name,
          subtotal: sales.subtotal,
          taxAmount: sales.taxAmount,
          discountAmount: sales.discountAmount,
          total: sales.total,
          paymentMethod: sales.paymentMethod,
          paymentStatus: sales.paymentStatus,
          status: sales.status,
          notes: sales.notes,
          createdBy: sales.createdBy,
          syncStatus: sales.syncStatus,
          syncVersion: sales.syncVersion,
          createdAt: sales.createdAt,
          updatedAt: sales.updatedAt,
          returnId: saleReturns.id,
          returnReason: saleReturns.reason,
          refundAmount: saleReturns.refundAmount,
          returnedAt: saleReturns.createdAt,
        })
        .from(sales)
        .leftJoin(customers, eq(sales.customerId, customers.id))
        .leftJoin(saleReturns, eq(saleReturns.saleId, sales.id))
        .where(where)
        .orderBy(desc(sales.createdAt))
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(sales)
        .where(where)
        .get(),
    ]);

    const totalItems = countResult?.count ?? 0;

    return {
      items,
      page,
      perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
    };
  }),

  /**
   * Get a single sale with its line items
   */
  getById: tenantProcedure.input(getSaleInput).query(async ({ ctx, input }) => {
    return getSaleRecord(ctx.db, ctx.tenantId, input.id);
  }),

  /**
   * Create a sale with items in a single transaction.
   *
   * - Extracts VAT from VAT-inclusive prices
   * - Persists unit snapshots for every line
   * - Decrements product stock using normalized quantities
   * - Creates inventory movements and advances the site sequential
   *
   * ENG-054 — orchestration delegated to
   * `application/sales/completeSale`. The router only adapts tRPC
   * input to the use-case shape and returns the resulting record.
   */
  create: criticalCommandProcedure.input(createSaleInput).mutation(async ({ ctx, input }) => {
    const result = await completeSale(
      {
        db: ctx.db,
        tenantId: ctx.tenantId,
        siteId: ctx.siteId ?? '',
        user: { id: ctx.user!.id, role: ctx.user!.role },
        envelope: (ctx as unknown as { envelope?: { operationId: string } }).envelope ?? null,
        deviceId:
          (ctx as unknown as { deviceId?: string | null }).deviceId ?? null,
        log: ctx.req?.server?.log,
      },
      {
        mode: 'fresh',
        customerId: input.customerId,
        items: input.items,
        payments: input.payments,
        paymentMethod: input.paymentMethod,
        amountReceived: input.amountReceived,
        paymentStatus: input.paymentStatus,
        discountAmount: input.discountAmount,
        status: input.status,
        notes: input.notes,
      }
    );
    return result.sale;
  }),

  /**
   * Update payment method, payment status, or notes on a sale
   */
  update: tenantProcedure.input(updateSaleInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;

    const existing = await ctx.db
      .select()
      .from(sales)
      .where(and(eq(sales.id, id), eq(sales.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'SALE_NOT_FOUND',
        message: 'Sale not found',
      });
    }

    if (existing.status === 'voided') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_UPDATE_VOIDED_FORBIDDEN',
        message: 'Cannot update a voided sale',
      });
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      updatedAt: now,
      syncStatus: 'pending',
      syncVersion: (existing.syncVersion ?? 0) + 1,
    };

    if (updates.paymentMethod !== undefined) updateData.paymentMethod = updates.paymentMethod;
    if (updates.paymentStatus !== undefined) updateData.paymentStatus = updates.paymentStatus;
    if (updates.notes !== undefined) updateData.notes = updates.notes;

    await ctx.db.update(sales).set(updateData).where(eq(sales.id, id));

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'sales',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const updated = await ctx.db.select().from(sales).where(eq(sales.id, id)).get();

    return updated!;
  }),

  /**
   * Refund a completed sale and restore the related stock movements.
   */
  returnSale: criticalCommandManagerOrAdminProcedure.input(returnSaleInput).mutation(async ({ ctx, input }) => {
    const activeCashSession = await requireActiveCashSession(
      ctx.db,
      ctx.tenantId,
      ctx.siteId,
      ctx.user!.id
    );
    const existing = await ctx.db
      .select()
      .from(sales)
      .where(and(eq(sales.id, input.id), eq(sales.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'SALE_NOT_FOUND',
        message: 'Sale not found',
      });
    }

    if (existing.status === 'voided') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_RETURN_VOIDED_FORBIDDEN',
        message: 'Voided sales cannot be refunded',
      });
    }

    if (existing.status !== 'completed') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_RETURN_NOT_COMPLETED',
        message: 'Only completed sales can be refunded',
      });
    }

    if (existing.paymentStatus === 'refunded') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_RETURN_ALREADY_REFUNDED',
        message: 'Sale is already refunded',
      });
    }

    const existingReturn = await ctx.db
      .select({ id: saleReturns.id })
      .from(saleReturns)
      .where(and(eq(saleReturns.saleId, input.id), eq(saleReturns.tenantId, ctx.tenantId)))
      .get();

    if (existingReturn) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_RETURN_DUPLICATE',
        message: 'Sale already has a recorded refund',
      });
    }

    const saleLineItems = await ctx.db
      .select({
        id: saleItems.id,
        productId: saleItems.productId,
        quantity: saleItems.quantity,
        unitEquivalence: saleItems.unitEquivalence,
      })
      .from(saleItems)
      .where(eq(saleItems.saleId, input.id))
      .all();

    if (saleLineItems.length === 0) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_WITHOUT_ITEMS',
        message: 'Cannot refund a sale without line items',
      });
    }

    const productIds = [...new Set(saleLineItems.map(item => item.productId))];
    const currentProducts = await ctx.db
      .select({
        id: products.id,
        stock: products.stock,
      })
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, productIds)))
      .all();

    const productStockState = new Map(currentProducts.map(product => [product.id, product.stock]));
    const nextSyncVersion = (existing.syncVersion ?? 0) + 1;
    const now = new Date().toISOString();
    const refundId = nanoid();

    // Phase 2 API-103: credit back the site that originally sold the stock
    // (not the refunding cashier's active site). Falls back to `null` for
    // legacy sales without a cash session — `applyInventoryBalanceDelta`
    // treats that as a safe no-op.
    const originalSaleSiteId = existing.cashSessionId
      ? (
          await ctx.db
            .select({ siteId: cashSessions.siteId })
            .from(cashSessions)
            .where(
              and(
                eq(cashSessions.id, existing.cashSessionId),
                eq(cashSessions.tenantId, ctx.tenantId)
              )
            )
            .get()
        )?.siteId ?? null
      : null;

    ctx.db.transaction(tx => {
      // ENG-042 TOCTOU defense: re-verify the active cash session under
      // the transaction snapshot. See sales.create above for full
      // rationale. Refunds bind the cash movement to activeCashSession.id;
      // a session closed mid-flight would attach the refund to a closed
      // shift.
      assertCashSessionStillOpen(tx, ctx.tenantId, activeCashSession.id);

      for (const item of saleLineItems) {
        const normalizedQuantity = getNormalizedSaleQuantity(item.quantity, item.unitEquivalence);
        const previousStock = productStockState.get(item.productId);

        if (previousStock === undefined) {
          throwServerError({
            trpcCode: 'NOT_FOUND',
            errorCode: 'SALE_REVERSAL_PRODUCT_MISSING',
            message: `Product ${item.productId} was not found while refunding the sale`,
            details: { productId: item.productId, operation: 'refund' },
          });
        }

        const newStock = previousStock + normalizedQuantity;
        productStockState.set(item.productId, newStock);

        tx.update(products)
          .set({
            stock: newStock,
            syncStatus: 'pending',
            syncVersion: sql`${products.syncVersion} + 1`,
            updatedAt: now,
          })
          .where(and(eq(products.id, item.productId), eq(products.tenantId, ctx.tenantId)))
          .run();

        tx.insert(inventoryMovements)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            productId: item.productId,
            type: 'return',
            quantity: normalizedQuantity,
            previousStock,
            newStock,
            reference: input.id,
            notes: `Refunded sale ${existing.saleNumber}`,
            createdBy: ctx.user!.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();

        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: originalSaleSiteId,
          productId: item.productId,
          delta: normalizedQuantity,
          initialOnHandIfMissing: previousStock,
          now,
        });
      }

      tx.insert(saleReturns)
        .values({
          id: refundId,
          tenantId: ctx.tenantId,
          saleId: input.id,
          refundAmount: existing.total,
          reason: input.reason,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      tx.update(sales)
        .set({
          paymentStatus: 'refunded',
          notes: buildReturnedSaleNotes(existing.notes, input.reason),
          updatedAt: now,
          syncStatus: 'pending',
          syncVersion: nextSyncVersion,
        })
        .where(eq(sales.id, input.id))
        .run();

      tx.insert(syncQueue)
        .values([
          {
            id: nanoid(),
            tenantId: ctx.tenantId,
            entityType: 'sale_returns',
            entityId: refundId,
            operation: 'create',
            data: {
              id: refundId,
              saleId: input.id,
              refundAmount: existing.total,
              reason: input.reason ?? null,
            },
            localVersion: 1,
            attempts: 0,
            createdAt: now,
          },
          {
            id: nanoid(),
            tenantId: ctx.tenantId,
            entityType: 'sales',
            entityId: input.id,
            operation: 'update',
            data: {
              id: input.id,
              paymentStatus: 'refunded',
              reason: input.reason ?? null,
              returnId: refundId,
            },
            localVersion: nextSyncVersion,
            attempts: 0,
            createdAt: now,
          },
        ])
        .run();

      insertCashMovement({
        tx,
        tenantId: ctx.tenantId,
        sessionId: activeCashSession.id,
        type: 'refund',
        amount: getPersistedCashContribution(existing),
        referenceId: input.id,
        note: `Refunded sale ${existing.saleNumber}`,
        createdBy: ctx.user!.id,
        createdAt: now,
      });

      // Phase 8 / Tier-2 #8 — refunds are a sensitive operation: stock is
      // restored, payment is reversed, and (depending on cash session status)
      // the drawer balance moves. Audit row is in-transaction so it is
      // either persisted with the refund or rolls back with it.
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        action: 'sale.return',
        resourceType: 'sale',
        resourceId: input.id,
        before: {
          paymentStatus: existing.paymentStatus,
          status: existing.status,
          total: existing.total,
          saleNumber: existing.saleNumber,
        },
        after: {
          paymentStatus: 'refunded',
          refundId,
          refundAmount: existing.total,
        },
        metadata: {
          ...(input.reason ? { reason: input.reason } : {}),
          // The cash-session id matters for over/short reconciliation when
          // the original sale's session has already been closed.
          refundCashSessionId: activeCashSession.id,
        },
      });
    });

    // ENG-020 — emit DIAN credit note (NC) for the refunded sale. The
    // originalCufe is looked up so DIAN can tie the compensation to the
    // original DEE; absence is non-fatal (emission runs best-effort).
    const originalFiscal = await ctx.db
      .select({ cufe: fiscalDocuments.cufe })
      .from(fiscalDocuments)
      .where(
        and(
          eq(fiscalDocuments.tenantId, ctx.tenantId),
          eq(fiscalDocuments.sourceId, input.id),
          eq(fiscalDocuments.kind, 'DEE')
        )
      )
      .get();
    await safelyEmitFiscalForCtx(ctx, {
      source: 'return',
      sourceId: refundId,
      saleId: input.id,
      kind: 'NC',
      originalCufe: originalFiscal?.cufe,
      reasonCode: input.reason ?? undefined,
    });

    return getSaleRecord(ctx.db, ctx.tenantId, input.id);
  }),

  /**
   * Void a completed sale (admin only) and reverse the related stock movements.
   */
  void: criticalCommandAdminProcedure.input(voidSaleInput).mutation(async ({ ctx, input }) => {
    // Void is an admin action that's decoupled from a cashier's register:
    // - if the original sale's cash session is still open, we reverse the cash
    //   movement against that session (keeps its expected balance consistent);
    // - if that session has already been closed, over/short is locked and we
    //   simply void the sale without touching cash (matches real POS behavior).
    const existing = await ctx.db
      .select()
      .from(sales)
      .where(and(eq(sales.id, input.id), eq(sales.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'SALE_NOT_FOUND',
        message: 'Sale not found',
      });
    }

    if (existing.status === 'voided') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_VOID_ALREADY_VOIDED',
        message: 'Sale is already voided',
      });
    }

    if (existing.paymentStatus === 'refunded') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_VOID_REFUNDED_FORBIDDEN',
        message: 'Refunded sales cannot be voided',
      });
    }

    if (existing.status !== 'completed') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_VOID_NOT_COMPLETED',
        message: 'Only completed sales can be voided',
      });
    }

    const saleLineItems = await ctx.db
      .select({
        id: saleItems.id,
        productId: saleItems.productId,
        quantity: saleItems.quantity,
        unitEquivalence: saleItems.unitEquivalence,
      })
      .from(saleItems)
      .where(eq(saleItems.saleId, input.id))
      .all();

    if (saleLineItems.length === 0) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_WITHOUT_ITEMS',
        message: 'Cannot void a sale without line items',
      });
    }

    const productIds = [...new Set(saleLineItems.map(item => item.productId))];
    const currentProducts = await ctx.db
      .select({
        id: products.id,
        stock: products.stock,
      })
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, productIds)))
      .all();

    // Resolve the target cash session for the reversal: only reverse if the
    // ORIGINAL session is still open; once closed, its over/short is finalized.
    const voidTargetSession = existing.cashSessionId
      ? await ctx.db
          .select({
            id: cashSessions.id,
            status: cashSessions.status,
            siteId: cashSessions.siteId,
          })
          .from(cashSessions)
          .where(
            and(
              eq(cashSessions.id, existing.cashSessionId),
              eq(cashSessions.tenantId, ctx.tenantId)
            )
          )
          .get()
      : null;
    const voidReversibleSessionId =
      voidTargetSession && voidTargetSession.status === 'open' ? voidTargetSession.id : null;
    // Phase 2 API-103: credit the site that originally sold the stock. The
    // reversal happens regardless of whether the cash session is still open —
    // voided stock always goes back on the shelf.
    const originalSaleSiteId = voidTargetSession?.siteId ?? null;

    const productStockState = new Map(currentProducts.map(product => [product.id, product.stock]));
    const nextSyncVersion = (existing.syncVersion ?? 0) + 1;
    const now = new Date().toISOString();
    ctx.db.transaction(tx => {
      for (const item of saleLineItems) {
        const normalizedQuantity = getNormalizedSaleQuantity(item.quantity, item.unitEquivalence);
        const previousStock = productStockState.get(item.productId);

        if (previousStock === undefined) {
          throwServerError({
            trpcCode: 'NOT_FOUND',
            errorCode: 'SALE_REVERSAL_PRODUCT_MISSING',
            message: `Product ${item.productId} was not found while voiding the sale`,
            details: { productId: item.productId, operation: 'void' },
          });
        }

        const newStock = previousStock + normalizedQuantity;
        productStockState.set(item.productId, newStock);

        tx.update(products)
          .set({
            stock: newStock,
            syncStatus: 'pending',
            syncVersion: sql`${products.syncVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(products.id, item.productId))
          .run();

        tx.insert(inventoryMovements)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            productId: item.productId,
            type: 'return',
            quantity: normalizedQuantity,
            previousStock,
            newStock,
            reference: input.id,
            notes: `Voided sale ${existing.saleNumber}`,
            createdBy: ctx.user!.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();

        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: originalSaleSiteId,
          productId: item.productId,
          delta: normalizedQuantity,
          initialOnHandIfMissing: previousStock,
          now,
        });
      }

      tx.update(sales)
        .set({
          status: 'voided',
          notes: buildVoidedSaleNotes(existing.notes, input.reason),
          updatedAt: now,
          syncStatus: 'pending',
          syncVersion: nextSyncVersion,
        })
        .where(eq(sales.id, input.id))
        .run();

      tx.insert(syncQueue)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          entityType: 'sales',
          entityId: input.id,
          operation: 'update',
          data: { id: input.id, status: 'voided', reason: input.reason },
          localVersion: nextSyncVersion,
          attempts: 0,
          createdAt: now,
        })
        .run();

      if (voidReversibleSessionId) {
        insertCashMovement({
          tx,
          tenantId: ctx.tenantId,
          sessionId: voidReversibleSessionId,
          type: 'refund',
          amount: getPersistedCashContribution(existing),
          referenceId: input.id,
          note: `Voided sale ${existing.saleNumber}`,
          createdBy: ctx.user!.id,
          createdAt: now,
        });
      }

      // Phase 8 / Tier-2 #8 — record the sensitive action in the same
      // transaction as the void so an audit row exists iff the void landed.
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        action: 'sale.void',
        resourceType: 'sale',
        resourceId: input.id,
        before: {
          status: existing.status,
          paymentStatus: existing.paymentStatus,
          total: existing.total,
          saleNumber: existing.saleNumber,
        },
        after: {
          status: 'voided',
        },
        metadata: {
          ...(input.reason ? { reason: input.reason } : {}),
          ...(voidReversibleSessionId
            ? { reversedCashSessionId: voidReversibleSessionId }
            : {}),
        },
      });
    });

    // ENG-020 — emit DIAN credit note (NC) for the voided sale. Pulls
    // the original DEE's CUFE so the NC references it. Best-effort.
    const originalVoidFiscal = await ctx.db
      .select({ cufe: fiscalDocuments.cufe })
      .from(fiscalDocuments)
      .where(
        and(
          eq(fiscalDocuments.tenantId, ctx.tenantId),
          eq(fiscalDocuments.sourceId, input.id),
          eq(fiscalDocuments.kind, 'DEE')
        )
      )
      .get();
    await safelyEmitFiscalForCtx(ctx, {
      source: 'void',
      sourceId: input.id,
      saleId: input.id,
      kind: 'NC',
      originalCufe: originalVoidFiscal?.cufe,
      reasonCode: input.reason ?? undefined,
    });

    const updated = await ctx.db.select().from(sales).where(eq(sales.id, input.id)).get();
    return updated!;
  }),

  /**
   * ENG-018 — Suspend a draft sale so the cashier can start another cart
   * without losing the in-progress one. Idempotent: re-suspending an
   * already-suspended sale just refreshes `suspendedAt` and the label.
   *
   * Invariants:
   * - Only draft sales may be suspended. Completed, cancelled, or voided
   *   sales throw BAD_REQUEST.
   * - The suspending cashier (`ctx.user.id`) is recorded in
   *   `suspendedBy`; resumes/discards by anyone else require manager or
   *   admin role.
   * - No stock impact: drafts never decrement inventory in the first
   *   place, so there is nothing to revert.
   */
  suspend: criticalCommandProcedure.input(suspendSaleInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(sales)
      .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'SALE_NOT_FOUND',
        message: 'Sale not found',
      });
    }

    if (existing.status !== 'draft') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_DRAFT_REQUIRED',
        message: 'Only draft sales can be suspended',
        details: { operation: 'suspend', actualStatus: existing.status },
      });
    }

    const now = new Date().toISOString();
    const label = input.label && input.label.length > 0 ? input.label : null;

    ctx.db.transaction(tx => {
      tx.update(sales)
        .set({
          suspendedAt: now,
          suspendedBy: ctx.user!.id,
          suspendedLabel: label,
          syncStatus: 'pending',
          syncVersion: (existing.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(sales.id, input.saleId))
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        action: 'sale.park',
        resourceType: 'sale',
        resourceId: input.saleId,
        before: {
          status: existing.status,
          suspendedAt: existing.suspendedAt,
          suspendedLabel: existing.suspendedLabel,
        },
        after: {
          status: 'draft',
          suspendedAt: now,
          suspendedLabel: label,
        },
        metadata: label ? { label } : null,
      });
    });

    return getSaleRecord(ctx.db, ctx.tenantId, input.saleId);
  }),

  /**
   * ENG-018 — Resume a suspended draft. Clears the suspension metadata
   * so the cashier can keep editing the cart, but keeps
   * `status='draft'` so `sales.create`/`sales.update` flows still apply
   * as the terminal commit path.
   *
   * Lock: a suspended draft can only be resumed by the cashier who
   * suspended it, UNLESS the caller is a manager or admin (override).
   * Anything else returns FORBIDDEN.
   */
  resume: criticalCommandProcedure.input(resumeSaleInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(sales)
      .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'SALE_NOT_FOUND',
        message: 'Sale not found',
      });
    }

    if (existing.status !== 'draft' || !existing.suspendedAt) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_NOT_SUSPENDED',
        message: 'Sale is not suspended',
      });
    }

    const actorRole = ctx.user?.role;
    const isOwner = existing.suspendedBy === ctx.user!.id;
    const canOverride = actorRole === 'manager' || actorRole === 'admin';

    if (!isOwner && !canOverride) {
      throwServerError({
        trpcCode: 'FORBIDDEN',
        errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED',
        message: 'Only the cashier who suspended this sale can resume it',
        details: { operation: 'resume' },
      });
    }

    const now = new Date().toISOString();
    const previousSuspendedBy = existing.suspendedBy;
    const previousSuspendedAt = existing.suspendedAt;
    const previousLabel = existing.suspendedLabel;

    ctx.db.transaction(tx => {
      tx.update(sales)
        .set({
          suspendedAt: null,
          suspendedBy: null,
          suspendedLabel: null,
          syncStatus: 'pending',
          syncVersion: (existing.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(sales.id, input.saleId))
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        action: 'sale.resume',
        resourceType: 'sale',
        resourceId: input.saleId,
        before: {
          status: 'draft',
          suspendedAt: previousSuspendedAt,
          suspendedBy: previousSuspendedBy,
          suspendedLabel: previousLabel,
        },
        after: {
          status: 'draft',
          suspendedAt: null,
          suspendedBy: null,
          suspendedLabel: null,
        },
        metadata: {
          ...(previousSuspendedBy && previousSuspendedBy !== ctx.user!.id
            ? { override: true, originalSuspendedBy: previousSuspendedBy }
            : {}),
        },
      });
    });

    return getSaleRecord(ctx.db, ctx.tenantId, input.saleId);
  }),

  /**
   * ENG-018 — List suspended drafts. Cashiers only see drafts they
   * themselves suspended; managers and admins see every suspended
   * draft for the tenant (optionally narrowed by site).
   *
   * Returned shape is intentionally flat (no items/payments) so the
   * resume panel renders fast. The full sale is fetched via
   * `sales.resume` or `sales.getById` when the operator picks one.
   */
  listDrafts: tenantProcedure.input(listDraftsInput).query(async ({ ctx, input }) => {
    const { page, perPage, siteId: siteFilter, search } = input;
    const offset = (page - 1) * perPage;

    const conditions = [
      eq(sales.tenantId, ctx.tenantId),
      eq(sales.status, 'draft'),
      sql`${sales.suspendedAt} IS NOT NULL`,
    ];

    const actorRole = ctx.user?.role;
    if (actorRole === 'cashier') {
      // Cashiers never see another operator's draft — not even on the
      // same site — to keep the surface small and private.
      conditions.push(eq(sales.suspendedBy, ctx.user!.id));
    }

    if (siteFilter) {
      conditions.push(
        sql`${sales.cashSessionId} IN (SELECT id FROM ${cashSessions} WHERE ${cashSessions.siteId} = ${siteFilter} AND ${cashSessions.tenantId} = ${ctx.tenantId})`
      );
    }

    if (search && search.length > 0) {
      const pattern = `%${search.toLowerCase()}%`;
      conditions.push(
        sql`(lower(${sales.saleNumber}) LIKE ${pattern} OR lower(coalesce(${sales.suspendedLabel}, '')) LIKE ${pattern})`
      );
    }

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db
        .select({
          id: sales.id,
          saleNumber: sales.saleNumber,
          customerId: sales.customerId,
          customerName: customers.name,
          subtotal: sales.subtotal,
          taxAmount: sales.taxAmount,
          total: sales.total,
          notes: sales.notes,
          suspendedAt: sales.suspendedAt,
          suspendedBy: sales.suspendedBy,
          suspendedLabel: sales.suspendedLabel,
          createdBy: sales.createdBy,
          cashSessionId: sales.cashSessionId,
          createdAt: sales.createdAt,
          updatedAt: sales.updatedAt,
          itemCount: sql<number>`(SELECT count(*) FROM ${saleItems} WHERE ${saleItems.saleId} = ${sales.id})`,
        })
        .from(sales)
        .leftJoin(customers, eq(sales.customerId, customers.id))
        .where(where)
        .orderBy(desc(sales.suspendedAt))
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(sales)
        .where(where)
        .get(),
    ]);

    const totalItems = countResult?.count ?? 0;

    return {
      items,
      page,
      perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
    };
  }),

  /**
   * ENG-018 — Discard a suspended draft. Flips `status` to `cancelled`
   * (not `voided`, which is reserved for completed sales), clears the
   * suspension columns, and **reverses the stock** that was debited
   * when the draft was first created.
   *
   * Drafts debit stock at create-time (see `sales.create` regardless
   * of status), so discarding a draft must credit the same quantities
   * back to `products.stock` and `inventory_balances`. Without the
   * reversal, cancelled drafts would permanently leak inventory —
   * ENG-018c fix for a latent bug in 77bb686.
   *
   * No cash movement reversal needed: drafts never emit one.
   *
   * Lock: the cashier who created OR suspended the draft; manager and
   * admin can override. The `createdBy` path covers orphan drafts
   * that never got suspended (e.g. a suspend call failed after the
   * initial `sales.create`).
   */
  discardDraft: criticalCommandProcedure.input(discardDraftInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .select()
      .from(sales)
      .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'SALE_NOT_FOUND',
        message: 'Sale not found',
      });
    }

    if (existing.status !== 'draft') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_DRAFT_REQUIRED',
        message: 'Only draft sales can be discarded',
        details: { operation: 'discard', actualStatus: existing.status },
      });
    }

    const actorRole = ctx.user?.role;
    const isCreator = existing.createdBy === ctx.user!.id;
    const isSuspender = existing.suspendedBy === ctx.user!.id;
    const canOverride = actorRole === 'manager' || actorRole === 'admin';

    if (!isCreator && !isSuspender && !canOverride) {
      throwServerError({
        trpcCode: 'FORBIDDEN',
        errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED',
        message: 'Only the cashier who created or suspended this draft can discard it',
        details: { operation: 'discard' },
      });
    }

    const saleLineItems = await ctx.db
      .select({
        id: saleItems.id,
        productId: saleItems.productId,
        quantity: saleItems.quantity,
        unitEquivalence: saleItems.unitEquivalence,
      })
      .from(saleItems)
      .where(eq(saleItems.saleId, input.saleId))
      .all();

    // Empty drafts exist (e.g. cashier created a blank draft and then
    // changed their mind). Discarding one is a no-op on stock, but we
    // still flip the status + audit.
    const hasItems = saleLineItems.length > 0;

    // Resolve the original cash session's siteId so the inventory balance
    // credit lands on the site that was debited. Falls back to null for
    // drafts with no cash session link, which `applyInventoryBalanceDelta`
    // treats as a no-op.
    const originalSaleSiteId = existing.cashSessionId
      ? (
          await ctx.db
            .select({ siteId: cashSessions.siteId })
            .from(cashSessions)
            .where(
              and(
                eq(cashSessions.id, existing.cashSessionId),
                eq(cashSessions.tenantId, ctx.tenantId)
              )
            )
            .get()
        )?.siteId ?? null
      : null;

    const currentProducts = hasItems
      ? await ctx.db
          .select({ id: products.id, stock: products.stock })
          .from(products)
          .where(
            and(
              eq(products.tenantId, ctx.tenantId),
              inArray(
                products.id,
                [...new Set(saleLineItems.map(item => item.productId))]
              )
            )
          )
          .all()
      : [];
    const productStockState = new Map(
      currentProducts.map(product => [product.id, product.stock])
    );
    const nextSyncVersion = (existing.syncVersion ?? 0) + 1;
    const now = new Date().toISOString();

    ctx.db.transaction(tx => {
      for (const item of saleLineItems) {
        const normalizedQuantity = getNormalizedSaleQuantity(
          item.quantity,
          item.unitEquivalence
        );
        const previousStock = productStockState.get(item.productId);

        if (previousStock === undefined) {
          throwServerError({
            trpcCode: 'NOT_FOUND',
            errorCode: 'SALE_REVERSAL_PRODUCT_MISSING',
            message: `Product ${item.productId} was not found while discarding the draft`,
            details: { productId: item.productId, operation: 'discard' },
          });
        }

        const newStock = previousStock + normalizedQuantity;
        productStockState.set(item.productId, newStock);

        tx.update(products)
          .set({
            stock: newStock,
            syncStatus: 'pending',
            syncVersion: sql`${products.syncVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(products.id, item.productId))
          .run();

        tx.insert(inventoryMovements)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            productId: item.productId,
            type: 'return',
            quantity: normalizedQuantity,
            previousStock,
            newStock,
            reference: input.saleId,
            notes: `Discarded draft ${existing.saleNumber}`,
            createdBy: ctx.user!.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();

        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: originalSaleSiteId,
          productId: item.productId,
          delta: normalizedQuantity,
          initialOnHandIfMissing: previousStock,
          now,
        });
      }

      tx.update(sales)
        .set({
          status: 'cancelled',
          suspendedAt: null,
          suspendedBy: null,
          suspendedLabel: null,
          syncStatus: 'pending',
          syncVersion: nextSyncVersion,
          updatedAt: now,
        })
        .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
        .run();

      tx.insert(syncQueue)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          entityType: 'sales',
          entityId: input.saleId,
          operation: 'update',
          data: { id: input.saleId, status: 'cancelled', discarded: true },
          localVersion: nextSyncVersion,
          attempts: 0,
          createdAt: now,
        })
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        action: 'sale.park',
        resourceType: 'sale',
        resourceId: input.saleId,
        before: {
          status: existing.status,
          suspendedAt: existing.suspendedAt,
          suspendedBy: existing.suspendedBy,
        },
        after: { status: 'cancelled' },
        metadata: {
          discarded: true,
          reversedItems: saleLineItems.length,
        },
      });
    });

    return { id: input.saleId, status: 'cancelled' as const };
  }),

  /**
   * ENG-018c — Complete a draft sale that was previously created via
   * `sales.create({ status: 'draft' })` and possibly suspended +
   * resumed in between. Flips `status` to `'completed'`, attaches
   * payments + the cash movement, and binds the sale to the caller's
   * currently active cash session (so reports aggregate cash where
   * the money physically landed, not where the draft was born).
   *
   * Invariants:
   * - Target must be `status='draft'` and NOT currently suspended
   *   (caller must `sales.resume` first to clear `suspended_at`).
   * - Items are locked at complete-time: no `items` input is accepted.
   *   If the operator wants to change the basket they discard this
   *   draft (which now reverses stock) and start a fresh one.
   * - The draft's stock was already debited at `sales.create` time, so
   *   completing does NOT touch `products.stock` or
   *   `inventory_balances`. This is the whole point of the split —
   *   double-debit is what we're avoiding.
   * - Any pre-existing `sale_payments` rows (drafts carry placeholder
   *   rows from the initial create) are deleted and replaced with the
   *   real tenders supplied by the operator.
   *
   * Permissions:
   * - Cashier who created the draft, or any manager / admin.
   * - Caller must have an active cash session for their (tenant, site)
   *   pair — enforced via `requireActiveCashSession`.
   */
  completeDraft: criticalCommandCashierManagerOrAdminProcedure
    .input(completeDraftInput)
    .mutation(async ({ ctx, input }) => {
      // ENG-054 — orchestration delegated to
      // `application/sales/completeSale`. The fromDraft path covers:
      // ownership check, suspension check, draft-only invariant, line
      // item count, payment resolution, cash session rebind, audit
      // log emission, and post-commit fiscal emit.
      const result = await completeSale(
        {
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId ?? '',
          user: { id: ctx.user!.id, role: ctx.user!.role },
          envelope:
            (ctx as unknown as { envelope?: { operationId: string } }).envelope ?? null,
          deviceId:
            (ctx as unknown as { deviceId?: string | null }).deviceId ?? null,
          log: ctx.req?.server?.log,
        },
        {
          mode: 'fromDraft',
          saleId: input.saleId,
          payments: input.payments,
          paymentMethod: input.paymentMethod,
          amountReceived: input.amountReceived,
          paymentStatus: input.paymentStatus,
          notes: input.notes,
        }
      );
      return result.sale;
    }),

  /**
   * ENG-019 — Reprint a sale receipt. Returns the full sale record so
   * the caller can hand it to the receipt renderer, AND increments
   * `reprintCount` + stamps `lastReprintedAt` / `lastReprintedBy`.
   * One `sale.reprint` audit row is emitted per call.
   *
   * Permissions:
   * - Completed and voided sales can be reprinted (voided prints a
   *   copy with an "ANULADA" watermark on the renderer side).
   * - Drafts cannot be reprinted — there is no receipt for a draft.
   * - Cashiers can only reprint sales whose `cashSessionId` matches
   *   their currently-active session; manager and admin override the
   *   session check.
   */
  getForReprint: criticalCommandProcedure
    .input(getForReprintInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(sales)
        .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
        .get();

      if (!existing) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'SALE_NOT_FOUND',
          message: 'Sale not found',
        });
      }

      if (existing.status === 'draft') {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'SALE_REPRINT_DRAFT_FORBIDDEN',
          message: 'Draft sales have no receipt to reprint',
        });
      }

      const actorRole = ctx.user?.role;
      const canOverride = actorRole === 'manager' || actorRole === 'admin';

      if (!canOverride) {
        // Cashier path — must have an open session AND the sale must
        // belong to that session. This prevents a cashier from
        // reprinting another cashier's closed-shift receipts.
        const activeSession = await ctx.db
          .select({ id: cashSessions.id })
          .from(cashSessions)
          .where(
            and(
              eq(cashSessions.tenantId, ctx.tenantId),
              eq(cashSessions.cashierId, ctx.user!.id),
              eq(cashSessions.status, 'open')
            )
          )
          .get();

        if (!activeSession || existing.cashSessionId !== activeSession.id) {
          throwServerError({
            trpcCode: 'FORBIDDEN',
            errorCode: 'SALE_REPRINT_ACTIVE_SESSION_REQUIRED',
            message:
              'Cashiers can only reprint sales from their active cash session',
          });
        }
      }

      const now = new Date().toISOString();
      const nextCount = (existing.reprintCount ?? 0) + 1;

      ctx.db.transaction(tx => {
        tx.update(sales)
          .set({
            reprintCount: nextCount,
            lastReprintedAt: now,
            lastReprintedBy: ctx.user!.id,
            updatedAt: now,
          })
          .where(eq(sales.id, input.saleId))
          .run();

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'sale.reprint',
          resourceType: 'sale',
          resourceId: input.saleId,
          before: {
            reprintCount: existing.reprintCount ?? 0,
            lastReprintedAt: existing.lastReprintedAt,
          },
          after: {
            reprintCount: nextCount,
            lastReprintedAt: now,
          },
          metadata: {
            count: nextCount,
            ...(input.reason ? { reason: input.reason } : {}),
            ...(input.reasonDetail ? { reasonDetail: input.reasonDetail } : {}),
          },
        });
      });

      return getSaleRecord(ctx.db, ctx.tenantId, input.saleId);
    }),
});
