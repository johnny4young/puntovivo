/** Site-local modifier configuration; history is never joined to this mutable catalog. */
import { and, asc, eq, sql } from 'drizzle-orm';
import { restaurantModifierCatalog } from '../../db/schema.js';
import { saveRestaurantModifier } from '../../application/restaurant/modifier-catalog.js';
import { router } from '../init.js';
import { cashierManagerOrAdminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { createModuleGuard } from '../middleware/modules.js';
import { commandEnvelope, asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  listRestaurantModifiersInput,
  saveRestaurantModifierInput,
} from '../schemas/restaurantModifiers.js';

export const restaurantModifiersRouter = router({
  list: cashierManagerOrAdminProcedure
    .use(createModuleGuard('dine-in'))
    .input(listRestaurantModifiersInput)
    .query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      const pattern = `%${input.search.toLowerCase().replace(/[!%_]/g, char => `!${char}`)}%`;
      const rows = ctx.db
        .select({
          id: restaurantModifierCatalog.id,
          siteId: restaurantModifierCatalog.siteId,
          name: restaurantModifierCatalog.name,
          unitPriceDelta: restaurantModifierCatalog.unitPriceDelta,
          maxQuantity: restaurantModifierCatalog.maxQuantity,
          requiresManager: restaurantModifierCatalog.requiresManager,
          isActive: restaurantModifierCatalog.isActive,
          version: restaurantModifierCatalog.version,
        })
        .from(restaurantModifierCatalog)
        .where(
          and(
            eq(restaurantModifierCatalog.tenantId, ctx.tenantId),
            eq(restaurantModifierCatalog.siteId, input.siteId),
            input.includeArchived && (ctx.user?.role === 'manager' || ctx.user?.role === 'admin')
              ? undefined
              : eq(restaurantModifierCatalog.isActive, true),
            input.search
              ? sql`${restaurantModifierCatalog.nameKey} LIKE ${pattern} ESCAPE '!'`
              : undefined
          )
        )
        .orderBy(asc(restaurantModifierCatalog.nameKey), asc(restaurantModifierCatalog.id))
        .limit(input.limit + 1)
        .offset(input.offset)
        .all();
      return {
        items: rows.slice(0, input.limit),
        nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
      };
    }),
  save: managerOrAdminProcedure
    .use(createModuleGuard('dine-in'))
    .use(commandEnvelope)
    .input(saveRestaurantModifierInput)
    .mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return saveRestaurantModifier(asCriticalCommandContext(ctx), input);
    }),
});
