import { listWorkforceEmployees } from '../../services/labor/workforce-employees.js';
import { listWorkforceEmployeesInput } from '../schemas/workforceEmployees.js';
import { createTimeOff, advanceTimeOff } from '../../application/workforce/time-off.js';
import { getTimeOff, listTimeOff, listTimeOffEvents } from '../../services/labor/time-off-reads.js';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import { asCriticalCommandContext, commandEnvelope } from '../middleware/commandEnvelope.js';
import { timeOffErrors } from '../middleware/timeOffErrors.js';
import {
  createTimeOffInput,
  advanceTimeOffInput,
  getTimeOffInput,
  listTimeOffInput,
  listTimeOffEventsInput,
} from '../schemas/timeOff.js';

const read = managerOrAdminProcedure.use(timeOffErrors);
// Authorize before replay; the outer mapper covers reservation/completion storage failures too.
const command = read.use(commandEnvelope).use(timeOffErrors);

export const timeOffRouter = router({
  employees: read
    .input(listWorkforceEmployeesInput)
    .query(({ ctx, input }) => listWorkforceEmployees(ctx.db, ctx.tenantId, ctx.user!.role, input)),
  list: read.input(listTimeOffInput).query(async ({ ctx, input }) => {
    if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return listTimeOff(ctx.db, ctx.tenantId, ctx.user!.role, input);
  }),
  get: read.input(getTimeOffInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return getTimeOff(ctx.db, ctx.tenantId, ctx.user!.role, input);
  }),
  events: read.input(listTimeOffEventsInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return listTimeOffEvents(ctx.db, ctx.tenantId, ctx.user!.role, input);
  }),
  create: command.input(createTimeOffInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return createTimeOff(asCriticalCommandContext(ctx), input);
  }),
  advance: command.input(advanceTimeOffInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return advanceTimeOff(asCriticalCommandContext(ctx), input);
  }),
});
