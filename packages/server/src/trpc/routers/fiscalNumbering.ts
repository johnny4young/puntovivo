/**
 * `fiscalNumbering.*`: DIAN numbering ranges per site. Managers read,
 * admins register, activate, retire and delete. Ranges are never edited.
 *
 * @module trpc/routers/fiscalNumbering
 */
import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  activateNumberingRange,
  createNumberingRange,
  getNumberingUsage,
  listNumberingRanges,
  removeNumberingRange,
  retireNumberingRange,
} from '../../services/fiscal/numbering/ranges.js';
import {
  createFiscalNumberingInput,
  fiscalNumberingIdInput,
  fiscalNumberingUsageInput,
  listFiscalNumberingInput,
  retireFiscalNumberingInput,
} from '../schemas/fiscalNumbering.js';

export const fiscalNumberingRouter = router({
  list: managerOrAdminProcedure.input(listFiscalNumberingInput).query(async ({ ctx, input }) => {
    if (input?.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return listNumberingRanges(ctx.db, { tenantId: ctx.tenantId, siteId: input?.siteId });
  }),

  usage: managerOrAdminProcedure.input(fiscalNumberingUsageInput).query(async ({ ctx, input }) => {
    if (input?.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return getNumberingUsage(ctx.db, { tenantId: ctx.tenantId, siteId: input?.siteId });
  }),

  create: adminProcedure.input(createFiscalNumberingInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    const range = ctx.db.transaction(
      tx => createNumberingRange(tx, { tenantId: ctx.tenantId, actorId: ctx.user!.id, input }),
      { behavior: 'immediate' }
    );
    return { id: range.id, status: range.status };
  }),

  activate: adminProcedure.input(fiscalNumberingIdInput).mutation(({ ctx, input }) => {
    const range = ctx.db.transaction(
      tx =>
        activateNumberingRange(tx, { tenantId: ctx.tenantId, actorId: ctx.user!.id, id: input.id }),
      { behavior: 'immediate' }
    );
    return { id: range.id, status: range.status };
  }),

  retire: adminProcedure.input(retireFiscalNumberingInput).mutation(({ ctx, input }) => {
    const range = ctx.db.transaction(
      tx =>
        retireNumberingRange(tx, {
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          id: input.id,
          reason: input.reason,
        }),
      { behavior: 'immediate' }
    );
    return { id: range.id, status: range.status };
  }),

  remove: adminProcedure.input(fiscalNumberingIdInput).mutation(({ ctx, input }) => {
    ctx.db.transaction(
      tx =>
        removeNumberingRange(tx, { tenantId: ctx.tenantId, actorId: ctx.user!.id, id: input.id }),
      { behavior: 'immediate' }
    );
    return { id: input.id };
  }),
});
