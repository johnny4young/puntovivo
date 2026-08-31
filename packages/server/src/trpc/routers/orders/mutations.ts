/**
 * Orders router — write procedures ( split).
 *
 * `create` (purchase order via order sequential, no stock effect) + `void`
 * (admin; blocked after partial receipt). Stock remains untouched.
 *
 * @module trpc/routers/orders/mutations
 */
import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { orderItems, orders } from '../../../db/schema.js';
import { enqueueSync } from '../../../services/sync/enqueue.js';
import { allocateNextSequential } from '../../../services/sequential-allocation.js';
import { managerOrAdminProcedure, adminProcedure } from '../../middleware/roles.js';
import { createOrderInput, voidOrderInput } from '../../schemas/orders.js';
import {
  buildVoidedOrderNotes,
  getOrderSequentialContext,
  validateProvider,
  resolveOrderItems,
  getOrderRecord,
} from './helpers.js';

export const ordersMutationProcedures = {
  create: managerOrAdminProcedure.input(createOrderInput).mutation(async ({ ctx, input }) => {
    await validateProvider(ctx.db, ctx.tenantId, input.providerId);

    const now = new Date().toISOString();
    const orderId = nanoid();
    const sequentialContext = await getOrderSequentialContext(ctx.db, ctx.tenantId, ctx.siteId);
    const resolvedItems = await resolveOrderItems(ctx.db, ctx.tenantId, input.items);
    const subtotal = resolvedItems.subtotal;
    const total = subtotal;
    let orderNumber = '';

    ctx.db.transaction(
      tx => {
        orderNumber = allocateNextSequential(tx as unknown as typeof ctx.db, {
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
            status: 'submitted',
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
      },
      { behavior: 'immediate' }
    );

    for (const row of resolvedItems.rows) {
      await enqueueSync(ctx, {
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

    await enqueueSync(ctx, {
      entityType: 'orders',
      entityId: orderId,
      operation: 'create',
      data: {
        id: orderId,
        orderNumber,
        providerId: input.providerId,
        siteId: sequentialContext.siteId,
        status: 'submitted',
        total,
      },
    });

    return getOrderRecord(ctx.db, ctx.tenantId, orderId);
  }),

  void: adminProcedure.input(voidOrderInput).mutation(async ({ ctx, input }) => {
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

    const now = new Date().toISOString();

    ctx.db.transaction(
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
      },
      { behavior: 'immediate' }
    );

    await enqueueSync(ctx, {
      entityType: 'orders',
      entityId: input.id,
      operation: 'update',
      data: { id: input.id, status: 'voided', reason: input.reason },
    });

    return getOrderRecord(ctx.db, ctx.tenantId, input.id);
  }),
};
