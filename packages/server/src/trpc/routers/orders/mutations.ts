/**
 * Orders router — write procedures (ENG-178 split).
 *
 * `create` (purchase order via order sequential, no stock effect) + `void`
 * (admin; blocked after partial receipt). Tx-free; stock untouched.
 *
 * @module trpc/routers/orders/mutations
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { orderItems, orders, sequentials } from '../../../db/schema.js';
import { enqueueSync } from '../../../services/sync/enqueue.js';
import { managerOrAdminProcedure, adminProcedure } from '../../middleware/roles.js';
import { createOrderInput, voidOrderInput } from '../../schemas/orders.js';
import { buildVoidedOrderNotes, getOrderSequentialContext, validateProvider, resolveOrderItems, getOrderRecord } from './helpers.js';

export const ordersMutationProcedures = {

  create: managerOrAdminProcedure.input(createOrderInput).mutation(async ({ ctx, input }) => {
    await validateProvider(ctx.db, ctx.tenantId, input.providerId);

    const now = new Date().toISOString();
    const orderId = nanoid();
    const sequentialContext = await getOrderSequentialContext(ctx.db, ctx.tenantId, ctx.siteId);
    const resolvedItems = await resolveOrderItems(ctx.db, ctx.tenantId, input.items);
    const subtotal = resolvedItems.subtotal;
    const total = subtotal;
    const nextSequentialValue = sequentialContext.currentValue + 1;
    const orderNumber = `${sequentialContext.prefix}${String(nextSequentialValue).padStart(6, '0')}`;

    ctx.db.transaction(tx => {
      tx.update(sequentials)
        .set({
          currentValue: nextSequentialValue,
          updatedAt: now,
        })
        .where(eq(sequentials.id, sequentialContext.id))
        .run();

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
    });

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

    const nextSyncVersion = (existing.syncVersion ?? 0) + 1;
    const now = new Date().toISOString();

    ctx.db.transaction(tx => {
      tx.update(orders)
        .set({
          status: 'voided',
          notes: buildVoidedOrderNotes(existing.notes, input.reason),
          updatedAt: now,
          syncStatus: 'pending',
          syncVersion: nextSyncVersion,
        })
        .where(eq(orders.id, input.id))
        .run();
    });

    await enqueueSync(ctx, {
      entityType: 'orders',
      entityId: input.id,
      operation: 'update',
      data: { id: input.id, status: 'voided', reason: input.reason },
    });

    return getOrderRecord(ctx.db, ctx.tenantId, input.id);
  }),
};
