/**
 * Sales router draft-state procedures (suspend, resume, discardDraft, changeTable).
 *
 * Extracted from the former flat `trpc/routers/sales.ts` during the
 * megafile decomposition and now owns the complete draft lifecycle.
 * Exported as a procedure record that `index.ts` spreads into `salesRouter`
 * (paths unchanged). `splitDraft` lives in its own module for size.
 *
 * @module trpc/routers/sales/drafts
 */
import { submitKitchenSaleInTransaction } from '../../../application/kds/submit.js';
import { reconcileKitchenSaleInTransaction } from '../../../application/kds/sale-lifecycle.js';
import { and, eq } from 'drizzle-orm';

import {
  criticalCommandCashierManagerOrAdminProcedure,
  criticalCommandManagerOrAdminProcedure,
} from '../../middleware/criticalCommand.js';
import { restaurantTables, sales } from '../../../db/schema.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import {
  changeSaleTableInput,
  discardDraftInput,
  resumeSaleInput,
  suspendSaleInput,
} from '../../schemas/sales.js';
import { writeAuditLog } from '../../../services/audit-logs.js';
import { createSaleResourceCommandResultRef } from '../../../services/idempotency/commandResultRef.js';
import { enqueueSyncInTransaction } from '../../../services/sync/enqueue.js';
import { discardDraft as discardDraftService } from '../../../application/sales/discardDraft.js';
import { getSaleRecord } from '../../../application/sales/sale-read.js';
import { buildLifecycleContext } from './helpers.js';
import {
  assertDineInStillActive,
  ensureRestaurantCheckForSuspendedSale,
  moveRestaurantCheckInTransaction,
} from '../../../application/restaurant/service-lifecycle.js';
import {
  isSameSiteRestaurantHandoff,
  resolveDraftSiteEvidence,
} from '../../../application/sales/draft-site.js';
import { ownsActiveDraftClaim } from '../../../application/sales/draft-ownership.js';

export const salesDraftProcedures = {
  /**
   * Suspend a draft sale so the cashier can start another cart
   * without losing the in-progress one. Idempotent: re-suspending an
   * already-suspended sale just refreshes `suspendedAt` and the label.
   *
   * Invariants:
   * - Only draft sales may be suspended. Completed, cancelled, or voided
   * sales throw BAD_REQUEST.
   * - A cashier may suspend only a draft they created/already suspended, or
   * an open normalized restaurant check at their active site. Manager/admin
   * may take ownership as an auditable override.
   * - Suspending has no additional stock impact. Draft creation already
   * debited stock; completing preserves that debit and discard reverses it.
   */
  suspend: criticalCommandCashierManagerOrAdminProcedure
    .input(suspendSaleInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      const lifecycleContext = buildLifecycleContext(ctx);
      let tableIdForKds: string | null = null;

      // Acquire the SQLite writer before reading lifecycle state. Without this,
      // two devices could both authorize from the same pre-suspend snapshot and
      // overwrite syncVersion or write forensic before-values that never existed.
      await ctx.db.transaction(
        tx => {
          const existing = tx
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

          const draftSite = resolveDraftSiteEvidence(tx as unknown as typeof ctx.db, ctx.tenantId, {
            saleId: existing.id,
            cashSessionId: existing.cashSessionId,
            tableId: existing.tableId,
          });
          const actorRole = ctx.user?.role;
          const ownsActiveClaim = ownsActiveDraftClaim(
            existing,
            ctx.user!.id,
            lifecycleContext.deviceId
          );
          const ownsParkedDraft =
            existing.suspendedAt !== null &&
            (existing.createdBy === ctx.user!.id || existing.suspendedBy === ctx.user!.id);
          const ownsDraft = ownsActiveClaim || ownsParkedDraft;
          const canOverride = actorRole === 'manager' || actorRole === 'admin';
          const canRestaurantHandoff =
            existing.suspendedAt !== null &&
            actorRole === 'cashier' &&
            isSameSiteRestaurantHandoff(draftSite, ctx.siteId);
          if (!ownsActiveClaim && !ownsParkedDraft && !canOverride && !canRestaurantHandoff) {
            throwServerError({
              trpcCode: 'FORBIDDEN',
              errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED',
              message: 'Only the cashier who owns this active draft can suspend it',
              details: { operation: 'suspend' },
            });
          }

          const requestedTableId = input.tableId ?? existing.tableId;
          if (input.tableId) {
            assertDineInStillActive(tx as unknown as typeof ctx.db, ctx.tenantId);
          }
          if (requestedTableId && !draftSite.siteId) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'SALE_DRAFT_SITE_UNKNOWN',
              message: 'The draft site must be reconciled before assigning a restaurant table',
              details: { saleId: existing.id, tableId: requestedTableId },
            });
          }
          const resolvedTable = requestedTableId
            ? tx
                .select({
                  id: restaurantTables.id,
                  name: restaurantTables.name,
                  siteId: restaurantTables.siteId,
                })
                .from(restaurantTables)
                .where(
                  and(
                    eq(restaurantTables.id, requestedTableId),
                    eq(restaurantTables.tenantId, ctx.tenantId),
                    eq(restaurantTables.isActive, true),
                    eq(restaurantTables.siteId, draftSite.siteId!)
                  )
                )
                .get()
            : null;
          if (requestedTableId && !resolvedTable) {
            throwServerError({
              trpcCode: 'NOT_FOUND',
              errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
              message: `Restaurant table ${requestedTableId} not found for this tenant`,
              details: {
                tenantId: ctx.tenantId,
                tableId: requestedTableId,
                siteId: draftSite.siteId,
              },
            });
          }

          const label = resolvedTable
            ? resolvedTable.name
            : input.label && input.label.length > 0
              ? input.label
              : null;
          tableIdForKds = resolvedTable?.id ?? existing.tableId ?? null;

          const changed = tx
            .update(sales)
            .set({
              suspendedAt: now,
              suspendedBy: ctx.user!.id,
              resumedBy: null,
              resumedDeviceId: null,
              suspendedLabel: label,
              tableId: resolvedTable ? resolvedTable.id : (existing.tableId ?? null),
              syncStatus: 'pending',
              syncVersion: (existing.syncVersion ?? 0) + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(sales.id, input.saleId),
                eq(sales.tenantId, ctx.tenantId),
                eq(sales.status, 'draft')
              )
            )
            .run();
          if (changed.changes !== 1) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
              message: 'Draft sale changed while it was being suspended',
            });
          }

          if (resolvedTable) {
            ensureRestaurantCheckForSuspendedSale(
              tx as unknown as typeof ctx.db,
              {
                tenantId: ctx.tenantId,
                siteId: draftSite.siteId!,
                actorId: ctx.user!.id,
                now,
              },
              { saleId: input.saleId, tableId: resolvedTable.id, label }
            );
          }

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
              resumedBy: existing.resumedBy,
              resumedDeviceId: existing.resumedDeviceId,
              suspendedLabel: existing.suspendedLabel,
              tableId: existing.tableId,
            },
            after: {
              status: 'draft',
              suspendedAt: now,
              suspendedBy: ctx.user!.id,
              resumedBy: null,
              resumedDeviceId: null,
              suspendedLabel: label,
              tableId: tableIdForKds,
            },
            metadata: {
              ...(label ? { label } : {}),
              ...(resolvedTable ? { tableName: resolvedTable.name } : {}),
              ...(!ownsDraft && canRestaurantHandoff
                ? {
                    restaurantHandoff: true,
                    restaurantServiceId: draftSite.restaurant!.serviceId,
                    originalCreatedBy: existing.createdBy,
                    ...(existing.suspendedBy ? { originalSuspendedBy: existing.suspendedBy } : {}),
                  }
                : !ownsDraft
                  ? {
                      override: true,
                      originalCreatedBy: existing.createdBy,
                      ...(existing.suspendedBy
                        ? { originalSuspendedBy: existing.suspendedBy }
                        : {}),
                    }
                  : {}),
            },
          });

          enqueueSyncInTransaction(
            {
              db: tx as unknown as typeof ctx.db,
              tenantId: ctx.tenantId,
              envelope: lifecycleContext.envelope ?? null,
              deviceId: lifecycleContext.deviceId ?? null,
            },
            {
              entityType: 'sales',
              entityId: input.saleId,
              operation: 'update',
              data: {
                id: input.saleId,
                status: 'draft',
                suspendedAt: now,
                suspendedBy: ctx.user!.id,
                resumedBy: null,
                resumedDeviceId: null,
                suspendedLabel: label,
                tableId: tableIdForKds,
                syncVersion: (existing.syncVersion ?? 0) + 1,
              },
            }
          );
          reconcileKitchenSaleInTransaction(
            tx as unknown as typeof ctx.db,
            { tenantId: ctx.tenantId, siteId: draftSite.siteId ?? '', actorId: ctx.user!.id },
            input.saleId
          );
          submitKitchenSaleInTransaction(
            tx as unknown as typeof ctx.db,
            { tenantId: ctx.tenantId, siteId: draftSite.siteId ?? '', actorId: ctx.user!.id },
            input.saleId
          );
          lifecycleContext.completeInTransaction?.(
            tx as unknown as typeof ctx.db,
            createSaleResourceCommandResultRef(input.saleId)
          );
        },
        { behavior: 'immediate' }
      );

      return getSaleRecord(ctx.db, ctx.tenantId, input.saleId);
    }),

  /**
   * Resume a suspended draft. Clears the suspension metadata
   * so the cashier can keep editing the cart, but keeps
   * `status='draft'` so `sales.create`/`sales.update` flows still apply
   * as the terminal commit path.
   *
   * Lock: a suspended draft can be resumed by its suspending cashier, by a
   * cashier taking over an open normalized check at the same site, or by a
   * manager/admin override. An unsuspended claim is accepted only for its
   * current actor, which lets a re-authenticated session bind the durable
   * server claim back to this device after local-storage loss or expiry.
   */
  resume: criticalCommandCashierManagerOrAdminProcedure
    .input(resumeSaleInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      const lifecycleContext = buildLifecycleContext(ctx);
      await ctx.db.transaction(
        tx => {
          const existing = tx
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
          const isOwnRecoveryClaim =
            existing.status === 'draft' &&
            existing.suspendedAt === null &&
            existing.resumedBy === ctx.user!.id;
          if (
            existing.status !== 'draft' ||
            (existing.suspendedAt === null && !isOwnRecoveryClaim)
          ) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'SALE_NOT_SUSPENDED',
              message: 'Sale is not suspended or recoverable by this operator',
            });
          }

          const draftSite = resolveDraftSiteEvidence(tx as unknown as typeof ctx.db, ctx.tenantId, {
            saleId: existing.id,
            cashSessionId: existing.cashSessionId,
            tableId: existing.tableId,
          });
          const actorRole = ctx.user?.role;
          const isOwner =
            existing.suspendedBy === ctx.user!.id || existing.resumedBy === ctx.user!.id;
          const canOverride = actorRole === 'manager' || actorRole === 'admin';
          const canRestaurantHandoff =
            actorRole === 'cashier' && isSameSiteRestaurantHandoff(draftSite, ctx.siteId);
          if (!isOwner && !canOverride && !canRestaurantHandoff) {
            throwServerError({
              trpcCode: 'FORBIDDEN',
              errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED',
              message: 'Only the cashier who suspended this sale can resume it',
              details: { operation: 'resume' },
            });
          }

          if (
            isOwnRecoveryClaim &&
            lifecycleContext.deviceId !== null &&
            lifecycleContext.deviceId !== undefined &&
            existing.resumedDeviceId === lifecycleContext.deviceId
          ) {
            // Retrying recovery on the device that already owns this active
            // claim is a semantic no-op. Complete the new Command Envelope so
            // it remains replayable, but do not advance the sale version or
            // emit duplicate audit/outbox effects.
            lifecycleContext.completeInTransaction?.(
              tx as unknown as typeof ctx.db,
              createSaleResourceCommandResultRef(input.saleId)
            );
            return;
          }

          const changed = tx
            .update(sales)
            .set({
              suspendedAt: null,
              suspendedBy: null,
              resumedBy: ctx.user!.id,
              resumedDeviceId: lifecycleContext.deviceId ?? null,
              suspendedLabel: null,
              syncStatus: 'pending',
              syncVersion: (existing.syncVersion ?? 0) + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(sales.id, input.saleId),
                eq(sales.tenantId, ctx.tenantId),
                eq(sales.status, 'draft')
              )
            )
            .run();
          if (changed.changes !== 1) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
              message: 'Draft sale changed while it was being resumed',
            });
          }

          writeAuditLog({
            tx,
            tenantId: ctx.tenantId,
            actorId: ctx.user!.id,
            action: 'sale.resume',
            resourceType: 'sale',
            resourceId: input.saleId,
            before: {
              status: 'draft',
              suspendedAt: existing.suspendedAt,
              suspendedBy: existing.suspendedBy,
              resumedBy: existing.resumedBy,
              resumedDeviceId: existing.resumedDeviceId,
              suspendedLabel: existing.suspendedLabel,
            },
            after: {
              status: 'draft',
              suspendedAt: null,
              suspendedBy: null,
              resumedBy: ctx.user!.id,
              resumedDeviceId: lifecycleContext.deviceId ?? null,
              suspendedLabel: null,
            },
            metadata: {
              ...(existing.suspendedBy &&
              existing.suspendedBy !== ctx.user!.id &&
              canRestaurantHandoff
                ? {
                    restaurantHandoff: true,
                    restaurantServiceId: draftSite.restaurant!.serviceId,
                    originalSuspendedBy: existing.suspendedBy,
                  }
                : existing.suspendedBy && existing.suspendedBy !== ctx.user!.id
                  ? { override: true, originalSuspendedBy: existing.suspendedBy }
                  : {}),
            },
          });

          enqueueSyncInTransaction(
            {
              db: tx as unknown as typeof ctx.db,
              tenantId: ctx.tenantId,
              envelope: lifecycleContext.envelope ?? null,
              deviceId: lifecycleContext.deviceId ?? null,
            },
            {
              entityType: 'sales',
              entityId: input.saleId,
              operation: 'update',
              data: {
                id: input.saleId,
                status: 'draft',
                suspendedAt: null,
                suspendedBy: null,
                resumedBy: ctx.user!.id,
                resumedDeviceId: lifecycleContext.deviceId ?? null,
                suspendedLabel: null,
                tableId: existing.tableId,
                syncVersion: (existing.syncVersion ?? 0) + 1,
              },
            }
          );
          lifecycleContext.completeInTransaction?.(
            tx as unknown as typeof ctx.db,
            createSaleResourceCommandResultRef(input.saleId)
          );
        },
        { behavior: 'immediate' }
      );

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
  discardDraft: criticalCommandCashierManagerOrAdminProcedure
    .input(discardDraftInput)
    .mutation(async ({ ctx, input }) => {
      const result = await discardDraftService(buildLifecycleContext(ctx), {
        saleId: input.saleId,
      });
      return { id: result.id, status: result.status };
    }),

  /**
   * Move a suspended draft between restaurant tables. Passing `tableId: null`
   * detaches only a legacy draft that has no normalized restaurant check.
   *
   * Invariants:
   * - Target sale must be `status='draft'` AND suspended (otherwise
   * `SALE_CHANGE_TABLE_INVALID_STATUS`).
   * - Manager/admin only. Cashiers can suspend / resume their own
   * drafts, but moving a draft between physical tables is an
   * operations override.
   * - When `tableId` is non-null, the new row must belong to the
   * tenant and be active; otherwise `RESTAURANT_TABLE_NOT_FOUND`.
   * - `suspendedLabel` is refreshed to the new table's name when moving.
   * A normalized check cannot be detached from its physical table; a legacy
   * table-only draft keeps its prior label if it is detached.
   * - Emits a `sale.changeTable` audit row inside the UPDATE
   * transaction with before/after `tableId` + the resolved table
   * names in metadata for forensics.
   */
  changeTable: criticalCommandManagerOrAdminProcedure
    .input(changeSaleTableInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      const lifecycleContext = buildLifecycleContext(ctx);
      await ctx.db.transaction(
        tx => {
          const existing = tx
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
          if (input.tableId) {
            assertDineInStillActive(tx as unknown as typeof ctx.db, ctx.tenantId);
          }

          const draftSite = resolveDraftSiteEvidence(tx as unknown as typeof ctx.db, ctx.tenantId, {
            saleId: existing.id,
            cashSessionId: existing.cashSessionId,
            tableId: existing.tableId,
          });
          if (input.tableId && !draftSite.siteId) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'SALE_DRAFT_SITE_UNKNOWN',
              message: 'The draft site must be reconciled before moving it to a table',
              details: { saleId: existing.id, tableId: input.tableId },
            });
          }
          if (!input.tableId && !draftSite.restaurant && !existing.cashSessionId) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'SALE_DRAFT_SITE_UNKNOWN',
              message: "The current table is the draft's only remaining site evidence",
              details: { saleId: existing.id, tableId: existing.tableId },
            });
          }
          const resolvedTable = input.tableId
            ? tx
                .select({
                  id: restaurantTables.id,
                  name: restaurantTables.name,
                  siteId: restaurantTables.siteId,
                })
                .from(restaurantTables)
                .where(
                  and(
                    eq(restaurantTables.id, input.tableId),
                    eq(restaurantTables.tenantId, ctx.tenantId),
                    eq(restaurantTables.isActive, true),
                    eq(restaurantTables.siteId, draftSite.siteId!)
                  )
                )
                .get()
            : null;
          if (input.tableId && !resolvedTable) {
            throwServerError({
              trpcCode: 'NOT_FOUND',
              errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
              message: `Restaurant table ${input.tableId} not found for this tenant`,
              details: {
                tenantId: ctx.tenantId,
                tableId: input.tableId,
                siteId: draftSite.siteId,
              },
            });
          }

          const priorTableName = existing.tableId
            ? (tx
                .select({ name: restaurantTables.name })
                .from(restaurantTables)
                .where(
                  and(
                    eq(restaurantTables.id, existing.tableId),
                    eq(restaurantTables.tenantId, ctx.tenantId)
                  )
                )
                .get()?.name ?? null)
            : null;
          const nextTableId = resolvedTable?.id ?? null;
          const nextLabel = resolvedTable ? resolvedTable.name : existing.suspendedLabel;

          moveRestaurantCheckInTransaction(
            tx as unknown as typeof ctx.db,
            {
              tenantId: ctx.tenantId,
              siteId: draftSite.siteId ?? '',
              actorId: ctx.user!.id,
              now,
            },
            { saleId: input.saleId, targetTableId: nextTableId }
          );
          const changed = tx
            .update(sales)
            .set({
              tableId: nextTableId,
              suspendedLabel: nextLabel,
              syncStatus: 'pending',
              syncVersion: (existing.syncVersion ?? 0) + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(sales.id, input.saleId),
                eq(sales.tenantId, ctx.tenantId),
                eq(sales.status, 'draft')
              )
            )
            .run();
          if (changed.changes !== 1) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
              message: 'Draft sale changed while it was moving tables',
            });
          }

          if (resolvedTable) {
            // Legacy drafts can predate the normalized service graph. Moving
            // one onto an active table must adopt it immediately; otherwise
            // the table-state read would fail closed on a hidden draft after
            // this command had already reported success.
            ensureRestaurantCheckForSuspendedSale(
              tx as unknown as typeof ctx.db,
              {
                tenantId: ctx.tenantId,
                siteId: draftSite.siteId!,
                actorId: ctx.user!.id,
                now,
              },
              { saleId: input.saleId, tableId: resolvedTable.id, label: nextLabel }
            );
          }

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

          enqueueSyncInTransaction(
            {
              db: tx as unknown as typeof ctx.db,
              tenantId: ctx.tenantId,
              envelope: lifecycleContext.envelope ?? null,
              deviceId: lifecycleContext.deviceId ?? null,
            },
            {
              entityType: 'sales',
              entityId: input.saleId,
              operation: 'update',
              data: {
                id: input.saleId,
                status: 'draft',
                tableId: nextTableId,
                suspendedLabel: nextLabel,
                syncVersion: (existing.syncVersion ?? 0) + 1,
              },
            }
          );
          reconcileKitchenSaleInTransaction(
            tx as unknown as typeof ctx.db,
            { tenantId: ctx.tenantId, siteId: draftSite.siteId ?? '', actorId: ctx.user!.id },
            input.saleId
          );
          lifecycleContext.completeInTransaction?.(
            tx as unknown as typeof ctx.db,
            createSaleResourceCommandResultRef(input.saleId)
          );
        },
        { behavior: 'immediate' }
      );

      return getSaleRecord(ctx.db, ctx.tenantId, input.saleId);
    }),
};
