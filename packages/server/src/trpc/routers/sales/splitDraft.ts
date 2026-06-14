/**
 * Sales router splitDraft procedure.
 *
 * ENG-178 — extracted verbatim from the former flat `trpc/routers/sales.ts`
 * during the megafile decomposition. Isolated into its own module because
 * the procedure body alone is ~260 LOC. ENG-039c3 multi-check split.
 * Exported as a procedure record that `index.ts` spreads into `salesRouter`
 * (path unchanged).
 *
 * @module trpc/routers/sales/splitDraft
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { criticalCommandManagerOrAdminProcedure } from '../../middleware/criticalCommand.js';
import { saleItems, sales, sequentials, sites } from '../../../db/schema.js';
import { enqueueKdsOrder } from '../../../services/kds/enqueue.js';
import { refreshKdsOrderItems } from '../../../services/kds/refresh.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { splitDraftInput } from '../../schemas/sales.js';
import { writeAuditLog } from '../../../services/audit-logs.js';
import { getSaleRecord } from '../../../application/sales/sale-read.js';
import {
  buildKdsHookContext,
  resolveActiveRestaurantTable,
  resolveSaleSiteId,
} from './helpers.js';

export const salesSplitDraftProcedures = {
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
            // ENG-176b — split drafts inherit the source draft's
            // currency seam verbatim. A split that crossed currencies
            // would not make business sense (you cannot move items
            // priced in USD into a COP draft without re-pricing).
            currencyCode: existing.currencyCode,
            exchangeRateAtSale: existing.exchangeRateAtSale,
            settleCurrencyCode: existing.settleCurrencyCode,
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
              subtotal: sql<number>`round(COALESCE(SUM(${saleItems.total} - ${saleItems.taxAmount}), 0), 2)`,
              taxAmount: sql<number>`round(COALESCE(SUM(${saleItems.taxAmount}), 0), 2)`,
              total: sql<number>`round(COALESCE(SUM(${saleItems.total}), 0), 2)`,
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
};
