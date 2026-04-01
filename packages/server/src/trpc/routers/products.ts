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
import { products, syncQueue } from '../../db/schema.js';
import {
  listProductsInput,
  getProductInput,
  createProductInput,
  updateProductInput,
  deleteProductInput,
  searchProductsInput,
} from '../schemas/products.js';

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
      ctx.db.select().from(products).where(where).limit(perPage).offset(offset).all(),
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
      .select()
      .from(products)
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
    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(products).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      sku: input.sku,
      description: input.description,
      categoryId: input.categoryId,
      price: input.price,
      cost: input.cost,
      taxRate: input.taxRate,
      stock: input.stock,
      minStock: input.minStock,
      isActive: input.isActive,
      barcode: input.barcode,
      imageUrl: input.imageUrl,
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
      data: { id, ...input },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const created = await ctx.db.select().from(products).where(eq(products.id, id)).get();

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

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      updatedAt: now,
      syncStatus: 'pending',
      syncVersion: (existing.syncVersion ?? 0) + 1,
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.sku !== undefined) updateData.sku = updates.sku;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.categoryId !== undefined) updateData.categoryId = updates.categoryId;
    if (updates.price !== undefined) updateData.price = updates.price;
    if (updates.cost !== undefined) updateData.cost = updates.cost;
    if (updates.taxRate !== undefined) updateData.taxRate = updates.taxRate;
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

    const updated = await ctx.db.select().from(products).where(eq(products.id, id)).get();

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

    await ctx.db.delete(products).where(eq(products.id, input.id));

    const now = new Date().toISOString();
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'products',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
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
