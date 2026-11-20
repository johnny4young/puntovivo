/**
 * Site quick keys router: every sales role reads the strip, managers edit it.
 *
 * @module trpc/routers/quickKeys
 */
import {
  type SiteQuickKeyScope,
  importLocalFavourites,
  listSiteQuickKeys,
  removeSiteQuickKey,
  reorderSiteQuickKeys,
  setSiteQuickKey,
} from '../../services/site-quick-keys.js';
import type { Context } from '../context.js';
import { router } from '../init.js';
import { cashierManagerOrAdminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  importLocalQuickKeysInput,
  listQuickKeysInput,
  removeQuickKeyInput,
  reorderQuickKeysInput,
  setQuickKeyInput,
} from '../schemas/quickKeys.js';

async function siteScope(
  ctx: Pick<Context, 'db' | 'user'> & { tenantId: string },
  siteId: string
): Promise<SiteQuickKeyScope> {
  await ensureTenantSite(ctx.db, ctx.tenantId, siteId);
  return { tenantId: ctx.tenantId, siteId, userId: ctx.user!.id };
}

export const quickKeysRouter = router({
  list: cashierManagerOrAdminProcedure.input(listQuickKeysInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return listSiteQuickKeys(ctx.db, ctx.tenantId, input.siteId);
  }),

  set: managerOrAdminProcedure
    .input(setQuickKeyInput)
    .mutation(async ({ ctx, input: { siteId, ...key } }) =>
      setSiteQuickKey(ctx.db, await siteScope(ctx, siteId), key)
    ),

  reorder: managerOrAdminProcedure
    .input(reorderQuickKeysInput)
    .mutation(async ({ ctx, input }) =>
      reorderSiteQuickKeys(ctx.db, await siteScope(ctx, input.siteId), input.ids)
    ),

  remove: managerOrAdminProcedure
    .input(removeQuickKeyInput)
    .mutation(async ({ ctx, input }) =>
      removeSiteQuickKey(ctx.db, await siteScope(ctx, input.siteId), input.id)
    ),

  // Any register may seed an empty site once; a site with keys is left untouched.
  importLocal: cashierManagerOrAdminProcedure
    .input(importLocalQuickKeysInput)
    .mutation(async ({ ctx, input }) =>
      importLocalFavourites(ctx.db, await siteScope(ctx, input.siteId), input.productIds)
    ),
});
