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
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure } from '../middleware/roles.js';
import {
  customers,
  inventoryMovements,
  products,
  saleItems,
  sales,
  sequentials,
  sites,
  syncQueue,
  unitXProduct,
  units,
} from '../../db/schema.js';
import type { Context } from '../context.js';
import {
  createSaleInput,
  getSaleInput,
  listSalesInput,
  updateSaleInput,
  voidSaleInput,
} from '../schemas/sales.js';
import type { CreateSaleInput } from '../schemas/sales.js';

type ResolvedSaleItem = {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  unitId: string;
  unitEquivalence: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  costAtSale: number;
  total: number;
  normalizedQuantity: number;
};

type SaleSequentialContext = {
  id: string;
  prefix: string;
  currentValue: number;
  siteId: string;
  siteName: string;
};

function getNormalizedSaleQuantity(quantity: number, equivalence: number) {
  const normalizedQuantity = quantity * equivalence;

  if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The selected quantity must resolve to a positive stock quantity',
    });
  }

  if (!Number.isInteger(normalizedQuantity)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The selected quantity and unit equivalence must resolve to a whole stock quantity',
    });
  }

  return normalizedQuantity;
}

function getPaymentStatus({
  amountReceived,
  paymentMethod,
  requestedStatus,
  total,
}: {
  amountReceived: number | undefined;
  paymentMethod: 'cash' | 'card' | 'transfer' | 'credit' | 'other';
  requestedStatus: 'pending' | 'paid' | 'partial' | 'refunded';
  total: number;
}) {
  if (paymentMethod === 'credit') {
    return requestedStatus;
  }

  if (amountReceived === undefined) {
    return requestedStatus;
  }

  if (amountReceived >= total) {
    return 'paid' as const;
  }

  if (amountReceived > 0) {
    return 'partial' as const;
  }

  return requestedStatus;
}

function buildVoidedSaleNotes(existingNotes: string | null, reason: string | undefined) {
  if (!reason) {
    return existingNotes;
  }

  return `${existingNotes ? `${existingNotes} | ` : ''}Voided: ${reason}`;
}

async function getSaleSequentialContext(
  db: Context['db'],
  tenantId: string,
  siteId: string | null
): Promise<SaleSequentialContext> {
  const baseConditions = [
    eq(sequentials.tenantId, tenantId),
    eq(sequentials.documentType, 'sale'),
    eq(sites.isActive, true),
  ];

  if (siteId) {
    const siteScopedSequential = await db
      .select({
        id: sequentials.id,
        prefix: sequentials.prefix,
        currentValue: sequentials.currentValue,
        siteId: sequentials.siteId,
        siteName: sites.name,
      })
      .from(sequentials)
      .innerJoin(sites, eq(sequentials.siteId, sites.id))
      .where(and(...baseConditions, eq(sequentials.siteId, siteId)))
      .get();

    if (siteScopedSequential) {
      return siteScopedSequential;
    }
  }

  const fallbackSequential = await db
    .select({
      id: sequentials.id,
      prefix: sequentials.prefix,
      currentValue: sequentials.currentValue,
      siteId: sequentials.siteId,
      siteName: sites.name,
    })
    .from(sequentials)
    .innerJoin(sites, eq(sequentials.siteId, sites.id))
    .where(and(...baseConditions))
    .orderBy(asc(sites.name))
    .get();

  if (!fallbackSequential) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'No active sale sequential is configured for the current tenant',
    });
  }

  return fallbackSequential;
}

async function validateCustomer(
  db: Context['db'],
  tenantId: string,
  customerId: string | undefined
) {
  if (!customerId) {
    return;
  }

  const customer = await db
    .select({ id: customers.id, isActive: customers.isActive })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
    .get();

  if (!customer || customer.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected customer was not found or is inactive',
    });
  }
}

async function resolveSaleItems(
  db: Context['db'],
  tenantId: string,
  inputItems: CreateSaleInput['items']
) {
  const productIds = [...new Set(inputItems.map(item => item.productId))];
  const productRows = await db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)))
    .all();
  const productMap = new Map(productRows.map(product => [product.id, product]));

  const unitAssignments = await db
    .select({
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      equivalence: unitXProduct.equivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      isActive: units.isActive,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(inArray(unitXProduct.productId, productIds))
    .all();

  const assignmentMap = new Map(
    unitAssignments.map(assignment => [`${assignment.productId}:${assignment.unitId}`, assignment])
  );
  const remainingStockByProduct = new Map(productRows.map(product => [product.id, product.stock]));

  let subtotal = 0;
  let taxAmount = 0;

  const rows: ResolvedSaleItem[] = [];

  for (const item of inputItems) {
    const product = productMap.get(item.productId);

    if (!product || product.isActive === false) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Product ${item.productId} was not found or is inactive`,
      });
    }

    const assignment = assignmentMap.get(`${item.productId}:${item.unitId}`);
    if (!assignment || assignment.isActive === false) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unit selection is invalid for product "${product.name}"`,
      });
    }

    const normalizedQuantity = getNormalizedSaleQuantity(item.quantity, assignment.equivalence);
    const remainingStock = remainingStockByProduct.get(item.productId) ?? product.stock;

    if (remainingStock < normalizedQuantity) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `Insufficient stock for product "${product.name}". Available: ${remainingStock}, requested: ${normalizedQuantity}`,
      });
    }

    remainingStockByProduct.set(item.productId, remainingStock - normalizedQuantity);

    const grossAmount = item.unitPrice * item.quantity;
    const discountAmount = grossAmount * (item.discount / 100);
    const lineTotal = grossAmount - discountAmount;
    const taxRate = item.taxRate ?? product.taxRate ?? 0;
    const lineBase = taxRate > 0 ? lineTotal / (1 + taxRate / 100) : lineTotal;
    const lineTax = lineTotal - lineBase;

    subtotal += lineBase;
    taxAmount += lineTax;

    rows.push({
      id: nanoid(),
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      unitId: item.unitId,
      unitEquivalence: assignment.equivalence,
      discount: item.discount,
      taxRate,
      taxAmount: lineTax,
      costAtSale: product.cost,
      total: lineTotal,
      normalizedQuantity,
    });
  }

  return {
    productStocks: new Map(productRows.map(product => [product.id, product.stock])),
    subtotal,
    taxAmount,
    rows,
  };
}

async function getSaleRecord(db: Context['db'], tenantId: string, saleId: string) {
  const sale = await db
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
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
    .get();

  if (!sale) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Sale not found' });
  }

  const items = await db
    .select({
      id: saleItems.id,
      saleId: saleItems.saleId,
      productId: saleItems.productId,
      productName: products.name,
      productSku: products.sku,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      unitId: saleItems.unitId,
      unitEquivalence: saleItems.unitEquivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      discount: saleItems.discount,
      taxRate: saleItems.taxRate,
      taxAmount: saleItems.taxAmount,
      costAtSale: saleItems.costAtSale,
      total: saleItems.total,
    })
    .from(saleItems)
    .leftJoin(products, eq(saleItems.productId, products.id))
    .leftJoin(units, eq(saleItems.unitId, units.id))
    .where(eq(saleItems.saleId, saleId))
    .all();

  return { ...sale, items };
}

export const salesRouter = router({
  summary: tenantProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const completedSaleConditions = [eq(sales.tenantId, ctx.tenantId), eq(sales.status, 'completed')];

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
        .where(
          and(
            ...completedSaleConditions,
            eq(sales.paymentStatus, 'pending')
          )
        )
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
        })
        .from(sales)
        .leftJoin(customers, eq(sales.customerId, customers.id))
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
   */
  create: tenantProcedure.input(createSaleInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const saleId = nanoid();

    await validateCustomer(ctx.db, ctx.tenantId, input.customerId);

    const sequentialContext = await getSaleSequentialContext(ctx.db, ctx.tenantId, ctx.siteId);
    const resolvedItems = await resolveSaleItems(ctx.db, ctx.tenantId, input.items);
    const subtotal = resolvedItems.subtotal;
    const taxAmount = resolvedItems.taxAmount;
    const total = subtotal + taxAmount - (input.discountAmount ?? 0);
    if (total < 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Discount amount cannot exceed the sale total',
      });
    }
    const paymentStatus = getPaymentStatus({
      amountReceived: input.amountReceived,
      paymentMethod: input.paymentMethod,
      requestedStatus: input.paymentStatus,
      total,
    });
    const change =
      input.amountReceived !== undefined && input.amountReceived > total
        ? input.amountReceived - total
        : 0;

    if (input.amountReceived !== undefined && paymentStatus === 'paid' && input.amountReceived < total) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Amount received cannot be less than the sale total for a paid sale',
      });
    }

    const nextSequentialValue = sequentialContext.currentValue + 1;
    const saleNumber = `${sequentialContext.prefix}${String(nextSequentialValue).padStart(6, '0')}`;
    const productStockState = new Map(resolvedItems.productStocks);

    ctx.db.transaction(tx => {
      tx.update(sequentials)
        .set({
          currentValue: nextSequentialValue,
          updatedAt: now,
        })
        .where(eq(sequentials.id, sequentialContext.id))
        .run();

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
          paymentStatus,
          status: input.status,
          notes: input.notes,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      for (const row of resolvedItems.rows) {
        tx.insert(saleItems)
          .values({
            id: row.id,
            saleId,
            productId: row.productId,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            unitId: row.unitId,
            unitEquivalence: row.unitEquivalence,
            discount: row.discount,
            taxRate: row.taxRate,
            taxAmount: row.taxAmount,
            costAtSale: row.costAtSale,
            total: row.total,
          })
          .run();

        const effectivePreviousStock = productStockState.get(row.productId) ?? 0;
        const newStock = effectivePreviousStock - row.normalizedQuantity;

        productStockState.set(row.productId, newStock);

        tx.update(products)
          .set({
            stock: newStock,
            syncStatus: 'pending',
            syncVersion: sql`${products.syncVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(products.id, row.productId))
          .run();

        tx.insert(inventoryMovements)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            productId: row.productId,
            type: 'sale',
            quantity: row.normalizedQuantity,
            previousStock: effectivePreviousStock,
            newStock,
            reference: saleId,
            notes: `Sale ${saleNumber} · ${sequentialContext.siteName}`,
            createdBy: ctx.user!.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
      }

      tx.insert(syncQueue)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          entityType: 'sales',
          entityId: saleId,
          operation: 'create',
          data: {
            id: saleId,
            saleNumber,
            total,
            siteId: sequentialContext.siteId,
            paymentStatus,
          },
          localVersion: 1,
          attempts: 0,
          createdAt: now,
        })
        .run();
    });

    const created = await getSaleRecord(ctx.db, ctx.tenantId, saleId);

    return {
      ...created,
      change,
    };
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
   * Void a completed sale (admin only) and reverse the related stock movements.
   */
  void: adminProcedure.input(voidSaleInput).mutation(async ({ ctx, input }) => {
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

    if (existing.status !== 'completed') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only completed sales can be voided',
      });
    }

    const saleLineItems = await ctx.db
      .select({
        id: saleItems.id,
        productId: saleItems.productId,
        quantity: saleItems.quantity,
        unitEquivalence: saleItems.unitEquivalence,
      })
      .from(saleItems)
      .where(eq(saleItems.saleId, input.id))
      .all();

    if (saleLineItems.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot void a sale without line items',
      });
    }

    const productIds = [...new Set(saleLineItems.map(item => item.productId))];
    const currentProducts = await ctx.db
      .select({
        id: products.id,
        stock: products.stock,
      })
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, productIds)))
      .all();

    const productStockState = new Map(currentProducts.map(product => [product.id, product.stock]));
    const nextSyncVersion = (existing.syncVersion ?? 0) + 1;
    const now = new Date().toISOString();
    ctx.db.transaction(tx => {
      for (const item of saleLineItems) {
        const normalizedQuantity = getNormalizedSaleQuantity(item.quantity, item.unitEquivalence);
        const previousStock = productStockState.get(item.productId);

        if (previousStock === undefined) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Product ${item.productId} was not found while voiding the sale`,
          });
        }

        const newStock = previousStock + normalizedQuantity;
        productStockState.set(item.productId, newStock);

        tx.update(products)
          .set({
            stock: newStock,
            syncStatus: 'pending',
            syncVersion: sql`${products.syncVersion} + 1`,
            updatedAt: now,
          })
          .where(eq(products.id, item.productId))
          .run();

        tx.insert(inventoryMovements)
          .values({
            id: nanoid(),
            tenantId: ctx.tenantId,
            productId: item.productId,
            type: 'return',
            quantity: normalizedQuantity,
            previousStock,
            newStock,
            reference: input.id,
            notes: `Voided sale ${existing.saleNumber}`,
            createdBy: ctx.user!.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
      }

      tx.update(sales)
        .set({
          status: 'voided',
          notes: buildVoidedSaleNotes(existing.notes, input.reason),
          updatedAt: now,
          syncStatus: 'pending',
          syncVersion: nextSyncVersion,
        })
        .where(eq(sales.id, input.id))
        .run();

      tx.insert(syncQueue)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          entityType: 'sales',
          entityId: input.id,
          operation: 'update',
          data: { id: input.id, status: 'voided', reason: input.reason },
          localVersion: nextSyncVersion,
          attempts: 0,
          createdAt: now,
        })
        .run();
    });

    const updated = await ctx.db.select().from(sales).where(eq(sales.id, input.id)).get();
    return updated!;
  }),
});
