import {
  createAvailability,
  replaceAvailability,
  voidAvailability,
} from '../../application/workforce/availability.js';
import {
  getAvailability,
  listAvailability,
  listAvailabilityEvents,
} from '../../services/labor/availability-reads.js';
import { listWorkforceEmployees } from '../../services/labor/workforce-employees.js';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { asCriticalCommandContext, commandEnvelope } from '../middleware/commandEnvelope.js';
import { availabilityErrors } from '../middleware/availabilityErrors.js';
import {
  createAvailabilityInput,
  replaceAvailabilityInput,
  voidAvailabilityInput,
  getAvailabilityInput,
  listAvailabilityInput,
  listAvailabilityEventsInput,
} from '../schemas/availability.js';
import { listWorkforceEmployeesInput } from '../schemas/workforceEmployees.js';
const read = managerOrAdminProcedure.use(availabilityErrors),
  command = read.use(commandEnvelope).use(availabilityErrors);
// This policy is employee-global: no site input or site-specific escape from the restriction.
export const availabilityRouter = router({
  employees: read
    .input(listWorkforceEmployeesInput)
    .query(({ ctx, input }) => listWorkforceEmployees(ctx.db, ctx.tenantId, ctx.user!.role, input)),
  list: read
    .input(listAvailabilityInput)
    .query(({ ctx, input }) => listAvailability(ctx.db, ctx.tenantId, ctx.user!.role, input)),
  get: read
    .input(getAvailabilityInput)
    .query(({ ctx, input }) => getAvailability(ctx.db, ctx.tenantId, ctx.user!.role, input.id)),
  events: read
    .input(listAvailabilityEventsInput)
    .query(({ ctx, input }) => listAvailabilityEvents(ctx.db, ctx.tenantId, ctx.user!.role, input)),
  create: command
    .input(createAvailabilityInput)
    .mutation(({ ctx, input }) => createAvailability(asCriticalCommandContext(ctx), input)),
  replace: command
    .input(replaceAvailabilityInput)
    .mutation(({ ctx, input }) => replaceAvailability(asCriticalCommandContext(ctx), input)),
  void: command
    .input(voidAvailabilityInput)
    .mutation(({ ctx, input }) => voidAvailability(asCriticalCommandContext(ctx), input)),
});
