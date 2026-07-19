/** ENG-140b/e — manager attendance evidence and immutable corrections. */
import {
  createEmployeeAttendanceCorrection,
  listEmployeeAttendanceCorrections,
} from '../../services/labor/attendance-corrections.js';
import {
  exportEmployeeAttendance,
  listEmployeeAttendance,
} from '../../services/labor/attendance-report.js';
import { router } from '../init.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { criticalCommandManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import {
  createEmployeeAttendanceCorrectionInput,
  exportEmployeeAttendanceInput,
  listEmployeeAttendanceCorrectionsInput,
  listEmployeeAttendanceInput,
} from '../schemas/employeeShifts.js';

export const employeeAttendanceRouter = router({
  list: managerOrAdminProcedure
    .input(listEmployeeAttendanceInput)
    .query(({ ctx, input }) => listEmployeeAttendance(ctx.db, ctx.tenantId, ctx.user!.role, input)),

  export: managerOrAdminProcedure
    .input(exportEmployeeAttendanceInput)
    .query(({ ctx, input }) =>
      exportEmployeeAttendance(ctx.db, ctx.tenantId, ctx.user!.role, input)
    ),

  corrections: router({
    list: managerOrAdminProcedure
      .input(listEmployeeAttendanceCorrectionsInput)
      .query(({ ctx, input }) =>
        listEmployeeAttendanceCorrections(ctx.db, ctx.tenantId, ctx.user!.role, input)
      ),
    create: criticalCommandManagerOrAdminProcedure
      .input(createEmployeeAttendanceCorrectionInput)
      .mutation(({ ctx, input }) => {
        const critical = asCriticalCommandContext(ctx);
        return createEmployeeAttendanceCorrection(
          {
            db: critical.db,
            tenantId: critical.tenantId,
            actor: { id: critical.user.id, role: critical.user.role },
            operationId: critical.envelope.operationId,
          },
          input
        );
      }),
  }),
});
