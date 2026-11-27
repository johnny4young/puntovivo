/** Pharmacy policy, prescription, authorization, recall, fractionation, environmental, INVIMA and FNE API. */

import {
  addPharmacyCustomerAllergy,
  approvePharmacyEvidence,
  closePharmacyRecall,
  createPharmacyAuthorization,
  createPharmacyFneAuthorization,
  createPharmacyRecall,
  destroyPharmacyLot,
  findEffectiveFneAuthorization,
  fractionatePharmacyLot,
  getPharmacyCheckoutRequirements,
  getPharmacyEnvironmentalReport,
  getPharmacyFneMonthlyReport,
  getPharmacyRecall,
  importPharmacyInvimaCatalog,
  inspectPharmacyApprovalCapability,
  listPharmacyAuthorizations,
  listPharmacyCustomerAllergies,
  listPharmacyEnvironmentalLogs,
  listPharmacyEvidence,
  listPharmacyFneAuthorizations,
  listPharmacyFractionations,
  listPharmacyGenericAlternatives,
  listPharmacyRecalls,
  listRecallAffectedSales,
  recordPharmacyEnvironmentalLog,
  recordPharmacyEvidence,
  removePharmacyCustomerAllergy,
  revokePharmacyAuthorization,
  revokePharmacyEvidence,
  revokePharmacyFneAuthorization,
  searchPharmacyInvimaCatalog,
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
  addPharmacyCustomerAllergyInput,
  approvePharmacyEvidenceInput,
  closePharmacyRecallInput,
  createPharmacyAuthorizationInput,
  createPharmacyFneAuthorizationInput,
  createPharmacyRecallInput,
  destroyPharmacyLotInput,
  fractionatePharmacyLotInput,
  getPharmacyEnvironmentalReportInput,
  getPharmacyFneMonthlyReportInput,
  getPharmacyRecallInput,
  importPharmacyInvimaCatalogInput,
  listPharmacyAuthorizationsInput,
  listPharmacyCustomerAllergiesInput,
  listPharmacyEnvironmentalLogsInput,
  listPharmacyEvidenceInput,
  listPharmacyFneAuthorizationsInput,
  listPharmacyFractionationsInput,
  listPharmacyRecallAffectedSalesInput,
  listPharmacyRecallsInput,
  pharmacyCheckoutRequirementsInput,
  pharmacyGenericAlternativesInput,
  recordPharmacyEnvironmentalLogInput,
  recordPharmacyEvidenceInput,
  removePharmacyCustomerAllergyInput,
  revokePharmacyAuthorizationInput,
  revokePharmacyEvidenceInput,
  revokePharmacyFneAuthorizationInput,
  searchPharmacyInvimaCatalogInput,
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
    const activeFne = findEffectiveFneAuthorization(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      countryCode: clock.countryCode,
      businessDate: clock.businessDate,
    });
    return {
      countryCode: clock.countryCode,
      businessDate: clock.businessDate,
      canApproveEvidence: approvalCapability.authorization !== null,
      approvalCapabilityErrorCode: approvalCapability.errorCode,
      fneEnabled: activeFne !== null,
      fneResolutionNumber: activeFne?.resolutionNumber ?? null,
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

  genericAlternatives: cashierManagerOrAdminProcedure
    .input(pharmacyGenericAlternativesInput)
    .query(async ({ ctx, input }) => {
      const siteId = input.siteId ?? ctx.siteId;
      if (!siteId) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'CASH_SESSION_SITE_REQUIRED',
          message: 'Select an active site before looking up generic alternatives',
        });
      }
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
      return listPharmacyGenericAlternatives(
        ctx.db,
        { tenantId: ctx.tenantId, siteId, clock },
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

  // --- Band 6B: Regulated lot fractionation ---
  fractionateLot: criticalCommandManagerOrAdminProcedure
    .input(fractionatePharmacyLotInput)
    .mutation(({ ctx, input }) =>
      fractionatePharmacyLot(pharmacyContext(asCriticalCommandContext(ctx)), input)
    ),
  listFractionations: managerOrAdminProcedure
    .input(listPharmacyFractionationsInput)
    .query(async ({ ctx, input }) => {
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listPharmacyFractionations(ctx.db, ctx.tenantId, input);
    }),

  // --- Band 6B: Daily temperature & relative humidity logbook (Res. 1403/2007) ---
  recordEnvironmentalLog: criticalCommandCashierManagerOrAdminProcedure
    .input(recordPharmacyEnvironmentalLogInput)
    .mutation(async ({ ctx, input }) => {
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return recordPharmacyEnvironmentalLog(pharmacyContext(asCriticalCommandContext(ctx)), input);
    }),
  listEnvironmentalLogs: cashierManagerOrAdminProcedure
    .input(listPharmacyEnvironmentalLogsInput)
    .query(async ({ ctx, input }) => {
      const siteId = input.siteId ?? ctx.siteId;
      if (!siteId) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'CASH_SESSION_SITE_REQUIRED',
          message: 'Select an active site before reading environmental logs',
        });
      }
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listPharmacyEnvironmentalLogs(ctx.db, ctx.tenantId, siteId, input);
    }),
  getEnvironmentalReport: managerOrAdminProcedure
    .input(getPharmacyEnvironmentalReportInput)
    .query(async ({ ctx, input }) => {
      const siteId = input.siteId ?? ctx.siteId;
      if (!siteId) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'CASH_SESSION_SITE_REQUIRED',
          message: 'Select an active site before generating environmental report',
        });
      }
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return getPharmacyEnvironmentalReport(ctx.db, ctx.tenantId, siteId, input);
    }),

  // --- Band 6B: Official INVIMA / CUM catalog ---
  importInvimaCatalog: managerOrAdminProcedure
    .input(importPharmacyInvimaCatalogInput)
    .mutation(({ ctx, input }) =>
      importPharmacyInvimaCatalog(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.user!.id }, input)
    ),
  searchInvimaCatalog: cashierManagerOrAdminProcedure
    .input(searchPharmacyInvimaCatalogInput)
    .query(({ ctx, input }) => searchPharmacyInvimaCatalog(ctx.db, ctx.tenantId, input)),

  // --- Band 6B: Controlled medicines (FNE Colombia — Res. 1478/2006) ---
  listFneAuthorizations: managerOrAdminProcedure
    .input(listPharmacyFneAuthorizationsInput)
    .query(async ({ ctx, input }) => {
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return listPharmacyFneAuthorizations(ctx.db, ctx.tenantId, input);
    }),
  createFneAuthorization: criticalCommandAdminProcedure
    .input(createPharmacyFneAuthorizationInput)
    .mutation(async ({ ctx, input }) => {
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return createPharmacyFneAuthorization(pharmacyContext(asCriticalCommandContext(ctx)), input);
    }),
  revokeFneAuthorization: criticalCommandAdminProcedure
    .input(revokePharmacyFneAuthorizationInput)
    .mutation(({ ctx, input }) =>
      revokePharmacyFneAuthorization(pharmacyContext(asCriticalCommandContext(ctx)), input)
    ),
  getFneMonthlyReport: managerOrAdminProcedure
    .input(getPharmacyFneMonthlyReportInput)
    .query(async ({ ctx, input }) => {
      const siteId = input.siteId ?? ctx.siteId;
      if (!siteId) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'CASH_SESSION_SITE_REQUIRED',
          message: 'Select an active site before generating the FNE monthly report',
        });
      }
      if (input.siteId) await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return getPharmacyFneMonthlyReport(ctx.db, ctx.tenantId, siteId, input);
    }),

  // --- Band 6B: Customer allergies ---
  listCustomerAllergies: cashierManagerOrAdminProcedure
    .input(listPharmacyCustomerAllergiesInput)
    .query(({ ctx, input }) => listPharmacyCustomerAllergies(ctx.db, ctx.tenantId, input)),
  addCustomerAllergy: cashierManagerOrAdminProcedure
    .input(addPharmacyCustomerAllergyInput)
    .mutation(({ ctx, input }) =>
      addPharmacyCustomerAllergy(ctx.db, { tenantId: ctx.tenantId, actorId: ctx.user!.id }, input)
    ),
  removeCustomerAllergy: managerOrAdminProcedure
    .input(removePharmacyCustomerAllergyInput)
    .mutation(({ ctx, input }) =>
      removePharmacyCustomerAllergy(
        ctx.db,
        { tenantId: ctx.tenantId, actorId: ctx.user!.id },
        input
      )
    ),
});
