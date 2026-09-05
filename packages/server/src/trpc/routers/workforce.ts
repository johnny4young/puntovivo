import { shiftSwapsRouter } from './shiftSwaps.js';
import { schedulePlansRouter } from './schedulePlans.js';
/** Employment administration and manager-safe assignment reads are separate capabilities. */
import {
  createEmploymentContract,
  endEmploymentContract,
  replaceEmploymentContract,
  voidEmploymentContract,
  EmploymentContractError,
} from '../../application/workforce/contracts.js';
import {
  getEmploymentContract,
  getEmploymentContext,
  listEmploymentAssignments,
  listEmploymentContractEvents,
  listEmploymentContracts,
} from '../../services/labor/employment-reads.js';
import { router } from '../init.js';
import { asCriticalCommandContext, commandEnvelope } from '../middleware/commandEnvelope.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import { workforceErrors } from '../middleware/workforceErrors.js';
import { timeOffRouter } from './timeOff.js';
import { availabilityRouter } from './availability.js';
import { payrollRouter } from './payroll.js';
import {
  createEmploymentContractInput,
  endEmploymentContractInput,
  getEmploymentContractInput,
  listEmploymentAssignmentsInput,
  listEmploymentContractEventsInput,
  listEmploymentContractsInput,
  replaceEmploymentContractInput,
  voidEmploymentContractInput,
} from '../schemas/workforce.js';

const admin = adminProcedure.use(workforceErrors);
// Authorize before replay. The outer mapper also covers reservation/recovery
// storage failures; the inner mapper keeps private resolver errors out of the journal.
const command = admin.use(commandEnvelope).use(workforceErrors);

export const workforceRouter = router({
  schedulePlans: schedulePlansRouter,
  shiftSwaps: shiftSwapsRouter,
  timeOff: timeOffRouter,
  availability: availabilityRouter,
  payroll: payrollRouter,
  assignments: managerOrAdminProcedure
    .use(workforceErrors)
    .input(listEmploymentAssignmentsInput)
    .query(async ({ ctx, input }) => {
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listEmploymentAssignments(ctx.db, ctx.tenantId, ctx.user!.role, input);
    }),
  contracts: router({
    context: admin.query(async ({ ctx }) => {
      const context = await getEmploymentContext(ctx.db, ctx.tenantId);
      if (!context) throw new EmploymentContractError('not_found');
      return context;
    }),
    list: admin.input(listEmploymentContractsInput).query(async ({ ctx, input }) => {
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listEmploymentContracts(ctx.db, ctx.tenantId, input);
    }),
    get: admin.input(getEmploymentContractInput).query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      const row = getEmploymentContract(ctx.db, ctx.tenantId, input);
      if (!row) throw new EmploymentContractError('not_found');
      return row;
    }),
    events: admin.input(listEmploymentContractEventsInput).query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      if (!getEmploymentContract(ctx.db, ctx.tenantId, input))
        throw new EmploymentContractError('not_found');
      return listEmploymentContractEvents(ctx.db, ctx.tenantId, input);
    }),
    create: command.input(createEmploymentContractInput).mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.terms.siteId);
      return createEmploymentContract(asCriticalCommandContext(ctx), input);
    }),
    end: command.input(endEmploymentContractInput).mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return endEmploymentContract(asCriticalCommandContext(ctx), input);
    }),
    replace: command.input(replaceEmploymentContractInput).mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      await ensureTenantSite(ctx.db, ctx.tenantId, input.terms.siteId);
      return replaceEmploymentContract(asCriticalCommandContext(ctx), input);
    }),
    void: command.input(voidEmploymentContractInput).mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return voidEmploymentContract(asCriticalCommandContext(ctx), input);
    }),
  }),
});
