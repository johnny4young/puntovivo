/** manager/admin comprehensive day-close report namespace. */

import { broadcastCompanionInvalidation } from '../../../services/companion/invalidation.js';
import { computeComprehensiveDayCloseReport } from '../../../services/reports/comprehensive-day-close.js';
import {
  getDayCloseSignoff,
  getDayCloseSignoffMetadata,
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
  /**
   * Same evidence, same hash verification, without the report snapshot.
   * The companion asks only whether the day is signed and by whom, and a
   * phone on a weak connection should not pull the payments, cash and
   * fiscal blocks to render one line.
   */
  signoffMetadata: managerOrAdminProcedure
    .input(dayClosePreviewInput)
    .output(dayCloseSignoffMetadataOutput.nullable())
    .query(({ ctx, input }) => getDayCloseSignoffMetadata(ctx.db, ctx.tenantId, input.date)),
  signOff: criticalCommandManagerOrAdminProcedure
    .input(dayCloseSignOffInput)
    .output(dayCloseSignoffMetadataOutput)
    .mutation(async ({ ctx, input }) => {
      const criticalCtx = asCriticalCommandContext(ctx);
      const signed = await signDayClose(criticalCtx.db, {
        tenantId: criticalCtx.tenantId,
        actorId: criticalCtx.user.id,
        date: input.date,
        operationId: criticalCtx.envelope.operationId,
      });
      try {
        broadcastCompanionInvalidation({
          sse: criticalCtx.req?.server?.sse,
          tenantId: criticalCtx.tenantId,
          scope: 'day_close',
        });
      } catch (error) {
        criticalCtx.req?.server?.log.warn(
          { err: error, date: input.date },
          'companion day-close invalidation failed (non-blocking)'
        );
      }
      return signed;
    }),
});

export type DayCloseReportsRouter = typeof dayCloseReportsRouter;
