/**
 * Till incidents router: cashiers report and read what the till sheets need;
 * managers read the queue and resolve.
 *
 * @module trpc/routers/registerIncidents
 */
import { TRPCError } from '@trpc/server';

import type { Context } from '../context.js';
import {
  getLatestRegisterIncidentToday,
  getProductSiteStock,
  listOpenRegisterIncidents,
  reportRegisterIncident,
  resolveRegisterIncident,
} from '../../services/register-incidents.js';
import { router } from '../init.js';
import { cashierManagerOrAdminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  listOpenRegisterIncidentsInput,
  registerIncidentProductStockInput,
  reportRegisterIncidentInput,
  resolveRegisterIncidentInput,
} from '../schemas/registerIncidents.js';

function activeSite(ctx: Context): string {
  if (!ctx.siteId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select an active site first' });
  }
  return ctx.siteId;
}

export const registerIncidentsRouter = router({
  report: cashierManagerOrAdminProcedure
    .input(reportRegisterIncidentInput)
    .mutation(({ ctx, input }) =>
      reportRegisterIncident(
        ctx.db,
        { tenantId: ctx.tenantId, siteId: activeSite(ctx), userId: ctx.user!.id },
        input
      )
    ),

  productStock: cashierManagerOrAdminProcedure
    .input(registerIncidentProductStockInput)
    .query(({ ctx, input }) =>
      getProductSiteStock(
        ctx.db,
        { tenantId: ctx.tenantId, siteId: activeSite(ctx) },
        input.productId
      )
    ),

  latestToday: cashierManagerOrAdminProcedure.query(({ ctx }) =>
    getLatestRegisterIncidentToday(ctx.db, { tenantId: ctx.tenantId, siteId: activeSite(ctx) })
  ),

  listOpen: managerOrAdminProcedure
    .input(listOpenRegisterIncidentsInput)
    .query(async ({ ctx, input }) => {
      if (input?.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listOpenRegisterIncidents(ctx.db, ctx.tenantId, input?.siteId);
    }),

  resolve: managerOrAdminProcedure
    .input(resolveRegisterIncidentInput)
    .mutation(({ ctx, input }) =>
      resolveRegisterIncident(ctx.db, { tenantId: ctx.tenantId, userId: ctx.user!.id }, input)
    ),
});
