import {
  createSchedulePlan,
  discardSchedulePlan,
  publishSchedulePlan,
  regenerateSchedulePlan,
} from '../../application/workforce/schedule-plans.js';
import {
  getSchedulePlanDisplay,
  listSchedulePlans,
} from '../../services/labor/schedule-plan-reads.js';
import { listWorkforceEmployees } from '../../services/labor/workforce-employees.js';
import { listWorkforceEmployeesInput } from '../schemas/workforceEmployees.js';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { asCriticalCommandContext, commandEnvelope } from '../middleware/commandEnvelope.js';
import { scheduleErrors } from '../middleware/scheduleErrors.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  createSchedulePlanInput,
  decideSchedulePlanInput,
  discardSchedulePlanInput,
  getSchedulePlanInput,
  listSchedulePlansInput,
  regenerateSchedulePlanInput,
} from '../schemas/schedulePlans.js';
const read = managerOrAdminProcedure.use(scheduleErrors);
const command = read.use(commandEnvelope).use(scheduleErrors);
export const schedulePlansRouter = router({
  employees: read
    .input(listWorkforceEmployeesInput)
    .query(({ ctx, input }) => listWorkforceEmployees(ctx.db, ctx.tenantId, ctx.user!.role, input)),
  list: read.input(listSchedulePlansInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return listSchedulePlans(ctx.db, ctx.tenantId, ctx.user!.role, input);
  }),
  get: read
    .input(getSchedulePlanInput)
    .query(({ ctx, input }) =>
      getSchedulePlanDisplay(ctx.db, ctx.tenantId, ctx.user!.role, input.id)
    ),
  create: command.input(createSchedulePlanInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.recurrence.siteId);
    return createSchedulePlan(asCriticalCommandContext(ctx), input);
  }),
  regenerate: command.input(regenerateSchedulePlanInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.recurrence.siteId);
    return regenerateSchedulePlan(asCriticalCommandContext(ctx), input);
  }),
  discard: command
    .input(discardSchedulePlanInput)
    .mutation(({ ctx, input }) => discardSchedulePlan(asCriticalCommandContext(ctx), input)),
  publish: command
    .input(decideSchedulePlanInput)
    .mutation(({ ctx, input }) => publishSchedulePlan(asCriticalCommandContext(ctx), input)),
});
