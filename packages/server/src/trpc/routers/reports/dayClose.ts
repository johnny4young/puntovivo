/** ENG-141a — manager/admin comprehensive day-close report namespace. */

import { computeComprehensiveDayCloseReport } from '../../../services/reports/comprehensive-day-close.js';
import {
  getDayCloseSignoff,
  signDayClose,
} from '../../../services/reports/day-close-signoff.js';
import { router } from '../../init.js';
import { asCriticalCommandContext } from '../../middleware/commandEnvelope.js';
import { criticalCommandManagerOrAdminProcedure } from '../../middleware/criticalCommand.js';
import { managerOrAdminProcedure } from '../../middleware/roles.js';
import {
  comprehensiveDayCloseReportOutput,
  dayClosePreviewInput,
  dayCloseSignOffInput,
  dayCloseSignoffMetadataOutput,
  dayCloseSignoffOutput,
} from '../../schemas/reports.js';

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
  signoff: managerOrAdminProcedure
    .input(dayClosePreviewInput)
    .output(dayCloseSignoffOutput.nullable())
    .query(({ ctx, input }) => getDayCloseSignoff(ctx.db, ctx.tenantId, input.date)),
  signOff: criticalCommandManagerOrAdminProcedure
    .input(dayCloseSignOffInput)
    .output(dayCloseSignoffMetadataOutput)
    .mutation(async ({ ctx, input }) => {
      const criticalCtx = asCriticalCommandContext(ctx);
      return signDayClose(criticalCtx.db, {
        tenantId: criticalCtx.tenantId,
        actorId: criticalCtx.user.id,
        date: input.date,
        operationId: criticalCtx.envelope.operationId,
      });
    }),
});

export type DayCloseReportsRouter = typeof dayCloseReportsRouter;
