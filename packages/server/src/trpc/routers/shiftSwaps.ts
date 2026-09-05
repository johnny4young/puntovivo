import { USER_ROLES } from '@puntovivo/shared/roles';
import { createShiftSwap, advanceShiftSwap } from '../../application/workforce/shift-swaps.js';
import {
  listManagerShiftSwaps,
  listMyShiftSwaps,
  listMySwappableShifts,
  listShiftSwapCandidates,
  listShiftSwapEvents,
} from '../../services/labor/shift-swap-reads.js';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { createRoleGuard, managerOrAdminProcedure } from '../middleware/roles.js';
import { scheduleErrors } from '../middleware/scheduleErrors.js';
import { commandEnvelope, asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import {
  respondShiftSwapInput,
  decideShiftSwapInput,
  createShiftSwapInput,
  listManagerShiftSwapsInput,
  listMyShiftSwapsInput,
  listMySwappableShiftsInput,
  listShiftSwapCandidatesInput,
  listShiftSwapEventsInput,
} from '../schemas/shiftSwaps.js';

const employee = tenantProcedure
  .use(createRoleGuard(USER_ROLES, 'Only active employees can request exchanges'))
  .use(scheduleErrors);
const command = employee.use(commandEnvelope).use(scheduleErrors);
const managerRead = managerOrAdminProcedure.use(scheduleErrors);
const manager = managerRead.use(commandEnvelope).use(scheduleErrors);
/** Minimal decision results are safe to replay; private schedule APIs are not widened for employees. */
export const shiftSwapsRouter = router({
  myShifts: employee
    .input(listMySwappableShiftsInput)
    .query(({ ctx, input }) => listMySwappableShifts(ctx.db, ctx.tenantId, ctx.user!.id, input)),
  candidates: employee
    .input(listShiftSwapCandidatesInput)
    .query(({ ctx, input }) => listShiftSwapCandidates(ctx.db, ctx.tenantId, ctx.user!, input)),
  mine: employee
    .input(listMyShiftSwapsInput)
    .query(({ ctx, input }) => listMyShiftSwaps(ctx.db, ctx.tenantId, ctx.user!.id, input)),
  events: employee
    .input(listShiftSwapEventsInput)
    .query(({ ctx, input }) => listShiftSwapEvents(ctx.db, ctx.tenantId, ctx.user!, input)),
  managerInbox: managerRead
    .input(listManagerShiftSwapsInput)
    .query(({ ctx, input }) => listManagerShiftSwaps(ctx.db, ctx.tenantId, ctx.user!, input)),
  create: command
    .input(createShiftSwapInput)
    .mutation(({ ctx, input }) => createShiftSwap(asCriticalCommandContext(ctx), input)),
  respond: command
    .input(respondShiftSwapInput)
    .mutation(({ ctx, input }) => advanceShiftSwap(asCriticalCommandContext(ctx), input)),
  decide: manager
    .input(decideShiftSwapInput)
    .mutation(({ ctx, input }) => advanceShiftSwap(asCriticalCommandContext(ctx), input)),
});
