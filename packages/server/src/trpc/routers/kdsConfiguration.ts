/** Bounded configuration reads and manager-owned writes; no historical dispatch rewrites. */
import { and, asc, eq, gt, isNotNull, or, sql } from 'drizzle-orm';
import { categories, products, kdsRoutingRules, kdsStations } from '../../db/schema.js';
import {
  saveKitchenStation,
  saveKitchenRoute,
  removeKitchenRoute,
} from '../../application/kds/configuration.js';
import { requireKdsSite } from '../../application/kds/common.js';
import { managerOrAdminProcedure, cashierManagerOrAdminProcedure } from '../middleware/roles.js';
import { createModuleGuard } from '../middleware/modules.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  kitchenSiteInput,
  saveKitchenStationInput,
  saveKitchenRouteInput,
  kitchenTargetInput,
  listKitchenTargetsInput,
} from '../schemas/kdsConfiguration.js';
import type { Context } from '../context.js';

const read = cashierManagerOrAdminProcedure.use(createModuleGuard('kds'));
const manage = managerOrAdminProcedure.use(createModuleGuard('kds'));
async function contextFor(ctx: Context, siteId: string) {
  await ensureTenantSite(ctx.db, ctx.tenantId!, siteId);
  return { db: ctx.db, tenantId: ctx.tenantId!, siteId, actorId: ctx.user!.id };
}
export const kdsConfigurationProcedures = {
  stations: read.input(kitchenSiteInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    requireKdsSite(ctx.db, ctx.tenantId, input.siteId);
    return ctx.db
      .select()
      .from(kdsStations)
      .where(and(eq(kdsStations.tenantId, ctx.tenantId), eq(kdsStations.siteId, input.siteId)))
      .orderBy(asc(kdsStations.position), asc(kdsStations.code))
      .limit(64)
      .all();
  }),
  routingTargets: manage.input(listKitchenTargetsInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    requireKdsSite(ctx.db, ctx.tenantId, input.siteId);
    const catalog = input.targetKind === 'product' ? products : categories;
    const pattern = `%${input.search.replace(/[!%_]/g, char => `!${char}`)}%`;
    const rows = ctx.db
      .select({
        id: catalog.id,
        name: catalog.name,
        rule: {
          id: kdsRoutingRules.id,
          route: kdsRoutingRules.route,
          stationId: kdsRoutingRules.stationId,
          version: kdsRoutingRules.version,
        },
      })
      .from(catalog)
      .leftJoin(
        kdsRoutingRules,
        and(
          eq(kdsRoutingRules.tenantId, ctx.tenantId),
          eq(kdsRoutingRules.siteId, input.siteId),
          eq(kdsRoutingRules.targetKind, input.targetKind),
          eq(kdsRoutingRules.targetId, catalog.id)
        )
      )
      .where(
        and(
          eq(catalog.tenantId, ctx.tenantId),
          input.cursor ? gt(catalog.id, input.cursor) : undefined,
          input.configuredOnly ? isNotNull(kdsRoutingRules.id) : undefined,
          input.search
            ? or(
                sql`${catalog.name} LIKE ${pattern} ESCAPE '!'`,
                input.targetKind === 'product'
                  ? sql`${products.sku} LIKE ${pattern} ESCAPE '!'`
                  : undefined
              )
            : undefined
        )
      )
      .orderBy(asc(catalog.id))
      .limit(input.limit + 1)
      .all();
    const items = rows.slice(0, input.limit);
    return { items, nextCursor: rows.length > input.limit ? items.at(-1)!.id : null };
  }),
  saveStation: manage
    .input(saveKitchenStationInput)
    .mutation(async ({ ctx, input }) =>
      saveKitchenStation(await contextFor(ctx, input.siteId), input)
    ),
  saveRoutingRule: manage
    .input(saveKitchenRouteInput)
    .mutation(async ({ ctx, input }) =>
      saveKitchenRoute(await contextFor(ctx, input.siteId), input)
    ),
  removeRoutingRule: manage
    .input(kitchenTargetInput)
    .mutation(async ({ ctx, input }) =>
      removeKitchenRoute(await contextFor(ctx, input.siteId), input)
    ),
};
