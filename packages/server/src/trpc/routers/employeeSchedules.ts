/** manager/admin schedule editor API. */
import {
  cancelScheduledShift,
  createScheduledShift,
  getScheduleContext,
  listScheduledShifts,
  updateScheduledShift,
} from '../../services/labor/scheduled-shifts.js';
import { router } from '../init.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { criticalCommandManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import {
  cancelScheduledShiftInput,
  createScheduledShiftInput,
  listScheduledShiftsInput,
  updateScheduledShiftInput,
} from '../schemas/employeeShifts.js';

export const employeeSchedulesRouter = router({
  context: managerOrAdminProcedure.query(({ ctx }) =>
    getScheduleContext(ctx.db, ctx.tenantId, ctx.user!.role)
  ),

  list: managerOrAdminProcedure
    .input(listScheduledShiftsInput)
    .query(({ ctx, input }) => listScheduledShifts(ctx.db, ctx.tenantId, ctx.user!.role, input)),

  create: criticalCommandManagerOrAdminProcedure
    .input(createScheduledShiftInput)
    .mutation(({ ctx, input }) => {
      const critical = asCriticalCommandContext(ctx);
      return createScheduledShift(
        {
          db: critical.db,
          tenantId: critical.tenantId,
          actor: { id: critical.user.id, role: critical.user.role },
          operationId: critical.envelope.operationId,
        },
        input
      );
    }),

  update: criticalCommandManagerOrAdminProcedure
    .input(updateScheduledShiftInput)
    .mutation(({ ctx, input }) => {
      const critical = asCriticalCommandContext(ctx);
      return updateScheduledShift(
        {
          db: critical.db,
          tenantId: critical.tenantId,
          actor: { id: critical.user.id, role: critical.user.role },
          operationId: critical.envelope.operationId,
        },
        input
      );
    }),

  cancel: criticalCommandManagerOrAdminProcedure
    .input(cancelScheduledShiftInput)
    .mutation(({ ctx, input }) => {
      const critical = asCriticalCommandContext(ctx);
      return cancelScheduledShift(
        {
          db: critical.db,
          tenantId: critical.tenantId,
          actor: { id: critical.user.id, role: critical.user.role },
          operationId: critical.envelope.operationId,
        },
        input
      );
    }),
});
