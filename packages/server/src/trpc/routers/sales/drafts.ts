/**
 * Sales router draft-state procedures (suspend, resume, discardDraft, changeTable).
 *
 * extracted verbatim from the former flat `trpc/routers/sales.ts`
 * during the megafile decomposition.  /  draft lifecycle.
 * Exported as a procedure record that `index.ts` spreads into `salesRouter`
 * (paths unchanged). `splitDraft` lives in its own module for size.
 *
 * @module trpc/routers/sales/drafts
 */
import { and, eq } from 'drizzle-orm';

import {
  criticalCommandManagerOrAdminProcedure,
  criticalCommandProcedure,
} from '../../middleware/criticalCommand.js';
import { restaurantTables, sales } from '../../../db/schema.js';
import { enqueueKdsOrder } from '../../../services/kds/enqueue.js';
import { refreshKdsOrderItems } from '../../../services/kds/refresh.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import {
  changeSaleTableInput,
  discardDraftInput,
  resumeSaleInput,
  suspendSaleInput,
} from '../../schemas/sales.js';
import { writeAuditLog } from '../../../services/audit-logs.js';
import { discardDraft as discardDraftService } from '../../../application/sales/discardDraft.js';
import { getSaleRecord } from '../../../application/sales/sale-read.js';
import {
  buildKdsHookContext,
  buildLifecycleContext,
  resolveActiveRestaurantTable,
  resolveSaleSiteId,
} from './helpers.js';

export const salesDraftProcedures = {
  /**
   * Suspend a draft sale so the cashier can start another cart
   * without losing the in-progress one. Idempotent: re-suspending an
   * already-suspended sale just refreshes `suspendedAt` and the label.
   *
   * Invariants:
   * - Only draft sales may be suspended. Completed, cancelled, or voided
   * sales throw BAD_REQUEST.
   * - The suspending cashier (`ctx.user.id`) is recorded in
   * `suspendedBy`; resumes/discards by anyone else require manager or
   * admin role.
   * - No stock impact: drafts never decrement inventory in the first
   * place, so there is nothing to revert.
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

    // when the caller passes a tableId, resolve it first so
    // (a) cross-tenant / archived FKs fail before the UPDATE lands and
    // (b) we can refresh `suspendedLabel` from the catalog row to keep
    // the panel display in sync with the FK. A free-text label keeps
    // working when no tableId is supplied.
    const saleSiteId = input.tableId
      ? await resolveSaleSiteId(ctx.db, ctx.tenantId, existing.cashSessionId, ctx.siteId)
      : null;
    const resolvedTable = input.tableId
      ? await resolveActiveRestaurantTable(ctx.db, ctx.tenantId, input.tableId, saleSiteId)
      : null;

    const now = new Date().toISOString();
    const label = resolvedTable
      ? resolvedTable.name
      : input.label && input.label.length > 0
        ? input.label
        : null;

    // await the transaction so a constraint violation in
    // the audit-log write surfaces to the tRPC caller instead of
    // becoming an unhandled rejection. The pre- code missed
    // the await; fixing it inline because this slice already touches
    // the procedure body.
    await ctx.db.transaction(tx => {
      tx.update(sales)
        .set({
          suspendedAt: now,
          suspendedBy: ctx.user!.id,
          suspendedLabel: label,
          tableId: resolvedTable ? resolvedTable.id : (existing.tableId ?? null),
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
          tableId: resolvedTable ? resolvedTable.id : (existing.tableId ?? null),
        },
        metadata: {
          ...(label ? { label } : {}),
          ...(resolvedTable ? { tableName: resolvedTable.name } : {}),
        },
      });
    });

    // push to the kitchen display when the suspended draft
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
   * Resume a suspended draft. Clears the suspension metadata
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
   * Discard a suspended draft. Flips `status` to `cancelled`
   * (not `voided`, which is reserved for completed sales), clears the
   * suspension columns, and **reverses the stock** that was debited
   * when the draft was first created.
   *
   * orchestration delegated to `application/sales/discardDraft`.
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
   * Move a suspended draft between restaurant tables, or
   * detach it back to free-text mode by passing `tableId: null`.
   *
   * Invariants:
   * - Target sale must be `status='draft'` AND suspended (otherwise
   * `SALE_CHANGE_TABLE_INVALID_STATUS`).
   * - Manager/admin only. Cashiers can suspend / resume their own
   * drafts, but moving a draft between physical tables is an
   * operations override.
   * - When `tableId` is non-null, the new row must belong to the
   * tenant and be active; otherwise `RESTAURANT_TABLE_NOT_FOUND`.
   * - `suspendedLabel` is refreshed to the new table's name when
   * moving onto a table; when detaching (`tableId: null`) we keep
   * any prior free-text label so the panel display stays stable.
   * - Emits a `sale.changeTable` audit row inside the UPDATE
   * transaction with before/after `tableId` + the resolved table
   * names in metadata for forensics.
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
        ? await resolveSaleSiteId(ctx.db, ctx.tenantId, existing.cashSessionId, ctx.siteId)
        : null;

      // Resolve the new table BEFORE the transaction so a cross-tenant
      // or cross-site FK fails fast with a clean NOT_FOUND.
      const resolvedTable = input.tableId
        ? await resolveActiveRestaurantTable(ctx.db, ctx.tenantId, input.tableId, saleSiteId)
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
      const nextLabel = resolvedTable ? resolvedTable.name : existing.suspendedLabel;

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

      // refresh the existing KDS card with the new table
      // label / detachment. No-op when no card exists for the sale.
      await refreshKdsOrderItems({
        ctx: buildKdsHookContext(ctx),
        saleId: input.saleId,
      });

      return getSaleRecord(ctx.db, ctx.tenantId, input.saleId);
    }),
};
