/** Administrator-only transport for private Colombia pre-payroll administration. */
import { createPayrollPeriod, closePayrollPeriod } from '../../application/payroll/periods.js';
import {
  createPayrollProfile,
  endPayrollProfile,
  replacePayrollProfile,
  voidPayrollProfile,
} from '../../application/payroll/profiles.js';
import {
  approvePayrollRun,
  createPayrollRun,
  recalculatePayrollRun,
  reviewPayrollRun,
} from '../../application/payroll/runs.js';
import {
  getPayrollPeriod,
  getPayrollProfile,
  getPayrollRun,
  getPayrollRunRevision,
  listPayrollPeriods,
  listPayrollProfileEvents,
  listPayrollProfiles,
  listPayrollRuns,
} from '../../services/payroll/reads.js';
import { getPayrollRunPreparation } from '../../services/payroll/preparation.js';
import { router } from '../init.js';
import { asCriticalCommandContext, commandEnvelope } from '../middleware/commandEnvelope.js';
import { payrollErrors } from '../middleware/payrollErrors.js';
import { adminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  advancePayrollRunInput,
  closePayrollPeriodInput,
  createPayrollPeriodInput,
  createPayrollProfileInput,
  createPayrollRunInput,
  endPayrollProfileInput,
  getPayrollPeriodInput,
  getPayrollProfileInput,
  getPayrollRunInput,
  getPayrollRunRevisionInput,
  listPayrollPeriodsInput,
  listPayrollProfileEventsInput,
  listPayrollProfilesInput,
  listPayrollRunsInput,
  recalculatePayrollRunInput,
  replacePayrollProfileInput,
  voidPayrollProfileInput,
} from '../schemas/payroll.js';

const read = adminProcedure.use(payrollErrors);
// Authorize before replay; the inner mapper also keeps private database failures out of the journal.
const command = read.use(commandEnvelope).use(payrollErrors);

export const payrollRouter = router({
  profiles: router({
    list: read.input(listPayrollProfilesInput).query(async ({ ctx, input }) => {
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listPayrollProfiles(ctx.db, ctx.tenantId, input);
    }),
    get: read.input(getPayrollProfileInput).query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return getPayrollProfile(ctx.db, ctx.tenantId, input);
    }),
    events: read.input(listPayrollProfileEventsInput).query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listPayrollProfileEvents(ctx.db, ctx.tenantId, input);
    }),
    create: command.input(createPayrollProfileInput).mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.profile.siteId);
      return createPayrollProfile(asCriticalCommandContext(ctx), input);
    }),
    end: command.input(endPayrollProfileInput).mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return endPayrollProfile(asCriticalCommandContext(ctx), input);
    }),
    replace: command.input(replacePayrollProfileInput).mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      await ensureTenantSite(ctx.db, ctx.tenantId, input.profile.siteId);
      return replacePayrollProfile(asCriticalCommandContext(ctx), input);
    }),
    void: command.input(voidPayrollProfileInput).mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return voidPayrollProfile(asCriticalCommandContext(ctx), input);
    }),
  }),
  periods: router({
    list: read
      .input(listPayrollPeriodsInput)
      .query(({ ctx, input }) => listPayrollPeriods(ctx.db, ctx.tenantId, input)),
    get: read
      .input(getPayrollPeriodInput)
      .query(({ ctx, input }) => getPayrollPeriod(ctx.db, ctx.tenantId, input)),
    create: command
      .input(createPayrollPeriodInput)
      .mutation(({ ctx, input }) => createPayrollPeriod(asCriticalCommandContext(ctx), input)),
    close: command
      .input(closePayrollPeriodInput)
      .mutation(({ ctx, input }) => closePayrollPeriod(asCriticalCommandContext(ctx), input)),
  }),
  runs: router({
    list: read
      .input(listPayrollRunsInput)
      .query(({ ctx, input }) => listPayrollRuns(ctx.db, ctx.tenantId, input)),
    get: read
      .input(getPayrollRunInput)
      .query(({ ctx, input }) => getPayrollRun(ctx.db, ctx.tenantId, input)),
    revision: read
      .input(getPayrollRunRevisionInput)
      .query(({ ctx, input }) => getPayrollRunRevision(ctx.db, ctx.tenantId, input)),
    preparation: read
      .input(getPayrollRunInput)
      .query(({ ctx, input }) => getPayrollRunPreparation(ctx.db, ctx.tenantId, input.runId)),
    create: command
      .input(createPayrollRunInput)
      .mutation(({ ctx, input }) => createPayrollRun(asCriticalCommandContext(ctx), input)),
    recalculate: command
      .input(recalculatePayrollRunInput)
      .mutation(({ ctx, input }) => recalculatePayrollRun(asCriticalCommandContext(ctx), input)),
    review: command
      .input(advancePayrollRunInput)
      .mutation(({ ctx, input }) => reviewPayrollRun(asCriticalCommandContext(ctx), input)),
    approve: command
      .input(advancePayrollRunInput)
      .mutation(({ ctx, input }) => approvePayrollRun(asCriticalCommandContext(ctx), input)),
  }),
});
