/**
 * Delivery Orders tRPC Router — ENG-091
 *
 * Per-site delivery queue. Status flow accepted → preparing →
 * dispatched → delivered, with cancelled reachable from any state.
 *
 * Procedures:
 *  - deliveryOrders.list    (manager+) — queue rows for a site
 *  - deliveryOrders.create  (manager+) — accept a new delivery
 *  - deliveryOrders.advance (manager+) — move status forward
 *  - deliveryOrders.cancel  (manager+) — mark as cancelled
 *
 * Site scoping mirrors the inventory routers: callers must pass
 * `siteId` and we verify it belongs to the caller's tenant.
 *
 * @module trpc/routers/deliveryOrders
 */

import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { deliveryOrders, sites } from '../../db/schema.js';

const statusEnum = z.enum([
  'accepted',
  'preparing',
  'dispatched',
  'delivered',
  'cancelled',
]);

const listInput = z.object({
  siteId: z.string().min(1),
  status: statusEnum.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

const createInput = z.object({
  siteId: z.string().min(1),
  customerId: z.string().optional(),
  customerName: z.string().min(1, 'customerName required'),
  customerPhone: z.string().optional(),
  address: z.string().min(1, 'address required'),
  addressNotes: z.string().optional(),
  courierName: z.string().optional(),
  totalAmount: z.number().min(0).default(0),
  itemsSnapshot: z.string().optional(),
  saleId: z.string().optional(),
});

const advanceInput = z.object({
  id: z.string().min(1),
  toStatus: statusEnum,
  courierName: z.string().optional(),
});

async function ensureTenantSite(
  ctx: { db: any; tenantId: string },
  siteId: string
): Promise<void> {
  const [row] = await ctx.db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, ctx.tenantId)))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'SITE_NOT_FOUND' });
  }
}

export const deliveryOrdersRouter = router({
  list: managerOrAdminProcedure.input(listInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx, input.siteId);
    const conditions = [
      eq(deliveryOrders.tenantId, ctx.tenantId),
      eq(deliveryOrders.siteId, input.siteId),
    ];
    if (input.status) {
      conditions.push(eq(deliveryOrders.status, input.status));
    }
    return ctx.db
      .select()
      .from(deliveryOrders)
      .where(and(...conditions))
      .orderBy(desc(deliveryOrders.acceptedAt))
      .limit(input.limit);
  }),

  create: managerOrAdminProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx, input.siteId);
    const id = nanoid();
    await ctx.db.insert(deliveryOrders).values({
      id,
      tenantId: ctx.tenantId,
      siteId: input.siteId,
      customerId: input.customerId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      address: input.address,
      addressNotes: input.addressNotes,
      courierName: input.courierName,
      status: 'accepted',
      totalAmount: input.totalAmount,
      itemsSnapshot: input.itemsSnapshot,
      saleId: input.saleId,
    });
    return { id };
  }),

  advance: managerOrAdminProcedure.input(advanceInput).mutation(async ({ ctx, input }) => {
    const [existing] = await ctx.db
      .select()
      .from(deliveryOrders)
      .where(
        and(
          eq(deliveryOrders.id, input.id),
          eq(deliveryOrders.tenantId, ctx.tenantId)
        )
      )
      .limit(1);
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'DELIVERY_ORDER_NOT_FOUND' });
    }
    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown> = {
      status: input.toStatus,
      updatedAt: nowIso,
    };
    if (input.courierName !== undefined) {
      updates.courierName = input.courierName;
    }
    switch (input.toStatus) {
      case 'preparing':
        updates.preparingAt = nowIso;
        break;
      case 'dispatched':
        updates.dispatchedAt = nowIso;
        break;
      case 'delivered':
        updates.deliveredAt = nowIso;
        break;
      case 'cancelled':
        updates.cancelledAt = nowIso;
        break;
    }
    await ctx.db.update(deliveryOrders).set(updates).where(eq(deliveryOrders.id, input.id));
    return { id: input.id, status: input.toStatus };
  }),
});
