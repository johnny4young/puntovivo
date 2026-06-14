/**
 * Sales router lifecycle procedures (create, update, returnSale, void,
 * completeDraft, getForReprint).
 *
 * ENG-178 — extracted verbatim from the former flat `trpc/routers/sales.ts`
 * during the megafile decomposition. ENG-054 / ENG-055 — the heavy sale
 * orchestration already lives in `application/sales/`; these procedures
 * adapt tRPC input to the use-case shape (create / completeDraft) or are
 * thin wrappers (returnSale / void / discardDraft). `update` and
 * `getForReprint` keep their small inline bodies. Exported as a procedure
 * record that `index.ts` spreads into `salesRouter` (paths unchanged).
 *
 * @module trpc/routers/sales/lifecycle
 */
import { and, eq } from 'drizzle-orm';

import { managerOrAdminProcedure } from '../../middleware/roles.js';
import {
  criticalCommandAdminProcedure,
  criticalCommandCashierManagerOrAdminProcedure,
  criticalCommandManagerOrAdminProcedure,
  criticalCommandProcedure,
} from '../../middleware/criticalCommand.js';
import { cashSessions, sales } from '../../../db/schema.js';
import { enqueueSync } from '../../../services/sync/enqueue.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { asCriticalCommandContext } from '../../middleware/commandEnvelope.js';
import {
  completeDraftInput,
  createSaleInput,
  getForReprintInput,
  returnSaleInput,
  updateSaleInput,
  voidSaleInput,
} from '../../schemas/sales.js';
import { writeAuditLog } from '../../../services/audit-logs.js';
import { completeSale } from '../../../application/sales/completeSale.js';
import { returnSale as returnSaleService } from '../../../application/sales/returnSale.js';
import { voidSale as voidSaleService } from '../../../application/sales/voidSale.js';
import { getSaleRecord } from '../../../application/sales/sale-read.js';
import {
  assertCanCreateCreditSale,
  buildLifecycleContext,
  inputCarriesCreditTender,
  resolveActiveRestaurantTable,
} from './helpers.js';

export const salesLifecycleProcedures = {
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
    // ENG-039c — when the renderer passes a tableId (voice-ordering
    // screen), resolve + validate it against the tenant/site catalog BEFORE
    // entering the transactional sale flow so a cross-tenant or
    // archived FK fails fast with a clear error code.
    if (input.tableId) {
      await resolveActiveRestaurantTable(
        ctx.db,
        ctx.tenantId,
        input.tableId,
        ctx.siteId
      );
    }

    if (inputCarriesCreditTender(input)) {
      assertCanCreateCreditSale(ctx);
    }

    // ENG-090 — only admins can bypass the credit-limit invariant. The
    // router rejects manager + cashier callers before the sale tx
    // runs so a forged payload never reaches `completeSale`.
    if (input.creditOverride === true && ctx.user!.role !== 'admin') {
      throwServerError({
        trpcCode: 'FORBIDDEN',
        errorCode: 'CREDIT_OVERRIDE_FORBIDDEN',
        message: 'Only administrators can override the credit limit',
      });
    }

    const criticalCtx = asCriticalCommandContext(ctx);
    const result = await completeSale(
      {
        db: ctx.db,
        tenantId: ctx.tenantId,
        siteId: ctx.siteId ?? '',
        user: { id: ctx.user!.id, role: ctx.user!.role },
        envelope: criticalCtx.envelope,
        deviceId: criticalCtx.deviceId,
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
        tableId: input.tableId,
        tipAmount: input.tipAmount,
        tipMethod: input.tipMethod ?? null,
        // ENG-039d3 — auto-applied restaurant service charge passes
        // through to the use-case. The Zod schema defaults amount to 0
        // and leaves rate optional so retail tenants pay zero contract
        // cost; `runFreshSale` re-validates against the tenant rate.
        serviceChargeAmount: input.serviceChargeAmount,
        serviceChargeRate: input.serviceChargeRate ?? null,
        // ENG-090 — admin override for the credit-limit invariant.
        creditOverride: input.creditOverride ?? false,
      }
    );
    return result.sale;
  }),

  /**
   * Update payment method, payment status, or notes on a sale
   */
  update: managerOrAdminProcedure.input(updateSaleInput).mutation(async ({ ctx, input }) => {
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
      if (inputCarriesCreditTender(input)) {
        assertCanCreateCreditSale(ctx);
      }

      // ENG-090 — same admin-only gate as `sales.create`. Drafts that
      // resume as credit can also bypass the cupo at finalize time
      // when an admin co-signs; non-admin callers cannot.
      if (input.creditOverride === true && ctx.user!.role !== 'admin') {
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'CREDIT_OVERRIDE_FORBIDDEN',
          message: 'Only administrators can override the credit limit',
        });
      }
      // ENG-054 — orchestration delegated to
      // `application/sales/completeSale`. The fromDraft path covers:
      // ownership check, suspension check, draft-only invariant, line
      // item count, payment resolution, cash session rebind, audit
      // log emission, and post-commit fiscal emit.
      const criticalCtx = asCriticalCommandContext(ctx);
      const result = await completeSale(
        {
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId ?? '',
          user: { id: ctx.user!.id, role: ctx.user!.role },
          envelope: criticalCtx.envelope,
          deviceId: criticalCtx.deviceId,
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
          tipAmount: input.tipAmount,
          tipMethod: input.tipMethod ?? null,
          // ENG-039d3 — same pass-through as the fresh path; the
          // use-case re-validates the amount against the live tenant
          // rate at commit time.
          serviceChargeAmount: input.serviceChargeAmount,
          serviceChargeRate: input.serviceChargeRate ?? null,
          // ENG-090 — admin override for the credit-limit invariant.
          creditOverride: input.creditOverride ?? false,
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
};
