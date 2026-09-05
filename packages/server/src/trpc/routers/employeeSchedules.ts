/** manager/admin schedule editor API. */
import {
  cancelScheduledShift,
  createScheduledShift,
  getScheduleContext,
  listScheduledShifts,
  updateScheduledShift,
} from '../../services/labor/scheduled-shifts.js';
import { router } from '../init.js';
import { asCriticalCommandContext, commandEnvelope } from '../middleware/commandEnvelope.js';
import { scheduleErrors } from '../middleware/scheduleErrors.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import {
  cancelScheduledShiftInput,
  createScheduledShiftInput,
  listScheduledShiftsInput,
  updateScheduledShiftInput,
} from '../schemas/employeeShifts.js';

const read = managerOrAdminProcedure.use(scheduleErrors);
const command = read.use(commandEnvelope).use(scheduleErrors);

export const employeeSchedulesRouter = router({
  context: read.query(({ ctx }) => getScheduleContext(ctx.db, ctx.tenantId, ctx.user!.role)),

  list: read.input(listScheduledShiftsInput).query(async ({ ctx, input }) => {
    if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return listScheduledShifts(ctx.db, ctx.tenantId, ctx.user!.role, input);
  }),

  create: command.input(createScheduledShiftInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return createScheduledShift(asCriticalCommandContext(ctx), input);
  }),
  update: command.input(updateScheduledShiftInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return updateScheduledShift(asCriticalCommandContext(ctx), input);
  }),
  cancel: command
    .input(cancelScheduledShiftInput)
    .mutation(({ ctx, input }) => cancelScheduledShift(asCriticalCommandContext(ctx), input)),
});
