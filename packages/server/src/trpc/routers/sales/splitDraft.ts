/**
 * Sales router splitDraft procedure.
 *
 * Extracted from the former flat `trpc/routers/sales.ts` during the megafile
 * decomposition. It is isolated because the procedure owns both the legacy
 * draft split and the normalized restaurant multi-check projection.
 * Exported as a procedure record that `index.ts` spreads into `salesRouter`
 * (path unchanged).
 *
 * @module trpc/routers/sales/splitDraft
 */
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { criticalCommandManagerOrAdminProcedure } from '../../middleware/criticalCommand.js';
import type { DatabaseInstance } from '../../../db/index.js';
import {
  cashSessions,
  restaurantTables,
  saleItems,
  salePayments,
  sales,
  sequentials,
  sites,
} from '../../../db/schema.js';
import { enqueueKdsOrder } from '../../../services/kds/enqueue.js';
import { refreshKdsOrderItems } from '../../../services/kds/refresh.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { splitDraftInput } from '../../schemas/sales.js';
import { writeAuditLog } from '../../../services/audit-logs.js';
import { allocateNextSequential } from '../../../services/sequential-allocation.js';
import { createSaleSplitCommandResultRef } from '../../../services/idempotency/commandResultRef.js';
import { enqueueSyncInTransaction } from '../../../services/sync/enqueue.js';
import { getSaleRecord } from '../../../application/sales/sale-read.js';
import { roundMoney } from '../../../lib/money.js';
import {
  buildKdsHookContext,
  buildLifecycleContext,
  resolveActiveRestaurantTable,
  resolveSaleSiteId,
} from './helpers.js';
import {
  assertDineInStillActive,
  ensureRestaurantCheckForSuspendedSale,
  splitRestaurantCheckInTransaction,
} from '../../../application/restaurant/service-lifecycle.js';

/** Rounded frozen-line totals used to repartition one draft header. */
interface DraftLineTotals {
  subtotal: number;
  taxAmount: number;
  gross: number;
}

function readDraftLineTotals(
  tx: DatabaseInstance,
  tenantId: string,
  saleId: string
): DraftLineTotals {
  const totals = tx
    .select({
      subtotal: sql<number>`round(COALESCE(SUM(${saleItems.total} - ${saleItems.taxAmount}), 0), 2)`,
      taxAmount: sql<number>`round(COALESCE(SUM(${saleItems.taxAmount}), 0), 2)`,
      gross: sql<number>`round(COALESCE(SUM(${saleItems.total}), 0), 2)`,
    })
    .from(saleItems)
    .innerJoin(sales, and(eq(sales.id, saleItems.saleId), eq(sales.tenantId, tenantId)))
    .where(eq(saleItems.saleId, saleId))
    .get();
  return {
    subtotal: roundMoney(totals?.subtotal ?? 0),
    taxAmount: roundMoney(totals?.taxAmount ?? 0),
    gross: roundMoney(totals?.gross ?? 0),
  };
}

function allocateDraftHeaderAmount(
  amount: number,
  childWeight: number
): { source: number; child: number } {
  const child = roundMoney(amount * childWeight);
  return { source: roundMoney(amount - child), child };
}

export const salesSplitDraftProcedures = {
  /**
   * Split a suspended draft into a brand-new suspended
   * draft, moving the chosen `saleItemIds` from the source onto the
   * new draft. Designed for restaurant flows where one open table
   * needs to pay in multiple checks.
   *
   * Invariants:
   * - Source must be `status='draft'` AND `suspendedAt IS NOT NULL`
   * (otherwise `SALE_SPLIT_INVALID_STATUS`).
   * - Manager/admin only. Splitting a draft is an operations override
   * (same role gate as `changeTable`).
   * - `saleItemIds` must be non-empty and every id must currently be
   * bound to `sourceSaleId` for the caller's tenant. Mismatches
   * collapse to `SALE_SPLIT_ITEMS_NOT_FOUND` so cross-draft
   * existence cannot be probed.
   * - When `tableId` is non-null, the row must belong to the tenant
   * and the same site as the source draft (otherwise
   * `RESTAURANT_TABLE_NOT_FOUND`).
   * - Stock is NOT touched: items are merely relocated. Stock was
   * already debited at the source's create time and a future
   * `discardDraft` against either draft reverses its OWN current
   * items only, so the total debited stays correct.
   * - Audit row `sale.splitDraft` lands inside the same transaction
   * with `resourceId = newDraftId`; `metadata.sourceSaleNumber`
   * carries the donor back-pointer for forensics.
   */
  splitDraft: criticalCommandManagerOrAdminProcedure
    .input(splitDraftInput)
    .mutation(async ({ ctx, input }) => {
      const lifecycleContext = buildLifecycleContext(ctx);
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
        .innerJoin(sales, and(eq(sales.id, saleItems.saleId), eq(sales.tenantId, ctx.tenantId)))
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
            matchedCount: sourceItems.filter(row => row.saleId === input.sourceSaleId).length,
          },
        });
      }

      let saleSiteId = await resolveSaleSiteId(ctx.db, ctx.tenantId, existing.cashSessionId, null);
      const sourceTable = existing.tableId
        ? await ctx.db
            .select({ siteId: restaurantTables.siteId })
            .from(restaurantTables)
            .where(
              and(
                eq(restaurantTables.id, existing.tableId),
                eq(restaurantTables.tenantId, ctx.tenantId)
              )
            )
            .get()
        : null;
      if (saleSiteId && sourceTable && sourceTable.siteId !== saleSiteId) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
          message: 'Draft cash session and restaurant table belong to different sites',
        });
      }
      // Historical table drafts can predate mandatory cash-session binding,
      // and tenant-wide admin contexts have no implicit site. The physical
      // table is the only honest source for the split's site in that case.
      saleSiteId ??= sourceTable?.siteId ?? null;
      if (!saleSiteId) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'SALE_DRAFT_SITE_UNKNOWN',
          message: 'A draft without a verifiable source site cannot be split',
          details: { saleId: input.sourceSaleId },
        });
      }

      const resolvedTable = input.tableId
        ? await resolveActiveRestaurantTable(ctx.db, ctx.tenantId, input.tableId, saleSiteId)
        : null;

      // The source draft's authoritative site sequential drives the new
      // draft's sale number. Never use the currently selected UI site (or a
      // tenant-wide first row) for a legacy draft whose reservation site is
      // unknown: that would fabricate financial provenance.
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
            eq(sequentials.siteId, saleSiteId)
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

      let newSaleNumber = '';
      const newSaleId = nanoid();
      const now = new Date().toISOString();
      const nextTableId = resolvedTable ? resolvedTable.id : null;
      let effectiveNewTableId = nextTableId;
      let effectiveNewLabel: string | null;
      const newLabel = resolvedTable
        ? resolvedTable.name
        : input.label && input.label.length > 0
          ? input.label
          : null;
      effectiveNewLabel = newLabel;

      await ctx.db.transaction(
        tx => {
          // The earlier reads provide fast feedback only. Re-own the source
          // lifecycle after acquiring the SQLite writer so a concurrent
          // resume, completion or discard cannot turn a stale split request
          // into mutations against a sale that is no longer suspended.
          const currentSource = tx
            .select()
            .from(sales)
            .where(and(eq(sales.id, input.sourceSaleId), eq(sales.tenantId, ctx.tenantId)))
            .get();
          if (!currentSource) {
            throwServerError({
              trpcCode: 'NOT_FOUND',
              errorCode: 'SALE_NOT_FOUND',
              message: 'Sale not found',
            });
          }
          if (currentSource.status !== 'draft' || !currentSource.suspendedAt) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'SALE_SPLIT_INVALID_STATUS',
              message: 'Only suspended draft sales can be split',
              details: {
                operation: 'splitDraft',
                actualStatus: currentSource.status,
                suspended: currentSource.suspendedAt !== null,
              },
            });
          }
          const currentSessionSite = currentSource.cashSessionId
            ? tx
                .select({ siteId: cashSessions.siteId })
                .from(cashSessions)
                .where(
                  and(
                    eq(cashSessions.id, currentSource.cashSessionId),
                    eq(cashSessions.tenantId, ctx.tenantId)
                  )
                )
                .get()
            : null;
          const currentTableSite = currentSource.tableId
            ? tx
                .select({ siteId: restaurantTables.siteId })
                .from(restaurantTables)
                .where(
                  and(
                    eq(restaurantTables.id, currentSource.tableId),
                    eq(restaurantTables.tenantId, ctx.tenantId)
                  )
                )
                .get()
            : null;
          if (
            currentSessionSite &&
            currentTableSite &&
            currentSessionSite.siteId !== currentTableSite.siteId
          ) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
              message: 'Draft cash session and restaurant table belong to different sites',
            });
          }
          const currentSaleSiteId = currentSessionSite?.siteId ?? currentTableSite?.siteId ?? null;
          if (!currentSaleSiteId) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'SALE_DRAFT_SITE_UNKNOWN',
              message: 'A draft without a verifiable source site cannot be split',
              details: { saleId: input.sourceSaleId },
            });
          }
          if (currentSaleSiteId !== saleSiteId) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'SALE_DRAFT_SITE_MISMATCH',
              message: 'The draft source site changed while it was being split',
              details: { expectedSiteId: saleSiteId, actualSiteId: currentSaleSiteId },
            });
          }
          const sourceItemCountBefore =
            tx
              .select({ value: count() })
              .from(saleItems)
              .innerJoin(
                sales,
                and(eq(sales.id, saleItems.saleId), eq(sales.tenantId, ctx.tenantId))
              )
              .where(eq(saleItems.saleId, input.sourceSaleId))
              .get()?.value ?? 0;
          const expectedCurrentTotal = roundMoney(
            currentSource.subtotal +
              currentSource.taxAmount -
              currentSource.discountAmount +
              currentSource.tipAmount +
              currentSource.serviceChargeAmount
          );
          if (
            sourceItemCountBefore === 0 ||
            !Number.isFinite(expectedCurrentTotal) ||
            expectedCurrentTotal !== roundMoney(currentSource.total)
          ) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'SALE_SPLIT_INVALID_STATUS',
              message: 'The suspended draft header is inconsistent with its frozen amounts',
              details: {
                sourceItemCount: sourceItemCountBefore,
                expectedTotal: expectedCurrentTotal,
                storedTotal: currentSource.total,
              },
            });
          }
          // Customer-value tenders are only valid on a completed sale and
          // carry indivisible ledger references (plus whole points for
          // loyalty). A malformed/historical draft must fail closed rather
          // than silently relabeling those funds or inventing proportional
          // redemption rows during a bill split.
          if (
            currentSource.paymentMethod === 'loyalty' ||
            currentSource.paymentMethod === 'store_credit'
          ) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'SALE_SPLIT_INVALID_STATUS',
              message: 'Customer-value tenders cannot be split on a draft sale',
              details: { paymentMethod: currentSource.paymentMethod },
            });
          }
          if (currentSource.tableId || resolvedTable) {
            assertDineInStillActive(tx as unknown as typeof ctx.db, ctx.tenantId);
          }
          if (resolvedTable) {
            const currentTable = tx
              .select({ id: restaurantTables.id })
              .from(restaurantTables)
              .where(
                and(
                  eq(restaurantTables.id, resolvedTable.id),
                  eq(restaurantTables.tenantId, ctx.tenantId),
                  eq(restaurantTables.siteId, resolvedTable.siteId),
                  eq(restaurantTables.isActive, true)
                )
              )
              .get();
            if (!currentTable) {
              throwServerError({
                trpcCode: 'NOT_FOUND',
                errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
                message: `Restaurant table ${resolvedTable.id} not found for this tenant`,
                details: {
                  tenantId: ctx.tenantId,
                  tableId: resolvedTable.id,
                  siteId: resolvedTable.siteId,
                },
              });
            }
          }

          const currentSequential = tx
            .select({ id: sequentials.id })
            .from(sequentials)
            .innerJoin(sites, eq(sequentials.siteId, sites.id))
            .where(
              and(
                eq(sequentials.id, sequentialContext.id),
                eq(sequentials.tenantId, ctx.tenantId),
                eq(sequentials.documentType, 'sale'),
                eq(sequentials.siteId, currentSaleSiteId),
                eq(sites.tenantId, ctx.tenantId),
                eq(sites.isActive, true)
              )
            )
            .get();
          if (!currentSequential) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'SALE_SEQUENTIAL_MISSING',
              message: 'No active sale sequential is configured for the draft source site',
            });
          }

          if (currentSource.tableId && saleSiteId) {
            // Adopt a legacy table draft before moving its sale items. The
            // split helper can then move the matching operational lines in
            // the same transaction instead of creating a hidden child draft.
            ensureRestaurantCheckForSuspendedSale(
              tx as unknown as typeof ctx.db,
              {
                tenantId: ctx.tenantId,
                siteId: saleSiteId,
                actorId: ctx.user!.id,
                now,
              },
              {
                saleId: input.sourceSaleId,
                tableId: currentSource.tableId,
                label: currentSource.suspendedLabel,
              }
            );
          }

          newSaleNumber = allocateNextSequential(tx as unknown as typeof ctx.db, {
            tenantId: ctx.tenantId,
            sequentialId: sequentialContext.id,
            updatedAt: now,
          }).number;

          tx.insert(sales)
            .values({
              id: newSaleId,
              tenantId: ctx.tenantId,
              saleNumber: newSaleNumber,
              customerId: currentSource.customerId ?? null,
              priceTier: currentSource.priceTier,
              tableId: nextTableId,
              subtotal: 0,
              taxAmount: 0,
              discountAmount: 0,
              total: 0,
              // split drafts inherit the source draft's
              // currency seam verbatim. A split that crossed currencies
              // would not make business sense (you cannot move items
              // priced in USD into a COP draft without re-pricing).
              currencyCode: currentSource.currencyCode,
              exchangeRateAtSale: currentSource.exchangeRateAtSale,
              settleCurrencyCode: currentSource.settleCurrencyCode,
              paymentMethod: currentSource.paymentMethod,
              paymentStatus: 'pending',
              status: 'draft',
              cashSessionId: currentSource.cashSessionId,
              notes: null,
              suspendedAt: now,
              suspendedBy: ctx.user!.id,
              suspendedLabel: newLabel,
              createdBy: currentSource.createdBy,
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
              and(inArray(saleItems.id, uniqueItemIds), eq(saleItems.saleId, input.sourceSaleId))
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

          // A split partitions the complete frozen draft header, not just its
          // line rows. Allocate header discount, tip and service charge using
          // the moved line gross (falling back to item count for zero-value
          // carts), then rebuild one provisional tender per draft. Otherwise
          // `sale_payments` and `sales.total` would keep describing the
          // pre-split bill even though the line ownership already changed.
          const sourceLineTotals = readDraftLineTotals(
            tx as unknown as DatabaseInstance,
            ctx.tenantId,
            input.sourceSaleId
          );
          const childLineTotals = readDraftLineTotals(
            tx as unknown as DatabaseInstance,
            ctx.tenantId,
            newSaleId
          );
          const postSplitGross = roundMoney(sourceLineTotals.gross + childLineTotals.gross);
          const storedGross = roundMoney(currentSource.subtotal + currentSource.taxAmount);
          if (postSplitGross !== storedGross) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'SALE_SPLIT_INVALID_STATUS',
              message: 'The suspended draft line totals do not match its frozen header',
              details: { postSplitGross, storedGross },
            });
          }
          const childWeight =
            postSplitGross > 0
              ? childLineTotals.gross / postSplitGross
              : uniqueItemIds.length / sourceItemCountBefore;
          const discount = allocateDraftHeaderAmount(currentSource.discountAmount, childWeight);
          const tip = allocateDraftHeaderAmount(currentSource.tipAmount, childWeight);
          const serviceCharge = allocateDraftHeaderAmount(
            currentSource.serviceChargeAmount,
            childWeight
          );
          const sourceTotal = roundMoney(
            sourceLineTotals.gross - discount.source + tip.source + serviceCharge.source
          );
          const childTotal = roundMoney(
            childLineTotals.gross - discount.child + tip.child + serviceCharge.child
          );
          if (sourceTotal < 0 || childTotal < 0) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'SALE_SPLIT_INVALID_STATUS',
              message: 'The suspended draft adjustments cannot be represented after the split',
              details: { sourceTotal, childTotal },
            });
          }

          tx.update(sales)
            .set({
              subtotal: sourceLineTotals.subtotal,
              taxAmount: sourceLineTotals.taxAmount,
              discountAmount: discount.source,
              tipAmount: tip.source,
              tipMethod: tip.source > 0 ? currentSource.tipMethod : null,
              serviceChargeAmount: serviceCharge.source,
              serviceChargeRate: serviceCharge.source > 0 ? currentSource.serviceChargeRate : null,
              total: sourceTotal,
              paymentStatus: 'pending',
              syncStatus: 'pending',
              syncVersion: (currentSource.syncVersion ?? 0) + 1,
              updatedAt: now,
            })
            .where(and(eq(sales.id, input.sourceSaleId), eq(sales.tenantId, ctx.tenantId)))
            .run();
          tx.update(sales)
            .set({
              subtotal: childLineTotals.subtotal,
              taxAmount: childLineTotals.taxAmount,
              discountAmount: discount.child,
              tipAmount: tip.child,
              tipMethod: tip.child > 0 ? currentSource.tipMethod : null,
              serviceChargeAmount: serviceCharge.child,
              serviceChargeRate: serviceCharge.child > 0 ? currentSource.serviceChargeRate : null,
              total: childTotal,
              paymentStatus: 'pending',
              syncStatus: 'pending',
              syncVersion: 1,
              updatedAt: now,
            })
            .where(and(eq(sales.id, newSaleId), eq(sales.tenantId, ctx.tenantId)))
            .run();

          tx.delete(salePayments)
            .where(
              and(
                eq(salePayments.tenantId, ctx.tenantId),
                eq(salePayments.saleId, input.sourceSaleId)
              )
            )
            .run();
          tx.insert(salePayments)
            .values([
              {
                id: nanoid(),
                tenantId: ctx.tenantId,
                saleId: input.sourceSaleId,
                method: currentSource.paymentMethod,
                amount: sourceTotal,
                reference: null,
                loyaltyPoints: null,
                syncStatus: 'pending',
                syncVersion: 1,
                createdAt: now,
              },
              {
                id: nanoid(),
                tenantId: ctx.tenantId,
                saleId: newSaleId,
                method: currentSource.paymentMethod,
                amount: childTotal,
                reference: null,
                loyaltyPoints: null,
                syncStatus: 'pending',
                syncVersion: 1,
                createdAt: now,
              },
            ])
            .run();

          const restaurantSplit = splitRestaurantCheckInTransaction(
            tx as unknown as typeof ctx.db,
            {
              tenantId: ctx.tenantId,
              siteId: saleSiteId,
              actorId: ctx.user!.id,
              now,
            },
            {
              sourceSaleId: input.sourceSaleId,
              newSaleId,
              movedSaleItemIds: uniqueItemIds,
              targetTableId: nextTableId,
              label: newLabel,
            }
          );
          effectiveNewTableId = restaurantSplit.tableId;
          effectiveNewLabel = restaurantSplit.label;
          if (effectiveNewTableId) {
            // Generic legacy drafts may be split directly onto a table. When
            // dine-in is active, normalize that child before commit; the
            // helper is idempotent when splitRestaurantCheck already created
            // the check for a normalized source.
            ensureRestaurantCheckForSuspendedSale(
              tx as unknown as typeof ctx.db,
              {
                tenantId: ctx.tenantId,
                siteId: resolvedTable?.siteId ?? saleSiteId,
                actorId: ctx.user!.id,
                now,
              },
              {
                saleId: newSaleId,
                tableId: effectiveNewTableId,
                label: effectiveNewLabel,
              }
            );
          }

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
              tableId: effectiveNewTableId,
              suspendedLabel: effectiveNewLabel,
            },
            metadata: {
              sourceSaleNumber: currentSource.saleNumber,
              newSaleNumber,
              movedItemCount: uniqueItemIds.length,
              ...(resolvedTable ? { tableName: resolvedTable.name } : {}),
            },
          });

          const syncContext = {
            db: tx as unknown as typeof ctx.db,
            tenantId: ctx.tenantId,
            envelope: lifecycleContext.envelope ?? null,
            deviceId: lifecycleContext.deviceId ?? null,
          };
          enqueueSyncInTransaction(syncContext, {
            entityType: 'sales',
            entityId: input.sourceSaleId,
            operation: 'update',
            data: {
              id: input.sourceSaleId,
              status: 'draft',
              tableId: currentSource.tableId,
              splitChildSaleId: newSaleId,
              syncVersion: (currentSource.syncVersion ?? 0) + 1,
            },
          });
          enqueueSyncInTransaction(syncContext, {
            entityType: 'sales',
            entityId: newSaleId,
            operation: 'create',
            data: {
              id: newSaleId,
              saleNumber: newSaleNumber,
              status: 'draft',
              tableId: effectiveNewTableId,
              sourceSaleId: input.sourceSaleId,
              syncVersion: 1,
            },
          });
          lifecycleContext.completeInTransaction?.(
            tx as unknown as typeof ctx.db,
            createSaleSplitCommandResultRef(input.sourceSaleId, newSaleId)
          );
        },
        { behavior: 'immediate' }
      );

      const [source, created] = await Promise.all([
        getSaleRecord(ctx.db, ctx.tenantId, input.sourceSaleId),
        getSaleRecord(ctx.db, ctx.tenantId, newSaleId),
      ]);

      // rewrite the source KDS snapshot (items moved out)
      // and create a fresh card for the carved-out draft when it
      // landed on a tableId. Both calls are no-ops when the kds
      // module is off or the rows have no kitchen footprint.
      const kdsCtx = buildKdsHookContext(ctx);
      await refreshKdsOrderItems({ ctx: kdsCtx, saleId: input.sourceSaleId });
      if (effectiveNewTableId) {
        await enqueueKdsOrder({ ctx: kdsCtx, saleId: newSaleId });
      }

      return { source, created };
    }),
};
