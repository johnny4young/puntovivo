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
  restaurantTables,
  saleItems,
  saleReturns,
  sales,
  sequentials,
  sites,
} from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { enqueueKdsOrder } from '../../services/kds/enqueue.js';
import { refreshKdsOrderItems } from '../../services/kds/refresh.js';
import type { KdsHookContext } from '../../services/kds/types.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { Context } from '../context.js';
import {
  changeSaleTableInput,
  completeDraftInput,
  createSaleInput,
  discardDraftInput,
  getForReprintInput,
  getSaleInput,
  listDraftsInput,
  listSalesInput,
  resumeSaleInput,
  returnSaleInput,
  splitDraftInput,
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
    sse: ctx.req?.server?.sse ?? null,
  };
}

/**
 * ENG-098 — build the structural context shape consumed by the KDS
 * post-tx hooks. The SSE manager is read off the FastifyInstance
 * decorated at boot (`realtime/sse.ts`). When `req` is absent (unit
 * tests, internal callers) the helpers skip the broadcast silently.
 */
function buildKdsHookContext(ctx: Context): KdsHookContext {
  return {
    db: ctx.db,
    tenantId: ctx.tenantId!,
    siteId: ctx.siteId ?? null,
    user: ctx.user ? { id: ctx.user.id } : null,
    sse: ctx.req?.server?.sse ?? null,
    log: ctx.req?.server?.log,
  };
}

function assertCanCreateCreditSale(ctx: Context): void {
  const role = ctx.user!.role;
  if (role === 'admin' || role === 'manager') {
    return;
  }

  throwServerError({
    trpcCode: 'FORBIDDEN',
    errorCode: 'CREDIT_SALE_FORBIDDEN',
    message: 'Only managers and administrators can create credit sales',
  });
}

function inputCarriesCreditTender(input: {
  paymentMethod: string;
  payments?: Array<{ method: string }>;
}): boolean {
  return (
    input.paymentMethod === 'credit' ||
    (input.payments?.some(payment => payment.method === 'credit') ?? false)
  );
}

/**
 * ENG-039c — resolve a `restaurant_tables` row for the tenant, asserting
 * it belongs to `ctx.tenantId` and is active. Cross-tenant hits collapse
 * to `RESTAURANT_TABLE_NOT_FOUND` so the lookup never leaks existence.
 * Archived rows are also rejected so a draft cannot anchor to a table
 * that the operator removed from the dropdown.
 */
async function resolveActiveRestaurantTable(
  db: Context['db'],
  tenantId: string,
  tableId: string,
  expectedSiteId?: string | null
): Promise<{ id: string; name: string; siteId: string }> {
  const row = await db
    .select({
      id: restaurantTables.id,
      name: restaurantTables.name,
      siteId: restaurantTables.siteId,
      isActive: restaurantTables.isActive,
    })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.id, tableId),
        eq(restaurantTables.tenantId, tenantId)
      )
    )
    .get();
  if (
    !row ||
    row.isActive === false ||
    (expectedSiteId !== null &&
      expectedSiteId !== undefined &&
      row.siteId !== expectedSiteId)
  ) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
      message: `Restaurant table ${tableId} not found for this tenant`,
      details: { tenantId, tableId, siteId: expectedSiteId ?? null },
    });
  }
  return { id: row.id, name: row.name, siteId: row.siteId };
}

async function resolveSaleSiteId(
  db: Context['db'],
  tenantId: string,
  cashSessionId: string | null,
  fallbackSiteId: string | null
): Promise<string | null> {
  if (!cashSessionId) {
    return fallbackSiteId;
  }

  const session = await db
    .select({ siteId: cashSessions.siteId })
    .from(cashSessions)
    .where(
      and(eq(cashSessions.id, cashSessionId), eq(cashSessions.tenantId, tenantId))
    )
    .get();

  return session?.siteId ?? fallbackSiteId;
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

    // ENG-039c — when the caller passes a tableId, resolve it first so
    // (a) cross-tenant / archived FKs fail before the UPDATE lands and
    // (b) we can refresh `suspendedLabel` from the catalog row to keep
    // the panel display in sync with the FK. A free-text label keeps
    // working when no tableId is supplied.
    const saleSiteId = input.tableId
      ? await resolveSaleSiteId(
          ctx.db,
          ctx.tenantId,
          existing.cashSessionId,
          ctx.siteId
        )
      : null;
    const resolvedTable = input.tableId
      ? await resolveActiveRestaurantTable(
          ctx.db,
          ctx.tenantId,
          input.tableId,
          saleSiteId
        )
      : null;

    const now = new Date().toISOString();
    const label = resolvedTable
      ? resolvedTable.name
      : input.label && input.label.length > 0
        ? input.label
        : null;

    // ENG-039c — await the transaction so a constraint violation in
    // the audit-log write surfaces to the tRPC caller instead of
    // becoming an unhandled rejection. The pre-ENG-039c code missed
    // the await; fixing it inline because this slice already touches
    // the procedure body.
    await ctx.db.transaction(tx => {
      tx.update(sales)
        .set({
          suspendedAt: now,
          suspendedBy: ctx.user!.id,
          suspendedLabel: label,
          tableId: resolvedTable ? resolvedTable.id : existing.tableId ?? null,
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
          tableId: existing.tableId,
        },
        after: {
          status: 'draft',
          suspendedAt: now,
          suspendedLabel: label,
          tableId: resolvedTable ? resolvedTable.id : existing.tableId ?? null,
        },
        metadata: {
          ...(label ? { label } : {}),
          ...(resolvedTable ? { tableName: resolvedTable.name } : {}),
        },
      });
    });

    // ENG-098 — push to the kitchen display when the suspended draft
    // carries a tableId. Best-effort post-tx hook; module-disabled or
    // tableless suspends are no-ops inside the helper.
    if (resolvedTable || existing.tableId) {
      await enqueueKdsOrder({
        ctx: buildKdsHookContext(ctx),
        saleId: input.saleId,
      });
    }

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
          // ENG-039c — surface the restaurant table linkage so the
          // suspended-sales panel can render a resolved badge instead
          // of relying on the denormalized free-text label.
          tableId: sales.tableId,
          tableName: restaurantTables.name,
          createdBy: sales.createdBy,
          cashSessionId: sales.cashSessionId,
          createdAt: sales.createdAt,
          updatedAt: sales.updatedAt,
          itemCount: sql<number>`(SELECT count(*) FROM ${saleItems} WHERE ${saleItems.saleId} = ${sales.id})`,
        })
        .from(sales)
        .leftJoin(customers, eq(sales.customerId, customers.id))
        .leftJoin(
          restaurantTables,
          and(
            eq(sales.tableId, restaurantTables.id),
            eq(restaurantTables.tenantId, ctx.tenantId)
          )
        )
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
   * ENG-039c — Move a suspended draft between restaurant tables, or
   * detach it back to free-text mode by passing `tableId: null`.
   *
   * Invariants:
   * - Target sale must be `status='draft'` AND suspended (otherwise
   *   `SALE_CHANGE_TABLE_INVALID_STATUS`).
   * - Manager/admin only. Cashiers can suspend / resume their own
   *   drafts, but moving a draft between physical tables is an
   *   operations override.
   * - When `tableId` is non-null, the new row must belong to the
   *   tenant and be active; otherwise `RESTAURANT_TABLE_NOT_FOUND`.
   * - `suspendedLabel` is refreshed to the new table's name when
   *   moving onto a table; when detaching (`tableId: null`) we keep
   *   any prior free-text label so the panel display stays stable.
   * - Emits a `sale.changeTable` audit row inside the UPDATE
   *   transaction with before/after `tableId` + the resolved table
   *   names in metadata for forensics.
   */
  changeTable: criticalCommandManagerOrAdminProcedure
    .input(changeSaleTableInput)
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

      if (existing.status !== 'draft' || !existing.suspendedAt) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'SALE_CHANGE_TABLE_INVALID_STATUS',
          message: 'Only suspended draft sales can be moved between tables',
          details: {
            operation: 'changeTable',
            actualStatus: existing.status,
            suspended: existing.suspendedAt !== null,
          },
        });
      }

      const saleSiteId = input.tableId
        ? await resolveSaleSiteId(
            ctx.db,
            ctx.tenantId,
            existing.cashSessionId,
            ctx.siteId
          )
        : null;

      // Resolve the new table BEFORE the transaction so a cross-tenant
      // or cross-site FK fails fast with a clean NOT_FOUND.
      const resolvedTable = input.tableId
        ? await resolveActiveRestaurantTable(
            ctx.db,
            ctx.tenantId,
            input.tableId,
            saleSiteId
          )
        : null;

      // Resolve the prior table name (when one was set) for the audit
      // metadata — useful when the operator archives the source table
      // between the move and a future forensic read.
      let priorTableName: string | null = null;
      if (existing.tableId) {
        const prior = await ctx.db
          .select({ name: restaurantTables.name })
          .from(restaurantTables)
          .where(
            and(
              eq(restaurantTables.id, existing.tableId),
              eq(restaurantTables.tenantId, ctx.tenantId)
            )
          )
          .get();
        priorTableName = prior?.name ?? null;
      }

      const now = new Date().toISOString();
      const nextTableId = resolvedTable ? resolvedTable.id : null;
      // When moving onto a real table, refresh the label so the panel
      // display tracks the catalog row. When detaching, keep the prior
      // free-text label intact — there is no FK-derived value to swap
      // in, and clearing it would surprise the operator.
      const nextLabel = resolvedTable
        ? resolvedTable.name
        : existing.suspendedLabel;

      await ctx.db.transaction(tx => {
        tx.update(sales)
          .set({
            tableId: nextTableId,
            suspendedLabel: nextLabel,
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
          action: 'sale.changeTable',
          resourceType: 'sale',
          resourceId: input.saleId,
          before: {
            tableId: existing.tableId,
            suspendedLabel: existing.suspendedLabel,
          },
          after: {
            tableId: nextTableId,
            suspendedLabel: nextLabel,
          },
          metadata: {
            saleNumber: existing.saleNumber,
            ...(priorTableName ? { priorTableName } : {}),
            ...(resolvedTable ? { nextTableName: resolvedTable.name } : {}),
            ...(existing.suspendedBy && existing.suspendedBy !== ctx.user!.id
              ? { override: true, originalSuspendedBy: existing.suspendedBy }
              : {}),
          },
        });
      });

      // ENG-098 — refresh the existing KDS card with the new table
      // label / detachment. No-op when no card exists for the sale.
      await refreshKdsOrderItems({
        ctx: buildKdsHookContext(ctx),
        saleId: input.saleId,
      });

      return getSaleRecord(ctx.db, ctx.tenantId, input.saleId);
    }),

  /**
   * ENG-039c3 — Split a suspended draft into a brand-new suspended
   * draft, moving the chosen `saleItemIds` from the source onto the
   * new draft. Designed for restaurant flows where one open table
   * needs to pay in multiple checks.
   *
   * Invariants:
   * - Source must be `status='draft'` AND `suspendedAt IS NOT NULL`
   *   (otherwise `SALE_SPLIT_INVALID_STATUS`).
   * - Manager/admin only. Splitting a draft is an operations override
   *   (same role gate as `changeTable`).
   * - `saleItemIds` must be non-empty and every id must currently be
   *   bound to `sourceSaleId` for the caller's tenant. Mismatches
   *   collapse to `SALE_SPLIT_ITEMS_NOT_FOUND` so cross-draft
   *   existence cannot be probed.
   * - When `tableId` is non-null, the row must belong to the tenant
   *   and the same site as the source draft (otherwise
   *   `RESTAURANT_TABLE_NOT_FOUND`).
   * - Stock is NOT touched: items are merely relocated. Stock was
   *   already debited at the source's create time and a future
   *   `discardDraft` against either draft reverses its OWN current
   *   items only, so the total debited stays correct.
   * - Audit row `sale.splitDraft` lands inside the same transaction
   *   with `resourceId = newDraftId`; `metadata.sourceSaleNumber`
   *   carries the donor back-pointer for forensics.
   */
  splitDraft: criticalCommandManagerOrAdminProcedure
    .input(splitDraftInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(sales)
        .where(and(eq(sales.id, input.sourceSaleId), eq(sales.tenantId, ctx.tenantId)))
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
          errorCode: 'SALE_SPLIT_INVALID_STATUS',
          message: 'Only suspended draft sales can be split',
          details: {
            operation: 'splitDraft',
            actualStatus: existing.status,
            suspended: existing.suspendedAt !== null,
          },
        });
      }

      const uniqueItemIds = [...new Set(input.saleItemIds)];
      if (uniqueItemIds.length === 0) {
        // Zod rejects empty arrays upstream; defence-in-depth.
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'SALE_SPLIT_NO_ITEMS_SELECTED',
          message: 'At least one sale item must be selected to split',
        });
      }

      const sourceItems = await ctx.db
        .select({ id: saleItems.id, saleId: saleItems.saleId })
        .from(saleItems)
        .where(inArray(saleItems.id, uniqueItemIds))
        .all();
      // Every requested id must exist AND belong to the source draft.
      // Both "not found" and "found but wrong owner" collapse to the
      // same error so a caller cannot use the response as an existence
      // oracle across drafts.
      const allBelong =
        sourceItems.length === uniqueItemIds.length &&
        sourceItems.every(row => row.saleId === input.sourceSaleId);
      if (!allBelong) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'SALE_SPLIT_ITEMS_NOT_FOUND',
          message: 'Selected items do not belong to the source draft',
          details: {
            requestedCount: uniqueItemIds.length,
            matchedCount: sourceItems.filter(
              row => row.saleId === input.sourceSaleId
            ).length,
          },
        });
      }

      const saleSiteId = await resolveSaleSiteId(
        ctx.db,
        ctx.tenantId,
        existing.cashSessionId,
        ctx.siteId
      );

      const resolvedTable = input.tableId
        ? await resolveActiveRestaurantTable(
            ctx.db,
            ctx.tenantId,
            input.tableId,
            saleSiteId
          )
        : null;

      // Source draft's site sequential drives the new draft's sale
      // number. Falls back to a tenant-wide alphabetical pick when the
      // source has no cash session link (legacy / orphan drafts).
      const sequentialContext = await ctx.db
        .select({
          id: sequentials.id,
          prefix: sequentials.prefix,
          currentValue: sequentials.currentValue,
          siteId: sequentials.siteId,
        })
        .from(sequentials)
        .innerJoin(sites, eq(sequentials.siteId, sites.id))
        .where(
          and(
            eq(sequentials.tenantId, ctx.tenantId),
            eq(sequentials.documentType, 'sale'),
            eq(sites.isActive, true),
            ...(saleSiteId ? [eq(sequentials.siteId, saleSiteId)] : [])
          )
        )
        .get();

      if (!sequentialContext) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'SALE_SEQUENTIAL_MISSING',
          message: 'No active sale sequential is configured for the current tenant',
        });
      }

      const nextSequentialValue = sequentialContext.currentValue + 1;
      const newSaleNumber = `${sequentialContext.prefix}${String(nextSequentialValue).padStart(6, '0')}`;
      const newSaleId = nanoid();
      const now = new Date().toISOString();
      const nextTableId = resolvedTable ? resolvedTable.id : null;
      const newLabel = resolvedTable
        ? resolvedTable.name
        : input.label && input.label.length > 0
          ? input.label
          : null;

      await ctx.db.transaction(tx => {
        // Advance the per-site sequential first so a concurrent
        // sales.create can't double-allocate the same saleNumber.
        tx.update(sequentials)
          .set({ currentValue: nextSequentialValue, updatedAt: now })
          .where(eq(sequentials.id, sequentialContext.id))
          .run();

        tx.insert(sales)
          .values({
            id: newSaleId,
            tenantId: ctx.tenantId,
            saleNumber: newSaleNumber,
            customerId: existing.customerId ?? null,
            tableId: nextTableId,
            subtotal: 0,
            taxAmount: 0,
            discountAmount: 0,
            total: 0,
            paymentMethod: existing.paymentMethod,
            paymentStatus: 'pending',
            status: 'draft',
            cashSessionId: existing.cashSessionId,
            notes: null,
            suspendedAt: now,
            suspendedBy: ctx.user!.id,
            suspendedLabel: newLabel,
            createdBy: existing.createdBy,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        // Reassign the chosen sale_items to the new draft. The AND
        // guard re-validates the source ownership inside the
        // transaction so a TOCTOU race (e.g. parallel completeDraft on
        // the source) cannot smuggle items across drafts.
        const moveResult = tx
          .update(saleItems)
          .set({ saleId: newSaleId })
          .where(
            and(
              inArray(saleItems.id, uniqueItemIds),
              eq(saleItems.saleId, input.sourceSaleId)
            )
          )
          .run() as { changes?: number };
        if ((moveResult.changes ?? 0) !== uniqueItemIds.length) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'SALE_SPLIT_ITEMS_NOT_FOUND',
            message: 'Selected items do not belong to the source draft',
            details: {
              requestedCount: uniqueItemIds.length,
              movedCount: moveResult.changes ?? 0,
            },
          });
        }

        // Recompute aggregate totals on BOTH drafts from the post-move
        // sale_items rows. Drizzle's better-sqlite3 dialect surfaces
        // sql.raw aggregates as `number | null` so we coalesce to 0.
        const recompute = (saleId: string) => {
          const totals = tx
            .select({
              subtotal: sql<number>`COALESCE(SUM(${saleItems.total} - ${saleItems.taxAmount}), 0)`,
              taxAmount: sql<number>`COALESCE(SUM(${saleItems.taxAmount}), 0)`,
              total: sql<number>`COALESCE(SUM(${saleItems.total}), 0)`,
            })
            .from(saleItems)
            .where(eq(saleItems.saleId, saleId))
            .get();
          tx.update(sales)
            .set({
              subtotal: totals?.subtotal ?? 0,
              taxAmount: totals?.taxAmount ?? 0,
              total: totals?.total ?? 0,
              syncStatus: 'pending',
              syncVersion:
                saleId === newSaleId
                  ? 1
                  : (existing.syncVersion ?? 0) + 1,
              updatedAt: now,
            })
            .where(and(eq(sales.id, saleId), eq(sales.tenantId, ctx.tenantId)))
            .run();
        };
        recompute(newSaleId);
        recompute(input.sourceSaleId);

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'sale.splitDraft',
          resourceType: 'sale',
          resourceId: newSaleId,
          before: {
            sourceSaleId: input.sourceSaleId,
          },
          after: {
            newSaleId,
            tableId: nextTableId,
            suspendedLabel: newLabel,
          },
          metadata: {
            sourceSaleNumber: existing.saleNumber,
            newSaleNumber,
            movedItemCount: uniqueItemIds.length,
            ...(resolvedTable ? { tableName: resolvedTable.name } : {}),
          },
        });
      });

      const [source, created] = await Promise.all([
        getSaleRecord(ctx.db, ctx.tenantId, input.sourceSaleId),
        getSaleRecord(ctx.db, ctx.tenantId, newSaleId),
      ]);

      // ENG-098 — rewrite the source KDS snapshot (items moved out)
      // and create a fresh card for the carved-out draft when it
      // landed on a tableId. Both calls are no-ops when the kds
      // module is off or the rows have no kitchen footprint.
      const kdsCtx = buildKdsHookContext(ctx);
      await refreshKdsOrderItems({ ctx: kdsCtx, saleId: input.sourceSaleId });
      if (nextTableId) {
        await enqueueKdsOrder({ ctx: kdsCtx, saleId: newSaleId });
      }

      return { source, created };
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
});
