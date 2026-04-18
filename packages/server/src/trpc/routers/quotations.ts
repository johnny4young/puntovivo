/**
 * Quotations tRPC Router (Phase 5 / Tier-2 #6 step 1).
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
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { ServerErrorWithCode } from '../../lib/errorCodes.js';
import {
  createQuotation,
  deleteQuotation,
  getQuotationById,
  listQuotations,
  updateQuotationStatus,
} from '../../services/quotations.js';
import {
  createQuotationInput,
  deleteQuotationInput,
  getQuotationInput,
  listQuotationsInput,
  updateQuotationStatusInput,
} from '../schemas/quotations.js';

export const quotationsRouter = router({
  create: managerOrAdminProcedure
    .input(createQuotationInput)
    .mutation(async ({ ctx, input }) => {
      const siteId = input.siteId ?? ctx.siteId;
      if (!siteId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A site is required to create a quotation',
        });
      }
      return createQuotation(ctx.db, {
        tenantId: ctx.tenantId,
        siteId,
        customerId: input.customerId ?? null,
        items: input.items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount ?? 0,
          taxRate: item.taxRate ?? 0,
        })),
        validUntil: input.validUntil ?? null,
        notes: input.notes ?? null,
        createdBy: ctx.user!.id,
      });
    }),

  list: managerOrAdminProcedure
    .input(listQuotationsInput)
    .query(({ ctx, input }) => {
      const items = listQuotations(ctx.db, ctx.tenantId, {
        limit: input?.limit,
        status: input?.status,
        customerId: input?.customerId,
      });
      return { items };
    }),

  getById: managerOrAdminProcedure
    .input(getQuotationInput)
    .query(({ ctx, input }) => {
      const detail = getQuotationById(ctx.db, ctx.tenantId, input.id);
      if (!detail) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Quotation not found',
          cause: new ServerErrorWithCode(
            'QUOTATION_NOT_FOUND',
            'Quotation not found',
            { quotationId: input.id }
          ),
        });
      }
      return detail;
    }),

  updateStatus: managerOrAdminProcedure
    .input(updateQuotationStatusInput)
    .mutation(async ({ ctx, input }) => {
      return updateQuotationStatus(ctx.db, {
        tenantId: ctx.tenantId,
        quotationId: input.id,
        nextStatus: input.status,
        actorId: ctx.user!.id,
      });
    }),

  delete: managerOrAdminProcedure
    .input(deleteQuotationInput)
    .mutation(async ({ ctx, input }) => {
      return deleteQuotation(ctx.db, {
        tenantId: ctx.tenantId,
        quotationId: input.id,
      });
    }),
});
