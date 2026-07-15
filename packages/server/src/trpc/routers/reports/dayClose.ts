/** ENG-141a — manager/admin comprehensive day-close report namespace. */

import { computeComprehensiveDayCloseReport } from '../../../services/reports/comprehensive-day-close.js';
import { router } from '../../init.js';
import { managerOrAdminProcedure } from '../../middleware/roles.js';
import { comprehensiveDayCloseReportOutput, dayClosePreviewInput } from '../../schemas/reports.js';

export const dayCloseReportsRouter = router({
  preview: managerOrAdminProcedure
    .input(dayClosePreviewInput)
    .output(comprehensiveDayCloseReportOutput)
    .query(({ ctx, input }) =>
      computeComprehensiveDayCloseReport(ctx.db, {
        tenantId: ctx.tenantId,
        date: input.date,
      })
    ),
});

export type DayCloseReportsRouter = typeof dayCloseReportsRouter;
