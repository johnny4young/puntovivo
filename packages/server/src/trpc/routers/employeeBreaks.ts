/** ENG-140b — self-scoped attendance break lifecycle. */
import { endEmployeeBreak, startEmployeeBreak } from '../../services/labor/employee-breaks.js';
import { getOpenEmployeeBreak } from '../../services/labor/attendance-state.js';
import { router } from '../init.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { criticalCommandCashierManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import { cashierManagerOrAdminProcedure } from '../middleware/roles.js';
import { employeeBreakCommandInput } from '../schemas/employeeShifts.js';

export const employeeBreaksRouter = router({
  current: cashierManagerOrAdminProcedure.query(
    ({ ctx }) => getOpenEmployeeBreak(ctx.db, ctx.tenantId, ctx.user!.id) ?? null
  ),

  start: criticalCommandCashierManagerOrAdminProcedure
    .input(employeeBreakCommandInput)
    .mutation(({ ctx }) => {
      const critical = asCriticalCommandContext(ctx);
      return startEmployeeBreak({
        db: critical.db,
        tenantId: critical.tenantId,
        actorId: critical.user.id,
        operationId: critical.envelope.operationId,
      });
    }),

  end: criticalCommandCashierManagerOrAdminProcedure
    .input(employeeBreakCommandInput)
    .mutation(({ ctx }) => {
      const critical = asCriticalCommandContext(ctx);
      return endEmployeeBreak({
        db: critical.db,
        tenantId: critical.tenantId,
        actorId: critical.user.id,
        operationId: critical.envelope.operationId,
      });
    }),
});
