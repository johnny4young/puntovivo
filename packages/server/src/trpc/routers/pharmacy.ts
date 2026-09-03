/** Pharmacy policy, prescription, authorization, recall and lot-state API. */

import {
  approvePharmacyEvidence,
  closePharmacyRecall,
  createPharmacyAuthorization,
  createPharmacyRecall,
  destroyPharmacyLot,
  getPharmacyCheckoutRequirements,
  inspectPharmacyApprovalCapability,
  getPharmacyRecall,
  listPharmacyAuthorizations,
  listPharmacyEvidence,
  listPharmacyRecalls,
  listRecallAffectedSales,
  recordPharmacyEvidence,
  revokePharmacyAuthorization,
  revokePharmacyEvidence,
  transitionPharmacyLot,
  type CriticalPharmacyContext,
} from '../../application/pharmacy/index.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { resolveTenantBusinessClock } from '../../services/pharmacy/business-clock.js';
import { hasPharmacyOperationalData } from '../../services/pharmacy/operational-state.js';
import { router } from '../init.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import {
  criticalCommandAdminProcedure,
  criticalCommandCashierManagerOrAdminProcedure,
  criticalCommandManagerOrAdminProcedure,
} from '../middleware/criticalCommand.js';
import { cashierManagerOrAdminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  approvePharmacyEvidenceInput,
  closePharmacyRecallInput,
  createPharmacyAuthorizationInput,
  createPharmacyRecallInput,
  destroyPharmacyLotInput,
  getPharmacyRecallInput,
  listPharmacyRecallAffectedSalesInput,
  listPharmacyAuthorizationsInput,
  listPharmacyEvidenceInput,
  listPharmacyRecallsInput,
  pharmacyCheckoutRequirementsInput,
  recordPharmacyEvidenceInput,
  revokePharmacyAuthorizationInput,
  revokePharmacyEvidenceInput,
  transitionPharmacyLotInput,
} from '../schemas/pharmacy.js';

function pharmacyContext(
  ctx: ReturnType<typeof asCriticalCommandContext>
): CriticalPharmacyContext {
  return {
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    user: { id: ctx.user.id, role: ctx.user.role },
    envelope: ctx.envelope,
    deviceId: ctx.deviceId,
    completeInTransaction: ctx.completeInTransaction,
  };
}

export const pharmacyRouter = router({
  context: managerOrAdminProcedure.query(async ({ ctx }) => {
    const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
    const approvalCapability = inspectPharmacyApprovalCapability(ctx.db, {
      tenantId: ctx.tenantId,
      userId: ctx.user!.id,
      siteId: ctx.siteId,
      countryCode: clock.countryCode,
      businessDate: clock.businessDate,
    });
    return {
      countryCode: clock.countryCode,
      businessDate: clock.businessDate,
      canApproveEvidence: approvalCapability.authorization !== null,
      approvalCapabilityErrorCode: approvalCapability.errorCode,
      hasOperationalData: hasPharmacyOperationalData(ctx.db, ctx.tenantId),
    };
  }),

  checkoutRequirements: cashierManagerOrAdminProcedure
    .input(pharmacyCheckoutRequirementsInput)
    .query(({ ctx, input }) => {
      if (!ctx.siteId) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'CASH_SESSION_SITE_REQUIRED',
          message: 'Select an active site before checking pharmacy sale requirements',
        });
      }
      return getPharmacyCheckoutRequirements(
        ctx.db,
        { tenantId: ctx.tenantId, siteId: ctx.siteId, userId: ctx.user!.id },
        input
      );
    }),

  listAuthorizations: managerOrAdminProcedure
    .input(listPharmacyAuthorizationsInput)
    .query(async ({ ctx, input }) => {
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listPharmacyAuthorizations(ctx.db, ctx.tenantId, input);
    }),
  createAuthorization: criticalCommandAdminProcedure
    .input(createPharmacyAuthorizationInput)
    .mutation(async ({ ctx, input }) => {
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return createPharmacyAuthorization(pharmacyContext(asCriticalCommandContext(ctx)), input);
    }),
  revokeAuthorization: criticalCommandAdminProcedure
    .input(revokePharmacyAuthorizationInput)
    .mutation(({ ctx, input }) =>
      revokePharmacyAuthorization(pharmacyContext(asCriticalCommandContext(ctx)), input)
    ),

  listEvidence: managerOrAdminProcedure
    .input(listPharmacyEvidenceInput)
    .query(async ({ ctx, input }) => {
      const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
      return listPharmacyEvidence(ctx.db, ctx.tenantId, input, {
        siteId: ctx.siteId,
        countryCode: clock.countryCode,
        businessDate: clock.businessDate,
      });
    }),
  recordEvidence: criticalCommandCashierManagerOrAdminProcedure
    .input(recordPharmacyEvidenceInput)
    .mutation(({ ctx, input }) =>
      recordPharmacyEvidence(pharmacyContext(asCriticalCommandContext(ctx)), input)
    ),
  approveEvidence: criticalCommandCashierManagerOrAdminProcedure
    .input(approvePharmacyEvidenceInput)
    .mutation(({ ctx, input }) =>
      approvePharmacyEvidence(pharmacyContext(asCriticalCommandContext(ctx)), input)
    ),
  revokeEvidence: criticalCommandManagerOrAdminProcedure
    .input(revokePharmacyEvidenceInput)
    .mutation(({ ctx, input }) =>
      revokePharmacyEvidence(pharmacyContext(asCriticalCommandContext(ctx)), input)
    ),

  listRecalls: managerOrAdminProcedure
    .input(listPharmacyRecallsInput)
    .query(({ ctx, input }) => listPharmacyRecalls(ctx.db, ctx.tenantId, input)),
  getRecall: managerOrAdminProcedure
    .input(getPharmacyRecallInput)
    .query(({ ctx, input }) => getPharmacyRecall(ctx.db, ctx.tenantId, input)),
  affectedSales: managerOrAdminProcedure
    .input(listPharmacyRecallAffectedSalesInput)
    .query(({ ctx, input }) =>
      listRecallAffectedSales(ctx.db, ctx.tenantId, input, ctx.user!.role === 'admin')
    ),
  createRecall: criticalCommandManagerOrAdminProcedure
    .input(createPharmacyRecallInput)
    .mutation(({ ctx, input }) =>
      createPharmacyRecall(pharmacyContext(asCriticalCommandContext(ctx)), input)
    ),
  closeRecall: criticalCommandManagerOrAdminProcedure
    .input(closePharmacyRecallInput)
    .mutation(({ ctx, input }) =>
      closePharmacyRecall(pharmacyContext(asCriticalCommandContext(ctx)), input)
    ),
  transitionLot: criticalCommandManagerOrAdminProcedure
    .input(transitionPharmacyLotInput)
    .mutation(({ ctx, input }) =>
      transitionPharmacyLot(pharmacyContext(asCriticalCommandContext(ctx)), input)
    ),
  destroyLot: criticalCommandManagerOrAdminProcedure
    .input(destroyPharmacyLotInput)
    .mutation(({ ctx, input }) =>
      destroyPharmacyLot(pharmacyContext(asCriticalCommandContext(ctx)), input)
    ),
});
