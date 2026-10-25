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
import { eq, and, like, isNull, asc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { assertVersionedWriteApplied } from '../../lib/optimisticVersion.js';
import { router } from '../init.js';
import { paginatedList } from '../lib/paginatedList.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure } from '../middleware/roles.js';
import { categories, categoryXProvider } from '../../db/schema.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import {
  listCategoriesInput,
  getCategoryInput,
  createCategoryInput,
  updateCategoryInput,
  deleteCategoryInput,
} from '../schemas/categories.js';
import type { DatabaseInstance } from '../../db/index.js';

function findTenantCategory(db: DatabaseInstance, tenantId: string, id: string) {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.tenantId, tenantId)))
    .get();
}

// Runs on the transaction handle so the parent chain cannot change between
// the check and the write.
function assertValidParentCategory(
  db: DatabaseInstance,
  tenantId: string,
  {
    categoryId,
    parentId,
  }: {
    // explicit `| undefined` on Zod-optional fields.
    categoryId?: string | undefined;
    parentId?: string | null | undefined;
  }
) {
  if (!parentId) {
    return;
  }

  if (categoryId && parentId === categoryId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A category cannot be its own parent',
    });
  }

  const parent = findTenantCategory(db, tenantId, parentId);

  if (!parent) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Parent category not found',
    });
  }

  if (!categoryId) {
    return;
  }

  let currentParentId = parent.parentId;

  while (currentParentId) {
    if (currentParentId === categoryId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Category hierarchy cannot contain cycles',
      });
    }

    currentParentId = findTenantCategory(db, tenantId, currentParentId)?.parentId ?? null;
  }
}

export const categoriesRouter = router({
  /**
   * List categories for the current tenant with pagination
   */
  list: tenantProcedure.input(listCategoriesInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, parentId } = input;

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

    // A-22 — one predicate feeds both the page and the count.
    return paginatedList({
      db: ctx.db,
      table: categories,
      where: and(...conditions),
      page,
      perPage,
    });
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
  create: adminProcedure.input(createCategoryInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const id = nanoid();

    return ctx.db.transaction(
      tx => {
        assertValidParentCategory(tx, ctx.tenantId, { parentId: input.parentId });

        tx.insert(categories)
          .values({
            id,
            tenantId: ctx.tenantId,
            name: input.name,
            description: input.description,
            parentId: input.parentId,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        enqueueSyncInTransaction(
          { ...ctx, db: tx },
          {
            entityType: 'categories',
            entityId: id,
            operation: 'create',
            data: { id, ...input },
          }
        );

        const created = tx.select().from(categories).where(eq(categories.id, id)).get();

        return created!;
      },
      { behavior: 'immediate' }
    );
  }),

  /**
   * Update an existing category
   */
  update: adminProcedure.input(updateCategoryInput).mutation(async ({ ctx, input }) => {
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
    // optimistic-concurrency bump (see the versioned WHERE below).
    const updateData: Record<string, unknown> = {
      updatedAt: now,
      version: input.version + 1,
    };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.parentId !== undefined) updateData.parentId = updates.parentId;

    // optimistic-concurrency guard. The NOT_FOUND pre-check above
    // established existence + tenant scope, so a zero-change result means
    // another tab bumped the version first.
    return ctx.db.transaction(
      tx => {
        assertValidParentCategory(tx, ctx.tenantId, { categoryId: id, parentId: updates.parentId });

        const versionedUpdate = tx
          .update(categories)
          .set(updateData)
          .where(
            and(
              eq(categories.id, id),
              eq(categories.tenantId, ctx.tenantId),
              eq(categories.version, input.version)
            )
          )
          .run() as { changes?: number };
        assertVersionedWriteApplied('category', versionedUpdate.changes ?? 0, input.version);

        enqueueSyncInTransaction(
          { ...ctx, db: tx },
          {
            entityType: 'categories',
            entityId: id,
            operation: 'update',
            data: { id, ...updateData },
          }
        );

        const updated = tx.select().from(categories).where(eq(categories.id, id)).get();

        return updated!;
      },
      { behavior: 'immediate' }
    );
  }),

  /**
   * Delete a category (admin only)
   */
  delete: adminProcedure.input(deleteCategoryInput).mutation(async ({ ctx, input }) => {
    return ctx.db.transaction(
      tx => {
        const existing = tx
          .select()
          .from(categories)
          .where(and(eq(categories.id, input.id), eq(categories.tenantId, ctx.tenantId)))
          .get();

        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
        }

        const childCategory = tx
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.parentId, input.id), eq(categories.tenantId, ctx.tenantId)))
          .get();

        if (childCategory) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Delete or reassign child categories before removing this category',
          });
        }

        const providerAssignment = tx
          .select({ id: categoryXProvider.id })
          .from(categoryXProvider)
          .where(
            and(
              eq(categoryXProvider.tenantId, ctx.tenantId),
              eq(categoryXProvider.categoryId, input.id)
            )
          )
          .get();

        if (providerAssignment) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Remove provider assignments before deleting this category',
          });
        }

        tx.delete(categories)
          .where(and(eq(categories.id, input.id), eq(categories.tenantId, ctx.tenantId)))
          .run();

        enqueueSyncInTransaction(
          { ...ctx, db: tx },
          {
            entityType: 'categories',
            entityId: input.id,
            operation: 'delete',
            data: { id: input.id },
          }
        );

        return { success: true, id: input.id };
      },
      { behavior: 'immediate' }
    );
  }),

  /**
   * Get all categories as a flat list suitable for building a tree client-side
   */
  tree: tenantProcedure.query(async ({ ctx }) => {
    const items = await ctx.db
      .select()
      .from(categories)
      .where(eq(categories.tenantId, ctx.tenantId))
      .orderBy(asc(categories.name))
      .all();

    return { items };
  }),
});
