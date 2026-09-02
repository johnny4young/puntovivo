/** Manager-facing recipes and immutable inventory transformation executions. */

import { TRPCError } from '@trpc/server';
import {
  createTransformationRecipe,
  executeInventoryTransformation,
  updateTransformationRecipe,
  voidInventoryTransformation,
} from '../../application/inventory/index.js';
import { ServerErrorWithCode } from '../../lib/errorCodes.js';
import {
  getInventoryTransformationRecord,
  getTransformationRecipeRecord,
  listInventoryTransformationRecords,
  listTransformationRecipeRecords,
} from '../../services/inventory-transformations/index.js';
import { router } from '../init.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { criticalCommandManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  createTransformationRecipeInput,
  executeInventoryTransformationInput,
  getInventoryTransformationInput,
  getTransformationRecipeInput,
  listInventoryTransformationsInput,
  listTransformationRecipesInput,
  updateTransformationRecipeInput,
  voidInventoryTransformationInput,
} from '../schemas/inventoryTransformations.js';

function notFound(code: 'TRANSFORMATION_RECIPE_NOT_FOUND' | 'TRANSFORMATION_NOT_FOUND') {
  return new TRPCError({
    code: 'NOT_FOUND',
    message:
      code === 'TRANSFORMATION_RECIPE_NOT_FOUND' ? 'Recipe not found' : 'Transformation not found',
    cause: new ServerErrorWithCode(code, 'Tenant-scoped transformation record not found'),
  });
}

export const inventoryTransformationsRouter = router({
  listRecipes: managerOrAdminProcedure
    .input(listTransformationRecipesInput)
    .query(async ({ ctx, input }) => {
      if (input?.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listTransformationRecipeRecords(ctx.db, ctx.tenantId, {
        ...(input?.siteId ? { siteId: input.siteId } : {}),
        ...(input?.q ? { q: input.q } : {}),
        activeOnly: input?.activeOnly ?? true,
        limit: input?.limit ?? 200,
      });
    }),

  getRecipe: managerOrAdminProcedure.input(getTransformationRecipeInput).query(({ ctx, input }) => {
    const recipe = getTransformationRecipeRecord(ctx.db, ctx.tenantId, input.id);
    if (!recipe) throw notFound('TRANSFORMATION_RECIPE_NOT_FOUND');
    return recipe;
  }),

  createRecipe: criticalCommandManagerOrAdminProcedure
    .input(createTransformationRecipeInput)
    .mutation(({ ctx, input }) => createTransformationRecipe(asCriticalCommandContext(ctx), input)),

  updateRecipe: criticalCommandManagerOrAdminProcedure
    .input(updateTransformationRecipeInput)
    .mutation(({ ctx, input }) => updateTransformationRecipe(asCriticalCommandContext(ctx), input)),

  list: managerOrAdminProcedure
    .input(listInventoryTransformationsInput)
    .query(async ({ ctx, input }) => {
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listInventoryTransformationRecords(ctx.db, ctx.tenantId, input);
    }),

  getById: managerOrAdminProcedure
    .input(getInventoryTransformationInput)
    .query(({ ctx, input }) => {
      const transformation = getInventoryTransformationRecord(ctx.db, ctx.tenantId, input.id);
      if (!transformation) throw notFound('TRANSFORMATION_NOT_FOUND');
      return transformation;
    }),

  execute: criticalCommandManagerOrAdminProcedure
    .input(executeInventoryTransformationInput)
    .mutation(({ ctx, input }) =>
      executeInventoryTransformation(asCriticalCommandContext(ctx), input)
    ),

  void: criticalCommandManagerOrAdminProcedure
    .input(voidInventoryTransformationInput)
    .mutation(({ ctx, input }) =>
      voidInventoryTransformation(asCriticalCommandContext(ctx), input)
    ),
});
