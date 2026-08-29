/**
 * Quotations tRPC Router ().
 *
 * Procedures:
 * - `quotations.create`       (manager+) — create a draft quotation
 * - `quotations.list`         (manager+) — recent quotations
 * - `quotations.getById`      (manager+) — full detail with line items
 * - `quotations.updateStatus` (manager+) — transition the quotation status
 * - `quotations.delete`       (manager+) — delete a draft quotation
 *
 * Convert-to-sale, version history, margin analysis, and follow-up reminders
 * are deferred to later steps.
 *
 * @module trpc/routers/quotations
 */

import { TRPCError } from '@trpc/server';
import { resolvePricingSettings } from '../../services/pricing-settings.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';
import { router } from '../init.js';
import { managerOrAdminProcedureWithModule } from '../middleware/modules.js';

// every procedure in `quotations.*` is gated behind the
// `quotations` module. When the module is off, the renderer hides
// the `/quotations` route + nav item AND every server call returns
// FORBIDDEN with `MODULE_NOT_ACTIVATED`. The role floor stays at
// manager+ — admin overrides still work as before.
const gatedManagerOrAdmin = managerOrAdminProcedureWithModule('quotations');
import { ServerErrorWithCode } from '../../lib/errorCodes.js';
import {
  createQuotation,
  deleteQuotation,
  getQuotationById,
  listQuotations,
  updateQuotationStatus,
} from '../../services/quotations/index.js';
import {
  createQuotationInput,
  deleteQuotationInput,
  getQuotationInput,
  listQuotationsInput,
  updateQuotationStatusInput,
} from '../schemas/quotations.js';

export const quotationsRouter = router({
  create: gatedManagerOrAdmin.input(createQuotationInput).mutation(async ({ ctx, input }) => {
    const siteId = input.siteId ?? ctx.siteId;
    if (!siteId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A site is required to create a quotation',
      });
    }
    // Site-tenant scoping is enforced INSIDE createQuotation's write
    // transaction, which throws the stable QUOTATION_SITE_NOT_FOUND code
    // the client translates. A router-level ensureTenantSite here would
    // shadow that contract with a generic NOT_FOUND, so the service-level
    // check is deliberately the single guard.
    const [pricing, locale] = await Promise.all([
      resolvePricingSettings(ctx.db, ctx.tenantId),
      resolveTenantLocale(ctx.db, ctx.tenantId),
    ]);
    return createQuotation(ctx.db, {
      tenantId: ctx.tenantId,
      siteId,
      priceIncludesTax: pricing.priceIncludesTax,
      countryCode: locale.countryCode,
      customerId: input.customerId ?? null,
      priceTier: input.priceTier,
      items: input.items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount ?? 0,
        taxRate: item.taxRate ?? 0,
        taxComponents: item.taxComponents,
      })),
      validUntil: input.validUntil ?? null,
      notes: input.notes ?? null,
      createdBy: ctx.user!.id,
    });
  }),

  list: gatedManagerOrAdmin.input(listQuotationsInput).query(({ ctx, input }) => {
    const items = listQuotations(ctx.db, ctx.tenantId, {
      limit: input?.limit,
      status: input?.status,
      customerId: input?.customerId,
    });
    return { items };
  }),

  getById: gatedManagerOrAdmin.input(getQuotationInput).query(({ ctx, input }) => {
    const detail = getQuotationById(ctx.db, ctx.tenantId, input.id);
    if (!detail) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Quotation not found',
        cause: new ServerErrorWithCode('QUOTATION_NOT_FOUND', 'Quotation not found', {
          quotationId: input.id,
        }),
      });
    }
    return detail;
  }),

  updateStatus: gatedManagerOrAdmin
    .input(updateQuotationStatusInput)
    .mutation(async ({ ctx, input }) => {
      return updateQuotationStatus(ctx.db, {
        tenantId: ctx.tenantId,
        quotationId: input.id,
        nextStatus: input.status,
        actorId: ctx.user!.id,
      });
    }),

  delete: gatedManagerOrAdmin.input(deleteQuotationInput).mutation(async ({ ctx, input }) => {
    return deleteQuotation(ctx.db, {
      tenantId: ctx.tenantId,
      quotationId: input.id,
      actorId: ctx.user!.id,
    });
  }),
});
