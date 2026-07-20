/**
 * Products tRPC write adapters.
 *
 * create/update orchestration lives in application/products; the
 * router owns only input/role middleware and the admin-only soft delete.
 *
 * @module trpc/routers/products/mutations
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import {
  createProduct,
  createProductVariantMatrix,
  updateProduct,
} from '../../../application/products/index.js';
import { products } from '../../../db/schema.js';
import { enqueueSync } from '../../../services/sync/enqueue.js';
import { adminProcedure, managerOrAdminProcedure } from '../../middleware/roles.js';
import {
  createProductInput,
  createProductVariantMatrixInput,
  deleteProductInput,
  updateProductInput,
} from '../../schemas/products.js';

export const productMutationProcedures = {
  create: managerOrAdminProcedure
    .input(createProductInput)
    .mutation(({ ctx, input }) => createProduct(ctx, input)),

  update: managerOrAdminProcedure
    .input(updateProductInput)
    .mutation(({ ctx, input }) => updateProduct(ctx, input)),

  createVariantMatrix: managerOrAdminProcedure
    .input(createProductVariantMatrixInput)
    .mutation(({ ctx, input }) => createProductVariantMatrix(ctx, input)),

  delete: adminProcedure.input(deleteProductInput).mutation(async ({ ctx, input }) => {
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
      .where(and(eq(products.id, input.id), eq(products.tenantId, ctx.tenantId)));

    await enqueueSync(ctx, {
      entityType: 'products',
      entityId: input.id,
      operation: 'update',
      data: { id: input.id, isActive: false, updatedAt: now },
    });

    return { success: true, id: input.id };
  }),
};
