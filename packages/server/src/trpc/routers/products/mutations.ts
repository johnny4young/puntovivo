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
import { writeAuditLog } from '../../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../../services/sync/enqueue.js';
import { adminProcedure, managerOrAdminProcedure } from '../../middleware/roles.js';
import {
  createProductInput,
  createProductVariantMatrixInput,
  deleteProductInput,
  setBundleComponentsInput,
  updateProductInput,
} from '../../schemas/products.js';
import { setBundleComponents } from '../../../services/product-bundles.js';

export const productMutationProcedures = {
  create: managerOrAdminProcedure
    .input(createProductInput)
    .mutation(({ ctx, input }) => createProduct({ ...ctx, user: ctx.user! }, input)),

  update: managerOrAdminProcedure
    .input(updateProductInput)
    .mutation(({ ctx, input }) => updateProduct({ ...ctx, user: ctx.user! }, input)),

  createVariantMatrix: managerOrAdminProcedure
    .input(createProductVariantMatrixInput)
    .mutation(({ ctx, input }) => createProductVariantMatrix({ ...ctx, user: ctx.user! }, input)),

  setBundleComponents: managerOrAdminProcedure
    .input(setBundleComponentsInput)
    .mutation(({ ctx, input }) =>
      setBundleComponents(ctx.db, {
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        bundleProductId: input.productId,
        components: input.components,
      })
    ),

  delete: adminProcedure.input(deleteProductInput).mutation(({ ctx, input }) => {
    // Reserve the writer before reading versions. The business row and its
    // authoritative sync intent must either both commit or both roll back.
    return ctx.db.transaction(
      tx => {
        const existing = tx
          .select()
          .from(products)
          .where(and(eq(products.id, input.id), eq(products.tenantId, ctx.tenantId)))
          .get();

        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
        }

        // Deactivation is idempotent: a repeated confirm must not advance the
        // version under an open edit form or enqueue a duplicate intent.
        if (!existing.isActive) {
          return { success: true, id: input.id };
        }

        const changes = {
          isActive: false,
          updatedAt: new Date().toISOString(),
          version: existing.version + 1,
          syncStatus: 'pending' as const,
          syncVersion: (existing.syncVersion ?? 0) + 1,
        };
        tx.update(products)
          .set(changes)
          .where(and(eq(products.id, input.id), eq(products.tenantId, ctx.tenantId)))
          .run();

        enqueueSyncInTransaction(
          { ...ctx, db: tx },
          {
            entityType: 'products',
            entityId: input.id,
            operation: 'update',
            data: { id: input.id, ...changes },
          }
        );

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'product.delete',
          resourceType: 'product',
          resourceId: input.id,
          before: { name: existing.name, sku: existing.sku, isActive: existing.isActive },
          after: { isActive: false },
        });

        return { success: true, id: input.id };
      },
      { behavior: 'immediate' }
    );
  }),
};
