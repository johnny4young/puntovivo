/**
 * Products tRPC Router
 *
 * CRUD and search operations for products with tenant isolation.
 *
 * Procedures:
 * - products.list      (tenant) - List products with pagination
 * - products.getById   (tenant) - Get a single product
 * - products.create    (tenant) - Create a new product
 * - products.update    (tenant) - Update a product
 * - products.delete    (tenant, admin) - Delete a product
 * - products.search    (tenant) - Full-text search
 *
 * @module trpc/routers/products
 */

import { TRPCError } from '@trpc/server';
import { eq, and, sql, like, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { categories, products, providers, syncQueue, vatRates } from '../../db/schema.js';
import type { Context } from '../context.js';
import {
  listProductsInput,
  getProductInput,
  createProductInput,
  updateProductInput,
  deleteProductInput,
  searchProductsInput,
} from '../schemas/products.js';
import { normalizeProductPricing } from '../../services/pricing.js';

async function resolveTaxRate(
  db: Context['db'],
  tenantId: string,
  vatRateId: string | null | undefined,
  fallbackTaxRate: number | undefined
) {
  if (!vatRateId) {
    return {
      vatRateId: vatRateId ?? null,
      taxRate: fallbackTaxRate ?? 0,
    };
  }

  const vatRate = await db
    .select({ id: vatRates.id, rate: vatRates.rate })
    .from(vatRates)
    .where(and(eq(vatRates.id, vatRateId), eq(vatRates.tenantId, tenantId)))
    .get();

  if (!vatRate) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected VAT rate was not found',
    });
  }

  return {
    vatRateId: vatRate.id,
    taxRate: vatRate.rate,
  };
}

export const productsRouter = router({
  /**
   * List products for the current tenant with pagination and filtering
   */
  list: tenantProcedure.input(listProductsInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, categoryId, isActive } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(products.tenantId, ctx.tenantId)];
    if (search) {
      conditions.push(or(like(products.name, `%${search}%`), like(products.sku, `%${search}%`))!);
    }
    if (categoryId !== undefined) {
      conditions.push(eq(products.categoryId, categoryId));
    }
    if (isActive !== undefined) {
      conditions.push(eq(products.isActive, isActive));
    }

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db
        .select({
          id: products.id,
          tenantId: products.tenantId,
          name: products.name,
          sku: products.sku,
          description: products.description,
          categoryId: products.categoryId,
          price: products.price,
          price2: products.price2,
          price3: products.price3,
          cost: products.cost,
          marginPercent1: products.marginPercent1,
          marginPercent2: products.marginPercent2,
          marginPercent3: products.marginPercent3,
          marginAmount1: products.marginAmount1,
          marginAmount2: products.marginAmount2,
          marginAmount3: products.marginAmount3,
          taxRate: products.taxRate,
          vatRateId: products.vatRateId,
          providerId: products.providerId,
          locationId: products.locationId,
          initialCost: products.initialCost,
          stock: products.stock,
          minStock: products.minStock,
          isActive: products.isActive,
          barcode: products.barcode,
          imageUrl: products.imageUrl,
          syncStatus: products.syncStatus,
          syncVersion: products.syncVersion,
          createdAt: products.createdAt,
          updatedAt: products.updatedAt,
          categoryName: categories.name,
          providerName: providers.name,
          vatRateName: vatRates.name,
        })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .leftJoin(providers, eq(products.providerId, providers.id))
        .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
        .where(where)
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(products)
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
   * Get a single product by ID
   */
  getById: tenantProcedure.input(getProductInput).query(async ({ ctx, input }) => {
    const product = await ctx.db
      .select({
        id: products.id,
        tenantId: products.tenantId,
        name: products.name,
        sku: products.sku,
        description: products.description,
        categoryId: products.categoryId,
        price: products.price,
        price2: products.price2,
        price3: products.price3,
        cost: products.cost,
        marginPercent1: products.marginPercent1,
        marginPercent2: products.marginPercent2,
        marginPercent3: products.marginPercent3,
        marginAmount1: products.marginAmount1,
        marginAmount2: products.marginAmount2,
        marginAmount3: products.marginAmount3,
        taxRate: products.taxRate,
        vatRateId: products.vatRateId,
        providerId: products.providerId,
        locationId: products.locationId,
        initialCost: products.initialCost,
        stock: products.stock,
        minStock: products.minStock,
        isActive: products.isActive,
        barcode: products.barcode,
        imageUrl: products.imageUrl,
        syncStatus: products.syncStatus,
        syncVersion: products.syncVersion,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        categoryName: categories.name,
        providerName: providers.name,
        vatRateName: vatRates.name,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(providers, eq(products.providerId, providers.id))
      .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
      .where(and(eq(products.id, input.id), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!product) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    return product;
  }),

  /**
   * Create a new product
   */
  create: tenantProcedure.input(createProductInput).mutation(async ({ ctx, input }) => {
    const existingSku = await ctx.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), eq(products.sku, input.sku)))
      .get();

    if (existingSku) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A product with this SKU already exists',
      });
    }

    const now = new Date().toISOString();
    const id = nanoid();
    const normalizedPricing = normalizeProductPricing({
      cost: input.cost,
      price: input.price,
      price2: input.price2,
      price3: input.price3,
      marginPercent1: input.marginPercent1,
      marginPercent2: input.marginPercent2,
      marginPercent3: input.marginPercent3,
      marginAmount1: input.marginAmount1,
      marginAmount2: input.marginAmount2,
      marginAmount3: input.marginAmount3,
    });
    const resolvedTax = await resolveTaxRate(ctx.db, ctx.tenantId, input.vatRateId, input.taxRate);

    await ctx.db.insert(products).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      sku: input.sku,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
      price: normalizedPricing.price,
      price2: normalizedPricing.price2,
      price3: normalizedPricing.price3,
      cost: normalizedPricing.cost,
      marginPercent1: normalizedPricing.marginPercent1,
      marginPercent2: normalizedPricing.marginPercent2,
      marginPercent3: normalizedPricing.marginPercent3,
      marginAmount1: normalizedPricing.marginAmount1,
      marginAmount2: normalizedPricing.marginAmount2,
      marginAmount3: normalizedPricing.marginAmount3,
      taxRate: resolvedTax.taxRate,
      vatRateId: resolvedTax.vatRateId,
      providerId: input.providerId ?? null,
      locationId: input.locationId ?? null,
      initialCost: input.initialCost,
      stock: input.stock,
      minStock: input.minStock,
      isActive: input.isActive,
      barcode: input.barcode ?? null,
      imageUrl: input.imageUrl ?? null,
      syncStatus: 'pending',
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Add to sync queue
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'products',
      entityId: id,
      operation: 'create',
      data: {
        id,
        ...input,
        ...normalizedPricing,
        taxRate: resolvedTax.taxRate,
        vatRateId: resolvedTax.vatRateId,
      },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const created = await ctx.db
      .select({
        id: products.id,
        tenantId: products.tenantId,
        name: products.name,
        sku: products.sku,
        description: products.description,
        categoryId: products.categoryId,
        price: products.price,
        price2: products.price2,
        price3: products.price3,
        cost: products.cost,
        marginPercent1: products.marginPercent1,
        marginPercent2: products.marginPercent2,
        marginPercent3: products.marginPercent3,
        marginAmount1: products.marginAmount1,
        marginAmount2: products.marginAmount2,
        marginAmount3: products.marginAmount3,
        taxRate: products.taxRate,
        vatRateId: products.vatRateId,
        providerId: products.providerId,
        locationId: products.locationId,
        initialCost: products.initialCost,
        stock: products.stock,
        minStock: products.minStock,
        isActive: products.isActive,
        barcode: products.barcode,
        imageUrl: products.imageUrl,
        syncStatus: products.syncStatus,
        syncVersion: products.syncVersion,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        categoryName: categories.name,
        providerName: providers.name,
        vatRateName: vatRates.name,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(providers, eq(products.providerId, providers.id))
      .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
      .where(eq(products.id, id))
      .get();

    return created!;
  }),

  /**
   * Update an existing product
   */
  update: tenantProcedure.input(updateProductInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;

    const existing = await ctx.db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    if (updates.sku && updates.sku !== existing.sku) {
      const duplicateSku = await ctx.db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), eq(products.sku, updates.sku)))
        .get();

      if (duplicateSku) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A product with this SKU already exists',
        });
      }
    }

    const now = new Date().toISOString();
    const normalizedPricing = normalizeProductPricing({
      cost: updates.cost ?? existing.cost,
      price: updates.price ?? existing.price,
      price2: updates.price2 ?? existing.price2,
      price3: updates.price3 ?? existing.price3,
      marginPercent1: updates.marginPercent1 ?? existing.marginPercent1,
      marginPercent2: updates.marginPercent2 ?? existing.marginPercent2,
      marginPercent3: updates.marginPercent3 ?? existing.marginPercent3,
      marginAmount1: updates.marginAmount1 ?? existing.marginAmount1,
      marginAmount2: updates.marginAmount2 ?? existing.marginAmount2,
      marginAmount3: updates.marginAmount3 ?? existing.marginAmount3,
    });
    const resolvedTax = await resolveTaxRate(
      ctx.db,
      ctx.tenantId,
      updates.vatRateId !== undefined ? updates.vatRateId : existing.vatRateId,
      updates.taxRate ?? existing.taxRate
    );
    const updateData: Record<string, unknown> = {
      updatedAt: now,
      syncStatus: 'pending',
      syncVersion: (existing.syncVersion ?? 0) + 1,
      price: normalizedPricing.price,
      price2: normalizedPricing.price2,
      price3: normalizedPricing.price3,
      cost: normalizedPricing.cost,
      marginPercent1: normalizedPricing.marginPercent1,
      marginPercent2: normalizedPricing.marginPercent2,
      marginPercent3: normalizedPricing.marginPercent3,
      marginAmount1: normalizedPricing.marginAmount1,
      marginAmount2: normalizedPricing.marginAmount2,
      marginAmount3: normalizedPricing.marginAmount3,
      taxRate: resolvedTax.taxRate,
      vatRateId: resolvedTax.vatRateId,
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.sku !== undefined) updateData.sku = updates.sku;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.categoryId !== undefined) updateData.categoryId = updates.categoryId;
    if (updates.providerId !== undefined) updateData.providerId = updates.providerId;
    if (updates.locationId !== undefined) updateData.locationId = updates.locationId;
    if (updates.initialCost !== undefined) updateData.initialCost = updates.initialCost;
    if (updates.stock !== undefined) updateData.stock = updates.stock;
    if (updates.minStock !== undefined) updateData.minStock = updates.minStock;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
    if (updates.barcode !== undefined) updateData.barcode = updates.barcode;
    if (updates.imageUrl !== undefined) updateData.imageUrl = updates.imageUrl;

    await ctx.db.update(products).set(updateData).where(eq(products.id, id));

    // Add to sync queue
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'products',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const updated = await ctx.db
      .select({
        id: products.id,
        tenantId: products.tenantId,
        name: products.name,
        sku: products.sku,
        description: products.description,
        categoryId: products.categoryId,
        price: products.price,
        price2: products.price2,
        price3: products.price3,
        cost: products.cost,
        marginPercent1: products.marginPercent1,
        marginPercent2: products.marginPercent2,
        marginPercent3: products.marginPercent3,
        marginAmount1: products.marginAmount1,
        marginAmount2: products.marginAmount2,
        marginAmount3: products.marginAmount3,
        taxRate: products.taxRate,
        vatRateId: products.vatRateId,
        providerId: products.providerId,
        locationId: products.locationId,
        initialCost: products.initialCost,
        stock: products.stock,
        minStock: products.minStock,
        isActive: products.isActive,
        barcode: products.barcode,
        imageUrl: products.imageUrl,
        syncStatus: products.syncStatus,
        syncVersion: products.syncVersion,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        categoryName: categories.name,
        providerName: providers.name,
        vatRateName: vatRates.name,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(providers, eq(products.providerId, providers.id))
      .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
      .where(eq(products.id, id))
      .get();

    return updated!;
  }),

  /**
   * Delete a product (admin only)
   */
  delete: tenantProcedure.input(deleteProductInput).mutation(async ({ ctx, input }) => {
    if (ctx.user!.role !== 'admin') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only administrators can delete products',
      });
    }

    const existing = await ctx.db
      .select()
      .from(products)
      .where(and(eq(products.id, input.id), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    const now = new Date().toISOString();
    await ctx.db
      .update(products)
      .set({
        isActive: false,
        updatedAt: now,
        syncStatus: 'pending',
        syncVersion: (existing.syncVersion ?? 0) + 1,
      })
      .where(eq(products.id, input.id));

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'products',
      entityId: input.id,
      operation: 'update',
      data: { id: input.id, isActive: false, updatedAt: now },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    return { success: true, id: input.id };
  }),

  /**
   * Search products by name, SKU or barcode
   */
  search: tenantProcedure.input(searchProductsInput).query(async ({ ctx, input }) => {
    const items = await ctx.db
      .select()
      .from(products)
      .where(
        and(
          eq(products.tenantId, ctx.tenantId),
          or(
            like(products.name, `%${input.q}%`),
            like(products.sku, `%${input.q}%`),
            like(products.barcode, `%${input.q}%`)
          )
        )
      )
      .limit(input.limit)
      .all();

    return { items };
  }),
});
