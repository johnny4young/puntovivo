/** Transactional create/update lifecycle for saved transformation recipes. */

import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  inventoryTransformationRecipeInputs,
  inventoryTransformationRecipeOutputs,
  inventoryTransformationRecipes,
  products,
  sites,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  getTransformationRecipeRecord,
  getTransformationRecipeSyncAggregate,
} from '../../services/inventory-transformations/index.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type {
  CreateTransformationRecipeInput,
  UpdateTransformationRecipeInput,
} from '../../trpc/schemas/inventoryTransformations.js';
import type { TransactionalInventoryContext } from './types.js';

type RecipeBody = CreateTransformationRecipeInput;

function assertUniqueProducts(body: RecipeBody): void {
  const inputIds = body.inputs.map(line => line.productId);
  const outputIds = body.outputs.map(line => line.productId);
  if (new Set(inputIds).size !== inputIds.length || new Set(outputIds).size !== outputIds.length) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TRANSFORMATION_RECIPE_DUPLICATE_PRODUCT',
      message: 'A recipe cannot repeat a product within inputs or outputs',
    });
  }
}

function validateRecipeReferences(
  ctx: TransactionalInventoryContext,
  body: RecipeBody,
  db: Parameters<TransactionalInventoryContext['completeInTransaction']>[0]
): void {
  assertUniqueProducts(body);
  if (body.siteId) {
    const site = db
      .select({ id: sites.id, isActive: sites.isActive })
      .from(sites)
      .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, body.siteId)))
      .get();
    if (!site || site.isActive === false) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFORMATION_SITE_NOT_FOUND',
        message: 'Transformation site was not found or is inactive',
      });
    }
  }

  const productIds = [
    ...new Set([
      ...body.inputs.map(line => line.productId),
      ...body.outputs.map(line => line.productId),
    ]),
  ];
  const rows = db
    .select({
      id: products.id,
      isActive: products.isActive,
      tracksStock: products.tracksStock,
      tracksSerials: products.tracksSerials,
      catalogType: products.catalogType,
    })
    .from(products)
    .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, productIds)))
    .all();
  const rowById = new Map(rows.map(row => [row.id, row]));
  for (const productId of productIds) {
    const product = rowById.get(productId);
    if (
      !product ||
      product.isActive === false ||
      product.tracksStock === false ||
      product.catalogType === 'variant_parent'
    ) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFORMATION_PRODUCT_NOT_FOUND',
        message: 'Recipe products must be active stock-managed catalog items',
        details: { productId },
      });
    }
    if (product.tracksSerials) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFORMATION_SERIAL_UNSUPPORTED',
        message: 'Serialized products are not supported by inventory transformations',
        details: { productId },
      });
    }
  }
}

function insertRecipeLines(
  db: Parameters<TransactionalInventoryContext['completeInTransaction']>[0],
  tenantId: string,
  recipeId: string,
  body: RecipeBody
): void {
  db.insert(inventoryTransformationRecipeInputs)
    .values(
      body.inputs.map((line, position) => ({
        id: nanoid(),
        tenantId,
        recipeId,
        productId: line.productId,
        baseQuantity: line.baseQuantity,
        position,
      }))
    )
    .run();
  db.insert(inventoryTransformationRecipeOutputs)
    .values(
      body.outputs.map((line, position) => ({
        id: nanoid(),
        tenantId,
        recipeId,
        productId: line.productId,
        expectedBaseQuantity: line.expectedBaseQuantity,
        allocationWeight: line.allocationWeight,
        role: line.role,
        position,
      }))
    )
    .run();
}

function throwDuplicateRecipeName(error: unknown): never {
  if (
    error instanceof Error &&
    /UNIQUE constraint failed: inventory_transformation_recipes\./i.test(error.message)
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'TRANSFORMATION_RECIPE_NAME_DUPLICATE',
      message: 'A transformation recipe already uses this name in the selected scope',
    });
  }
  throw error;
}

export function createTransformationRecipe(
  ctx: TransactionalInventoryContext,
  input: CreateTransformationRecipeInput
) {
  const id = nanoid();
  const now = new Date().toISOString();
  try {
    return ctx.db.transaction(
      tx => {
        validateRecipeReferences(ctx, input, tx as unknown as typeof ctx.db);
        tx.insert(inventoryTransformationRecipes)
          .values({
            id,
            tenantId: ctx.tenantId,
            siteId: input.siteId ?? null,
            name: input.name.trim(),
            kind: input.kind,
            notes: input.notes?.trim() || null,
            isActive: input.isActive ?? true,
            version: 0,
            createdBy: ctx.user.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        insertRecipeLines(tx as unknown as typeof ctx.db, ctx.tenantId, id, input);

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'inventory.transformation.recipe.create',
          resourceType: 'inventory_transformation_recipe',
          resourceId: id,
          before: null,
          after: {
            name: input.name.trim(),
            kind: input.kind,
            siteId: input.siteId ?? null,
            inputCount: input.inputs.length,
            outputCount: input.outputs.length,
          },
          operationId: ctx.envelope.operationId,
        });
        const syncAggregate = getTransformationRecipeSyncAggregate(
          tx as unknown as typeof ctx.db,
          ctx.tenantId,
          id
        );
        if (!syncAggregate) {
          throw new Error('Committed transformation recipe aggregate is missing');
        }
        enqueueSyncInTransaction(
          { ...ctx, db: tx as unknown as typeof ctx.db },
          {
            entityType: 'inventory_transformation_recipes',
            entityId: id,
            operation: 'create',
            data: syncAggregate,
          }
        );
        const result = getTransformationRecipeRecord(
          tx as unknown as typeof ctx.db,
          ctx.tenantId,
          id
        )!;
        ctx.completeInTransaction(tx as unknown as typeof ctx.db, result);
        return result;
      },
      { behavior: 'immediate' }
    );
  } catch (error) {
    throwDuplicateRecipeName(error);
  }
}

export function updateTransformationRecipe(
  ctx: TransactionalInventoryContext,
  input: UpdateTransformationRecipeInput
) {
  const now = new Date().toISOString();
  try {
    return ctx.db.transaction(
      tx => {
        const existing = tx
          .select()
          .from(inventoryTransformationRecipes)
          .where(
            and(
              eq(inventoryTransformationRecipes.tenantId, ctx.tenantId),
              eq(inventoryTransformationRecipes.id, input.id)
            )
          )
          .get();
        if (!existing) {
          throwServerError({
            trpcCode: 'NOT_FOUND',
            errorCode: 'TRANSFORMATION_RECIPE_NOT_FOUND',
            message: 'Transformation recipe was not found',
          });
        }
        validateRecipeReferences(ctx, input, tx as unknown as typeof ctx.db);
        const changed = tx
          .update(inventoryTransformationRecipes)
          .set({
            siteId: input.siteId ?? null,
            name: input.name.trim(),
            kind: input.kind,
            notes: input.notes?.trim() || null,
            isActive: input.isActive ?? existing.isActive,
            version: existing.version + 1,
            syncStatus: 'pending',
            syncVersion: (existing.syncVersion ?? 0) + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(inventoryTransformationRecipes.tenantId, ctx.tenantId),
              eq(inventoryTransformationRecipes.id, input.id),
              eq(inventoryTransformationRecipes.version, input.version)
            )
          )
          .run();
        if (changed.changes !== 1) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'TRANSFORMATION_RECIPE_STALE_VERSION',
            message: 'Transformation recipe changed after it was loaded',
            details: { id: input.id, suppliedVersion: input.version },
          });
        }
        tx.delete(inventoryTransformationRecipeInputs)
          .where(
            and(
              eq(inventoryTransformationRecipeInputs.tenantId, ctx.tenantId),
              eq(inventoryTransformationRecipeInputs.recipeId, input.id)
            )
          )
          .run();
        tx.delete(inventoryTransformationRecipeOutputs)
          .where(
            and(
              eq(inventoryTransformationRecipeOutputs.tenantId, ctx.tenantId),
              eq(inventoryTransformationRecipeOutputs.recipeId, input.id)
            )
          )
          .run();
        insertRecipeLines(tx as unknown as typeof ctx.db, ctx.tenantId, input.id, input);

        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'inventory.transformation.recipe.update',
          resourceType: 'inventory_transformation_recipe',
          resourceId: input.id,
          before: {
            name: existing.name,
            kind: existing.kind,
            siteId: existing.siteId,
            isActive: existing.isActive,
            version: existing.version,
          },
          after: {
            name: input.name.trim(),
            kind: input.kind,
            siteId: input.siteId ?? null,
            isActive: input.isActive ?? existing.isActive,
            version: existing.version + 1,
            inputCount: input.inputs.length,
            outputCount: input.outputs.length,
          },
          operationId: ctx.envelope.operationId,
        });
        const syncAggregate = getTransformationRecipeSyncAggregate(
          tx as unknown as typeof ctx.db,
          ctx.tenantId,
          input.id
        );
        if (!syncAggregate) {
          throw new Error('Committed transformation recipe aggregate is missing');
        }
        enqueueSyncInTransaction(
          { ...ctx, db: tx as unknown as typeof ctx.db },
          {
            entityType: 'inventory_transformation_recipes',
            entityId: input.id,
            operation: 'update',
            data: syncAggregate,
          }
        );
        const result = getTransformationRecipeRecord(
          tx as unknown as typeof ctx.db,
          ctx.tenantId,
          input.id
        )!;
        ctx.completeInTransaction(tx as unknown as typeof ctx.db, result);
        return result;
      },
      { behavior: 'immediate' }
    );
  } catch (error) {
    throwDuplicateRecipeName(error);
  }
}
