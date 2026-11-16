/**
 * Till incidents router: cashiers report, managers read and resolve.
 *
 * @module trpc/routers/registerIncidents
 */
import { TRPCError } from '@trpc/server';

import {
  listOpenRegisterIncidents,
  reportRegisterIncident,
  resolveRegisterIncident,
} from '../../services/register-incidents.js';
import { router } from '../init.js';
import { cashierManagerOrAdminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  listOpenRegisterIncidentsInput,
  reportRegisterIncidentInput,
  resolveRegisterIncidentInput,
} from '../schemas/registerIncidents.js';

export const registerIncidentsRouter = router({
  report: cashierManagerOrAdminProcedure
    .input(reportRegisterIncidentInput)
    .mutation(({ ctx, input }) => {
      if (!ctx.siteId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select an active site first' });
      }
      return reportRegisterIncident(
        ctx.db,
        { tenantId: ctx.tenantId, siteId: ctx.siteId, userId: ctx.user!.id },
        input
      );
    }),

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
