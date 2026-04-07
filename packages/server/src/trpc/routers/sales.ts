/**
 * Sales tRPC Router
 *
 * Sales management with transactional creation.
 *
 * Procedures:
 * - sales.list      (tenant) - List sales with pagination/filtering
 * - sales.getById   (tenant) - Get a single sale with items
 * - sales.create    (tenant) - Create sale + items + inventory movements (transaction)
 * - sales.update    (tenant) - Update payment method/status/notes
 * - sales.void      (tenant, admin) - Void a sale
 *
 * @module trpc/routers/sales
 */

import { TRPCError } from '@trpc/server';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { sales, saleItems, products, inventoryMovements, syncQueue } from '../../db/schema.js';
import {
  listSalesInput,
  getSaleInput,
  createSaleInput,
  updateSaleInput,
  voidSaleInput,
} from '../schemas/sales.js';

export const salesRouter = router({
  summary: tenantProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const [today, totals, pending] = await Promise.all([
      ctx.db
        .select({
          total: sql<number>`coalesce(sum(${sales.total}), 0)`,
        })
        .from(sales)
        .where(
          and(
            eq(sales.tenantId, ctx.tenantId),
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
        .where(eq(sales.tenantId, ctx.tenantId))
        .get(),
      ctx.db
        .select({
          total: sql<number>`coalesce(sum(${sales.total}), 0)`,
        })
        .from(sales)
        .where(and(eq(sales.tenantId, ctx.tenantId), eq(sales.paymentStatus, 'pending')))
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
      ctx.db.select().from(sales).where(where).limit(perPage).offset(offset).all(),
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
    const sale = await ctx.db
      .select()
      .from(sales)
      .where(and(eq(sales.id, input.id), eq(sales.tenantId, ctx.tenantId)))
      .get();

    if (!sale) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Sale not found' });
    }

    const items = await ctx.db.select().from(saleItems).where(eq(saleItems.saleId, input.id)).all();

    return { ...sale, items };
  }),

  /**
   * Create a sale with items in a single transaction.
   *
   * - Calculates subtotal, taxAmount, total from items
   * - Decrements product stock for each item
   * - Creates inventory_movement records (type: 'sale')
   * - Adds to sync queue
   */
  create: tenantProcedure.input(createSaleInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const saleId = nanoid();

    // Generate sale number: count existing sales for this tenant + 1
    const countResult = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(sales)
      .where(eq(sales.tenantId, ctx.tenantId))
      .get();
    const saleNumber = `SALE-${String((countResult?.count ?? 0) + 1).padStart(6, '0')}`;

    // Pre-fetch all products to calculate totals and validate stock
    const productRows = await ctx.db
      .select()
      .from(products)
      .where(eq(products.tenantId, ctx.tenantId))
      .all();
    const productMap = new Map(productRows.map(p => [p.id, p]));

    for (const item of input.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Product ${item.productId} not found`,
        });
      }
      if (product.stock < item.quantity) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Insufficient stock for product "${product.name}". Available: ${product.stock}, requested: ${item.quantity}`,
        });
      }
    }

    // Calculate totals
    let subtotal = 0;
    let taxAmount = 0;
    const itemRows: Array<{
      id: string;
      saleId: string;
      productId: string;
      quantity: number;
      unitPrice: number;
      discount: number;
      taxRate: number;
      taxAmount: number;
      total: number;
    }> = [];

    for (const item of input.items) {
      const lineSubtotal = item.unitPrice * item.quantity;
      const lineDiscount = lineSubtotal * (item.discount / 100);
      const lineAfterDiscount = lineSubtotal - lineDiscount;
      const lineTax = lineAfterDiscount * (item.taxRate / 100);
      const lineTotal = lineAfterDiscount + lineTax;

      subtotal += lineAfterDiscount;
      taxAmount += lineTax;

      itemRows.push({
        id: nanoid(),
        saleId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        taxRate: item.taxRate,
        taxAmount: lineTax,
        total: lineTotal,
      });
    }

    const total = subtotal + taxAmount - (input.discountAmount ?? 0);

    // Execute everything in a transaction (better-sqlite3 requires a synchronous callback)
    ctx.db.transaction(tx => {
      // Insert sale
      tx.insert(sales)
        .values({
          id: saleId,
          tenantId: ctx.tenantId,
          saleNumber,
          customerId: input.customerId,
          subtotal,
          taxAmount,
          discountAmount: input.discountAmount ?? 0,
          total,
          paymentMethod: input.paymentMethod,
          paymentStatus: input.paymentStatus,
          status: input.status,
          notes: input.notes,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // Insert sale items
      for (const row of itemRows) {
        tx.insert(saleItems).values(row).run();
      }

      // Decrement stock and create inventory movements
      for (const item of input.items) {
        const product = productMap.get(item.productId)!;
        const newStock = product.stock - item.quantity;

        tx.update(products)
          .set({
            stock: newStock,
            syncStatus: 'pending',
            syncVersion: (product.syncVersion ?? 0) + 1,
            updatedAt: now,
          })
          .where(eq(products.id, item.productId))
          .run();

        tx.insert(inventoryMovements)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            productId: item.productId,
            type: 'sale',
            quantity: item.quantity,
            previousStock: product.stock,
            newStock,
            reference: saleId,
            notes: `Sale ${saleNumber}`,
            createdBy: ctx.user!.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
      }

      // Add sale to sync queue
      tx.insert(syncQueue)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          entityType: 'sales',
          entityId: saleId,
          operation: 'create',
          data: { id: saleId, saleNumber, total },
          localVersion: 1,
          attempts: 0,
          createdAt: now,
        })
        .run();
    });

    const created = await ctx.db.select().from(sales).where(eq(sales.id, saleId)).get();

    const createdItems = await ctx.db
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .all();

    return { ...created!, items: createdItems };
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
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Sale not found' });
    }

    if (existing.status === 'voided') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot update a voided sale' });
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

    await ctx.db.update(sales).set(updateData).where(eq(sales.id, id));

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'sales',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const updated = await ctx.db.select().from(sales).where(eq(sales.id, id)).get();

    return updated!;
  }),

  /**
   * Void a sale (admin only). Does NOT reverse inventory movements.
   */
  void: tenantProcedure.input(voidSaleInput).mutation(async ({ ctx, input }) => {
    if (ctx.user!.role !== 'admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only administrators can void sales' });
    }

    const existing = await ctx.db
      .select()
      .from(sales)
      .where(and(eq(sales.id, input.id), eq(sales.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Sale not found' });
    }

    if (existing.status === 'voided') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sale is already voided' });
    }

    const now = new Date().toISOString();
    await ctx.db
      .update(sales)
      .set({
        status: 'voided',
        notes: input.reason
          ? `${existing.notes ? existing.notes + ' | ' : ''}Voided: ${input.reason}`
          : existing.notes,
        updatedAt: now,
        syncStatus: 'pending',
        syncVersion: (existing.syncVersion ?? 0) + 1,
      })
      .where(eq(sales.id, input.id));

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'sales',
      entityId: input.id,
      operation: 'update',
      data: { id: input.id, status: 'voided' },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const updated = await ctx.db.select().from(sales).where(eq(sales.id, input.id)).get();
    return updated!;
  }),
});
