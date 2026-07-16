/** ENG-140b — manager/admin attendance evidence query. */
import { listEmployeeAttendance } from '../../services/labor/attendance-report.js';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { listEmployeeAttendanceInput } from '../schemas/employeeShifts.js';

export const employeeAttendanceRouter = router({
  list: managerOrAdminProcedure
    .input(listEmployeeAttendanceInput)
    .query(({ ctx, input }) => listEmployeeAttendance(ctx.db, ctx.tenantId, ctx.user!.role, input)),
});
