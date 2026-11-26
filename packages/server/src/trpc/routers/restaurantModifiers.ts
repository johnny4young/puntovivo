/** Site-local modifier configuration; history is never joined to this mutable catalog. */
import { and, asc, eq, sql } from 'drizzle-orm';
import { restaurantModifierCatalog } from '../../db/schema.js';
import { saveRestaurantModifier } from '../../application/restaurant/modifier-catalog.js';
import {
  listRestaurantModifierGroups,
  restaurantModifierGroupsForProduct,
  saveRestaurantModifierGroup,
} from '../../application/restaurant/modifier-groups.js';
import {
  getModifierBomComponents,
  setModifierBomComponents,
} from '../../services/restaurant/modifier-bom.js';
import { router } from '../init.js';
import { cashierManagerOrAdminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { createModuleGuard } from '../middleware/modules.js';
import { commandEnvelope, asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  getRestaurantModifierBomInput,
  listRestaurantModifierGroupsInput,
  listRestaurantModifiersInput,
  restaurantProductModifierGroupsInput,
  saveRestaurantModifierGroupInput,
  saveRestaurantModifierInput,
  setRestaurantModifierBomInput,
} from '../schemas/restaurantModifiers.js';

/** Archived configuration is a manager view; cashiers only see what they can order. */
const canSeeArchived = (requested: boolean, role: string | undefined) =>
  requested && (role === 'manager' || role === 'admin');

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
            canSeeArchived(input.includeArchived, ctx.user?.role)
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
  /** Editor view of every group with its options and dishes; archived ones for managers only. */
  groups: cashierManagerOrAdminProcedure
    .use(createModuleGuard('dine-in'))
    .input(listRestaurantModifierGroupsInput)
    .query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listRestaurantModifierGroups(ctx.db, {
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        includeArchived: canSeeArchived(input.includeArchived, ctx.user?.role),
      });
    }),
  /** Groups one dish asks for, in plate-sheet order, with only the options that can be added. */
  productGroups: cashierManagerOrAdminProcedure
    .use(createModuleGuard('dine-in'))
    .input(restaurantProductModifierGroupsInput)
    .query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return restaurantModifierGroupsForProduct(
        ctx.db,
        { tenantId: ctx.tenantId, siteId: input.siteId },
        input.productId
      );
    }),
  saveGroup: managerOrAdminProcedure
    .use(createModuleGuard('dine-in'))
    .use(commandEnvelope)
    .input(saveRestaurantModifierGroupInput)
    .mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return saveRestaurantModifierGroup(asCriticalCommandContext(ctx), input);
    }),
  getBomComponents: cashierManagerOrAdminProcedure
    .use(createModuleGuard('dine-in'))
    .input(getRestaurantModifierBomInput)
    .query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return getModifierBomComponents(ctx.db, ctx.tenantId, input.siteId, input.catalogId);
    }),
  setBomComponents: managerOrAdminProcedure
    .use(createModuleGuard('dine-in'))
    .input(setRestaurantModifierBomInput)
    .mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return setModifierBomComponents(ctx.db, {
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        actorId: ctx.user!.id,
        catalogId: input.catalogId,
        components: input.components,
      });
    }),
});
