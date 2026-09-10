/** manager attendance evidence and immutable corrections. */
import {
  createEmployeeAttendanceCorrection,
  listEmployeeAttendanceCorrections,
} from '../../services/labor/attendance-corrections.js';
import {
  exportEmployeeAttendance,
  listEmployeeAttendance,
} from '../../services/labor/attendance-report.js';
import {
  listAttendanceReconciliationCandidates,
  listPlanActual,
} from '../../services/labor/attendance-reconciliation-reads.js';
import { recordAttendanceReconciliation } from '../../application/workforce/attendance-reconciliation.js';
import { listOperationalLaborCost } from '../../services/labor/labor-costing.js';
import { router } from '../init.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { criticalCommandManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  createEmployeeAttendanceCorrectionInput,
  exportEmployeeAttendanceInput,
  listEmployeeAttendanceCorrectionsInput,
  listEmployeeAttendanceInput,
  listLaborCostInput,
  listAttendanceReconciliationCandidatesInput,
  listPlanActualInput,
  recordAttendanceReconciliationInput,
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

  planActual: router({
    list: managerOrAdminProcedure.input(listPlanActualInput).query(async ({ ctx, input }) => {
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listPlanActual(ctx.db, ctx.tenantId, ctx.user!.role, input);
    }),
    candidates: managerOrAdminProcedure
      .input(listAttendanceReconciliationCandidatesInput)
      .query(({ ctx, input }) =>
        listAttendanceReconciliationCandidates(ctx.db, ctx.tenantId, ctx.user!.role, input)
      ),
    record: criticalCommandManagerOrAdminProcedure
      .input(recordAttendanceReconciliationInput)
      .mutation(({ ctx, input }) =>
        recordAttendanceReconciliation(asCriticalCommandContext(ctx), input)
      ),
  }),

  costs: adminProcedure.input(listLaborCostInput).query(async ({ ctx, input }) => {
    if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return listOperationalLaborCost(ctx.db, ctx.tenantId, input);
  }),

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
