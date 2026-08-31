import {
  createProviderInvoice,
  createProviderOpeningBalance,
  getProviderPayableOverview,
  recordProviderCredit,
  recordProviderPayment,
  type CriticalProviderPayableContext,
} from '../../application/provider-payables/index.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { criticalCommandManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { router } from '../init.js';
import {
  createProviderInvoiceInput,
  createProviderOpeningBalanceInput,
  providerPayableOverviewInput,
  recordProviderCreditInput,
  recordProviderPaymentInput,
} from '../schemas/providerPayables.js';

function payableContext(
  ctx: ReturnType<typeof asCriticalCommandContext>
): CriticalProviderPayableContext {
  return {
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    user: { id: ctx.user.id },
    envelope: ctx.envelope,
    deviceId: ctx.deviceId,
    completeInTransaction: ctx.completeInTransaction,
  };
}

export const providerPayablesRouter = router({
  overview: managerOrAdminProcedure
    .input(providerPayableOverviewInput)
    .query(({ ctx, input }) => getProviderPayableOverview(ctx.db, ctx.tenantId, input.providerId)),

  createInvoice: criticalCommandManagerOrAdminProcedure
    .input(createProviderInvoiceInput)
    .mutation(({ ctx, input }) =>
      createProviderInvoice(payableContext(asCriticalCommandContext(ctx)), input)
    ),

  createOpeningBalance: criticalCommandManagerOrAdminProcedure
    .input(createProviderOpeningBalanceInput)
    .mutation(({ ctx, input }) =>
      createProviderOpeningBalance(payableContext(asCriticalCommandContext(ctx)), input)
    ),

  recordPayment: criticalCommandManagerOrAdminProcedure
    .input(recordProviderPaymentInput)
    .mutation(({ ctx, input }) =>
      recordProviderPayment(payableContext(asCriticalCommandContext(ctx)), input)
    ),

  recordCredit: criticalCommandManagerOrAdminProcedure
    .input(recordProviderCreditInput)
    .mutation(({ ctx, input }) =>
      recordProviderCredit(payableContext(asCriticalCommandContext(ctx)), input)
    ),
});
