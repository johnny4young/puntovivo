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

import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import {
  criticalCommandAdminProcedure,
  criticalCommandCashierManagerOrAdminProcedure,
  criticalCommandManagerOrAdminProcedure,
  criticalCommandProcedure,
} from '../middleware/criticalCommand.js';
import {
  cashSessions,
  customers,
  saleItems,
  saleReturns,
  sales,
} from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
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
import { writeAuditLog } from '../../services/audit-logs.js';
// ENG-054 / ENG-055 — sale lifecycle orchestration lives in
// `application/sales/`. The router keeps the lightweight reads
// (summary, list, getById, listDrafts) and the suspend / resume /
// getForReprint procedures inline; the rest are thin wrappers around
// the application services.
import { completeSale } from '../../application/sales/completeSale.js';
import { discardDraft as discardDraftService } from '../../application/sales/discardDraft.js';
import { returnSale as returnSaleService } from '../../application/sales/returnSale.js';
import { voidSale as voidSaleService } from '../../application/sales/voidSale.js';
import type { CompleteSaleContext } from '../../application/sales/types.js';
import { getSaleRecord } from '../../application/sales/sale-read.js';

/**
 * Adapt the tRPC `Context` (which the application services treat as
 * opaque) to the `CompleteSaleContext` shape that the use-case
 * services consume. The middleware decorates `ctx` with `envelope`,
 * `deviceId`, and `log` only on critical-command procedures, hence
 * the unsafe cast — these are absent on `tenantProcedure`-shaped ctx.
 */
function buildLifecycleContext(ctx: Context): CompleteSaleContext {
  return {
    db: ctx.db,
    tenantId: ctx.tenantId!,
    siteId: ctx.siteId ?? '',
    user: { id: ctx.user!.id, role: ctx.user!.role },
    envelope:
      (ctx as unknown as { envelope?: { operationId: string } }).envelope ?? null,
    deviceId:
      (ctx as unknown as { deviceId?: string | null }).deviceId ?? null,
    log: ctx.req?.server?.log,
  };
}

function getRevenueEligibleSaleConditions(tenantId: string) {
  return [
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'completed'),
    sql`${sales.paymentStatus} != 'refunded'`,
  ] as const;
}

// ENG-054 / ENG-055 — every sale lifecycle helper that used to live
// inline (validateCustomer, getSaleSequentialContext, resolveSaleItems,
// assertCashSessionStillOpen, insertCashMovement,
// getNormalizedSaleQuantity, buildVoided/ReturnedSaleNotes,
// getPersistedCashContribution, safelyEmitFiscalForCtx) is now in
// `application/sales/` (use-cases + policies) or `services/cash-session`
// (cross-use-case primitives). The router only retains
// `getRevenueEligibleSaleConditions` because it is a pure read filter
// used by the `summary` and dashboard procedures.

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

    await ctx.db
      .update(sales)
      .set(updateData)
      .where(and(eq(sales.id, id), eq(sales.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'sales',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
    });

    const updated = await ctx.db
      .select()
      .from(sales)
      .where(and(eq(sales.id, id), eq(sales.tenantId, ctx.tenantId)))
      .get();

    return updated!;
  }),

  /**
   * Refund a completed sale and restore the related stock movements.
   *
   * ENG-055 — orchestration delegated to `application/sales/returnSale`.
   */
  returnSale: criticalCommandManagerOrAdminProcedure
    .input(returnSaleInput)
    .mutation(async ({ ctx, input }) => {
      const result = await returnSaleService(buildLifecycleContext(ctx), {
        id: input.id,
        reason: input.reason,
      });
      return result.sale;
    }),

  /**
   * Void a completed sale (admin only) and reverse the related stock movements.
   *
   * ENG-055 — orchestration delegated to `application/sales/voidSale`.
   * Void is admin-only and decoupled from a cashier's register: the
   * cash movement reversal is conditional on the ORIGINAL session
   * still being open; once closed, over/short is locked.
   */
  void: criticalCommandAdminProcedure.input(voidSaleInput).mutation(async ({ ctx, input }) => {
    const result = await voidSaleService(buildLifecycleContext(ctx), {
      id: input.id,
      reason: input.reason,
    });
    return result.sale;
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
        .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
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
        .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
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
   * ENG-055 — orchestration delegated to `application/sales/discardDraft`.
   * Lock: cashier who created OR suspended the draft; manager and
   * admin can override.
   */
  discardDraft: criticalCommandProcedure
    .input(discardDraftInput)
    .mutation(async ({ ctx, input }) => {
      const result = await discardDraftService(buildLifecycleContext(ctx), {
        saleId: input.saleId,
      });
      return { id: result.id, status: result.status };
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
          .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
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
