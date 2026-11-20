/**
 * Transfer destinations router: admins choose where a site receives
 * transfers; every sales role reads them, with a QR, while charging.
 *
 * @module trpc/routers/transferDestinations
 */
import {
  listChargeTransferDestinations,
  listSiteTransferDestinations,
  removeSiteTransferDestination,
  reorderSiteTransferDestinations,
  setSiteTransferDestination,
  type TransferDestinationScope,
} from '../../services/site-transfer-destinations.js';
import type { Context } from '../context.js';
import { router } from '../init.js';
import { adminProcedure, cashierManagerOrAdminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  chargeTransferDestinationsInput,
  listTransferDestinationsInput,
  removeTransferDestinationInput,
  reorderTransferDestinationsInput,
  setTransferDestinationInput,
} from '../schemas/transferDestinations.js';

async function siteScope(
  ctx: Pick<Context, 'db' | 'user'> & { tenantId: string },
  siteId: string
): Promise<TransferDestinationScope> {
  await ensureTenantSite(ctx.db, ctx.tenantId, siteId);
  return { tenantId: ctx.tenantId, siteId, userId: ctx.user!.id };
}

export const transferDestinationsRouter = router({
  list: adminProcedure.input(listTransferDestinationsInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return listSiteTransferDestinations(ctx.db, ctx.tenantId, input.siteId);
  }),

  set: adminProcedure
    .input(setTransferDestinationInput)
    .mutation(async ({ ctx, input: { siteId, ...destination } }) =>
      setSiteTransferDestination(ctx.db, await siteScope(ctx, siteId), destination)
    ),

  reorder: adminProcedure
    .input(reorderTransferDestinationsInput)
    .mutation(async ({ ctx, input }) =>
      reorderSiteTransferDestinations(ctx.db, await siteScope(ctx, input.siteId), input.ids)
    ),

  remove: adminProcedure
    .input(removeTransferDestinationInput)
    .mutation(async ({ ctx, input }) =>
      removeSiteTransferDestination(ctx.db, await siteScope(ctx, input.siteId), input.id)
    ),

  // Read by the register while charging; the customer display gets the same QR from it.
  forCharge: cashierManagerOrAdminProcedure
    .input(chargeTransferDestinationsInput)
    .query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listChargeTransferDestinations(ctx.db, {
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        amount: input.amount ?? null,
        locale: input.locale,
      });
    }),
});
