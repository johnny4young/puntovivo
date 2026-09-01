/**
 * Orders router — write procedures ( split).
 *
 * `create` (purchase order via order sequential, no stock effect) + `void`
 * (manager may discard drafts; only admin may void a submitted order; blocked
 * after partial receipt). Stock remains untouched.
 *
 * @module trpc/routers/orders/mutations
 */
import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { orderItems, orders } from '../../../db/schema.js';
import { enqueueSyncInTransaction } from '../../../services/sync/enqueue.js';
import { allocateNextSequential } from '../../../services/sequential-allocation.js';
import { writeAuditLog } from '../../../services/audit-logs.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { criticalCommandManagerOrAdminProcedure } from '../../middleware/criticalCommand.js';
import { asCriticalCommandContext } from '../../middleware/commandEnvelope.js';
import { createOrderInput, submitOrderInput, voidOrderInput } from '../../schemas/orders.js';
import {
  buildVoidedOrderNotes,
  getOrderSequentialContext,
  validateProvider,
  resolveOrderItems,
  getOrderRecord,
} from './helpers.js';

export const ordersMutationProcedures = {
  create: criticalCommandManagerOrAdminProcedure
    .input(createOrderInput)
    .mutation(async ({ ctx, input }) => {
      const critical = asCriticalCommandContext(ctx);
      await validateProvider(ctx.db, ctx.tenantId, input.providerId);

      const now = new Date().toISOString();
      const orderId = nanoid();
      const sequentialContext = await getOrderSequentialContext(ctx.db, ctx.tenantId, ctx.siteId);
      const resolvedItems = await resolveOrderItems(ctx.db, ctx.tenantId, input.items);
      const subtotal = resolvedItems.subtotal;
      const total = subtotal;
      return ctx.db.transaction(
        tx => {
          const orderNumber = allocateNextSequential(tx as unknown as typeof ctx.db, {
            tenantId: ctx.tenantId,
            sequentialId: sequentialContext.id,
            updatedAt: now,
          }).number;

          tx.insert(orders)
            .values({
              id: orderId,
              tenantId: ctx.tenantId,
              orderNumber,
              providerId: input.providerId,
              siteId: sequentialContext.siteId,
              status: input.status,
              subtotal,
              total,
              notes: input.notes,
              createdBy: ctx.user!.id,
              syncStatus: 'pending',
              syncVersion: 1,
              createdAt: now,
              updatedAt: now,
            })
            .run();

          for (const row of resolvedItems.rows) {
            tx.insert(orderItems)
              .values({
                id: row.id,
                orderId,
                productId: row.productId,
                quantity: row.quantity,
                unitId: row.unitId,
                unitEquivalence: row.unitEquivalence,
                costPerUnit: row.costPerUnit,
                baseUnitCost: row.baseUnitCost,
                total: row.total,
              })
              .run();
          }

          writeAuditLog({
            tx,
            tenantId: ctx.tenantId,
            actorId: ctx.user!.id,
            action: 'order.create',
            resourceType: 'order',
            resourceId: orderId,
            before: null,
            after: {
              status: input.status,
              orderNumber,
              total,
              lineCount: resolvedItems.rows.length,
            },
            metadata: {
              providerId: input.providerId,
              siteId: sequentialContext.siteId,
              siteName: sequentialContext.siteName,
            },
            operationId: critical.envelope.operationId,
          });

          const syncContext = { ...critical, db: tx as unknown as typeof ctx.db };
          for (const row of resolvedItems.rows) {
            enqueueSyncInTransaction(syncContext, {
              entityType: 'order_items',
              entityId: row.id,
              operation: 'create',
              data: {
                id: row.id,
                orderId,
                productId: row.productId,
                quantity: row.quantity,
                unitId: row.unitId,
                unitEquivalence: row.unitEquivalence,
                costPerUnit: row.costPerUnit,
                baseUnitCost: row.baseUnitCost,
                total: row.total,
              },
            });
          }
          enqueueSyncInTransaction(syncContext, {
            entityType: 'orders',
            entityId: orderId,
            operation: 'create',
            data: {
              id: orderId,
              orderNumber,
              providerId: input.providerId,
              siteId: sequentialContext.siteId,
              status: input.status,
              total,
            },
          });

          const result = getOrderRecord(tx as unknown as typeof ctx.db, ctx.tenantId, orderId);
          critical.completeInTransaction(tx as unknown as typeof ctx.db, result);
          return result;
        },
        { behavior: 'immediate' }
      );
    }),

  void: criticalCommandManagerOrAdminProcedure
    .input(voidOrderInput)
    .mutation(async ({ ctx, input }) => {
      const critical = asCriticalCommandContext(ctx);
      const existing = await ctx.db
        .select()
        .from(orders)
        .where(and(eq(orders.id, input.id), eq(orders.tenantId, ctx.tenantId)))
        .get();

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }

      if (existing.status === 'voided') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order is already voided' });
      }

      if (existing.status === 'received' || existing.status === 'partial_received') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Orders with received stock cannot be voided',
        });
      }

      if (ctx.user!.role !== 'admin' && existing.status !== 'draft') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only administrators can void a submitted purchase order',
        });
      }

      const now = new Date().toISOString();

      return ctx.db.transaction(
        tx => {
          // The preflight above is only for fast feedback. Re-read after taking
          // the writer reservation so receipt and void cannot both commit: if a
          // receipt won first, its received status blocks the void; if this void
          // wins first, createPurchaseFromOrder's status/version claim fails.
          const current = tx
            .select()
            .from(orders)
            .where(and(eq(orders.id, input.id), eq(orders.tenantId, ctx.tenantId)))
            .get();
          if (!current) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
          }
          if (current.status === 'voided') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order is already voided' });
          }
          if (current.status === 'received' || current.status === 'partial_received') {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Orders with received stock cannot be voided',
            });
          }
          // Managers own replenishment planning and therefore need to be able to
          // discard an abandoned draft. Re-check the state under the writer
          // reservation so a concurrent submit cannot widen that permission.
          if (ctx.user!.role !== 'admin' && current.status !== 'draft') {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Only administrators can void a submitted purchase order',
            });
          }

          const expectedSyncVersion =
            current.syncVersion === null
              ? isNull(orders.syncVersion)
              : eq(orders.syncVersion, current.syncVersion);
          const updated = tx
            .update(orders)
            .set({
              status: 'voided',
              notes: buildVoidedOrderNotes(current.notes, input.reason),
              updatedAt: now,
              syncStatus: 'pending',
              syncVersion: (current.syncVersion ?? 0) + 1,
            })
            .where(
              and(
                eq(orders.id, input.id),
                eq(orders.tenantId, ctx.tenantId),
                eq(orders.status, current.status),
                expectedSyncVersion,
                eq(orders.updatedAt, current.updatedAt)
              )
            )
            .run();
          if (updated.changes !== 1) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Order changed while it was being voided',
            });
          }

          writeAuditLog({
            tx,
            tenantId: ctx.tenantId,
            actorId: ctx.user!.id,
            action: 'order.void',
            resourceType: 'order',
            resourceId: input.id,
            before: {
              status: current.status,
              orderNumber: current.orderNumber,
              total: current.total,
            },
            after: { status: 'voided' },
            metadata: {
              siteId: current.siteId,
              ...(input.reason ? { reason: input.reason } : {}),
            },
            operationId: critical.envelope.operationId,
          });

          enqueueSyncInTransaction(
            { ...critical, db: tx as unknown as typeof ctx.db },
            {
              entityType: 'orders',
              entityId: input.id,
              operation: 'update',
              data: { id: input.id, status: 'voided', reason: input.reason },
            }
          );

          const result = getOrderRecord(tx as unknown as typeof ctx.db, ctx.tenantId, input.id);
          critical.completeInTransaction(tx as unknown as typeof ctx.db, result);
          return result;
        },
        { behavior: 'immediate' }
      );
    }),

  submitDraft: criticalCommandManagerOrAdminProcedure
    .input(submitOrderInput)
    .mutation(async ({ ctx, input }) => {
      const critical = asCriticalCommandContext(ctx);
      const now = new Date().toISOString();

      return ctx.db.transaction(
        tx => {
          const current = tx
            .select()
            .from(orders)
            .where(and(eq(orders.id, input.id), eq(orders.tenantId, ctx.tenantId)))
            .get();
          if (!current) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
          }
          if (current.status !== 'draft') {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'ORDER_DRAFT_INVALID_STATUS',
              message: 'Only a purchase-order draft can be submitted',
              details: { status: current.status },
            });
          }

          const expectedSyncVersion =
            current.syncVersion === null
              ? isNull(orders.syncVersion)
              : eq(orders.syncVersion, current.syncVersion);
          const updated = tx
            .update(orders)
            .set({
              status: 'submitted',
              updatedAt: now,
              syncStatus: 'pending',
              syncVersion: (current.syncVersion ?? 0) + 1,
            })
            .where(
              and(
                eq(orders.id, input.id),
                eq(orders.tenantId, ctx.tenantId),
                eq(orders.status, 'draft'),
                expectedSyncVersion,
                eq(orders.updatedAt, current.updatedAt)
              )
            )
            .run();
          if (updated.changes !== 1) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Order changed while it was being submitted',
            });
          }

          writeAuditLog({
            tx,
            tenantId: ctx.tenantId,
            actorId: ctx.user!.id,
            action: 'order.submit',
            resourceType: 'order',
            resourceId: input.id,
            before: { status: 'draft', orderNumber: current.orderNumber, total: current.total },
            after: { status: 'submitted' },
            metadata: { providerId: current.providerId, siteId: current.siteId },
            operationId: critical.envelope.operationId,
          });
          enqueueSyncInTransaction(
            { ...critical, db: tx as unknown as typeof ctx.db },
            {
              entityType: 'orders',
              entityId: input.id,
              operation: 'update',
              data: { id: input.id, status: 'submitted' },
            }
          );

          const result = getOrderRecord(tx as unknown as typeof ctx.db, ctx.tenantId, input.id);
          critical.completeInTransaction(tx as unknown as typeof ctx.db, result);
          return result;
        },
        { behavior: 'immediate' }
      );
    }),
};
