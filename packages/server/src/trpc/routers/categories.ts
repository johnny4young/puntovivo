/**
 * Categories tRPC Router
 *
 * CRUD operations for product categories with tenant isolation.
 *
 * Procedures:
 * - categories.list        (tenant) - List categories with pagination
 * - categories.getById     (tenant) - Get a single category
 * - categories.create      (tenant) - Create a new category
 * - categories.update      (tenant) - Update a category
 * - categories.delete      (tenant, admin) - Delete a category
 * - categories.tree        (tenant) - Get categories as nested tree
 *
 * @module trpc/routers/categories
 */

import { TRPCError } from '@trpc/server';
import { eq, and, sql, like, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { categories, syncQueue } from '../../db/schema.js';
import {
  listCategoriesInput,
  getCategoryInput,
  createCategoryInput,
  updateCategoryInput,
  deleteCategoryInput,
} from '../schemas/categories.js';

export const categoriesRouter = router({
  /**
   * List categories for the current tenant with pagination
   */
  list: tenantProcedure.input(listCategoriesInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, parentId } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(categories.tenantId, ctx.tenantId)];
    if (search) {
      conditions.push(like(categories.name, `%${search}%`));
    }
    if (parentId !== undefined) {
      if (parentId === null || parentId === '') {
        conditions.push(isNull(categories.parentId));
      } else {
        conditions.push(eq(categories.parentId, parentId));
      }
    }

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db.select().from(categories).where(where).limit(perPage).offset(offset).all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(categories)
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
   * Get a single category by ID
   */
  getById: tenantProcedure.input(getCategoryInput).query(async ({ ctx, input }) => {
    const category = await ctx.db
      .select()
      .from(categories)
      .where(and(eq(categories.id, input.id), eq(categories.tenantId, ctx.tenantId)))
      .get();

    if (!category) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
    }

    return category;
  }),

  /**
   * Create a new category
   */
  create: tenantProcedure.input(createCategoryInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(categories).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      description: input.description,
      parentId: input.parentId,
      createdAt: now,
      updatedAt: now,
    });

    // Add to sync queue
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'categories',
      entityId: id,
      operation: 'create',
      data: { id, ...input },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const created = await ctx.db.select().from(categories).where(eq(categories.id, id)).get();

    return created!;
  }),

  /**
   * Update an existing category
   */
  update: tenantProcedure.input(updateCategoryInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;

    const existing = await ctx.db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.parentId !== undefined) updateData.parentId = updates.parentId;

    await ctx.db.update(categories).set(updateData).where(eq(categories.id, id));

    // Add to sync queue
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'categories',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const updated = await ctx.db.select().from(categories).where(eq(categories.id, id)).get();

    return updated!;
  }),

  /**
   * Delete a category (admin only)
   */
  delete: tenantProcedure.input(deleteCategoryInput).mutation(async ({ ctx, input }) => {
    if (ctx.user!.role !== 'admin') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only administrators can delete categories',
      });
    }

    const existing = await ctx.db
      .select()
      .from(categories)
      .where(and(eq(categories.id, input.id), eq(categories.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
    }

    await ctx.db.delete(categories).where(eq(categories.id, input.id));

    const now = new Date().toISOString();
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'categories',
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
   * Get all categories as a flat list suitable for building a tree client-side
   */
  tree: tenantProcedure.query(async ({ ctx }) => {
    const items = await ctx.db
      .select()
      .from(categories)
      .where(eq(categories.tenantId, ctx.tenantId))
      .all();

    return { items };
  }),
});
