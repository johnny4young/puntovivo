/**
 * Quotation Zod Schemas (Phase 5 / Tier-2 #6 step 1).
 *
 * The first slice ships CRUD + status transitions only — convert-to-sale,
 * version history, margin analysis, and follow-up reminders are deferred to
 * later steps.
 *
 * @module trpc/schemas/quotations
 */

import { z } from 'zod';
import { quotationStatusEnum } from '../../db/schema.js';

export const quotationStatusSchema = z.enum(quotationStatusEnum);

export const quotationItemInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  quantity: z
    .number()
    .finite('Quantity must be a finite number')
    .positive('Quantity must be greater than zero'),
  /** Required: the priced unit at quote time (price-at-quote, not live price). */
  unitPrice: z
    .number()
    .finite('Unit price must be a finite number')
    .nonnegative('Unit price cannot be negative'),
  /** Per-line discount as a percentage (0–100). */
  discount: z
    .number()
    .finite('Discount must be a finite number')
    .min(0, 'Discount cannot be negative')
    .max(100, 'Discount cannot exceed 100%')
    .default(0),
  /** Per-line VAT rate as a percentage. Falls back to the product VAT when 0. */
  taxRate: z
    .number()
    .finite('Tax rate must be a finite number')
    .min(0, 'Tax rate cannot be negative')
    .default(0),
});

export const createQuotationInput = z.object({
  customerId: z.string().min(1).optional(),
  items: z
    .array(quotationItemInput)
    .min(1, 'A quotation must include at least one product line'),
  /** ISO datetime — when the quotation expires. Optional. */
  validUntil: z.string().datetime({ offset: true }).optional(),
  notes: z.string().trim().max(1000).optional(),
  /**
   * Override the active site (defaults to the operator's `ctx.siteId`). Lets a
   * tenant-wide manager produce a quote scoped to a specific branch.
   */
  siteId: z.string().min(1).optional(),
});

export const listQuotationsInput = z
  .object({
    limit: z.number().int().positive().max(200).optional(),
    status: quotationStatusSchema.optional(),
    customerId: z.string().min(1).optional(),
  })
  .optional();

export const getQuotationInput = z.object({
  id: z.string().min(1, 'Quotation ID is required'),
});

export const updateQuotationStatusInput = z.object({
  id: z.string().min(1, 'Quotation ID is required'),
  /**
   * Every transition target except `draft` can be requested; the server
   * validates against `ALLOWED_TRANSITIONS` so that e.g. `converted` is only
   * reachable from `accepted`. Step 3 of the Quotations slice opened up
   * `converted` so an operator can close an accepted quote once the
   * corresponding sale has been completed through the regular POS.
   */
  status: z.enum(['sent', 'accepted', 'rejected', 'expired', 'converted']),
});

export const deleteQuotationInput = z.object({
  id: z.string().min(1, 'Quotation ID is required'),
});

export type CreateQuotationInput = z.infer<typeof createQuotationInput>;
export type QuotationItemInput = z.infer<typeof quotationItemInput>;
export type ListQuotationsInput = z.infer<typeof listQuotationsInput>;
export type GetQuotationInput = z.infer<typeof getQuotationInput>;
export type UpdateQuotationStatusInput = z.infer<typeof updateQuotationStatusInput>;
export type DeleteQuotationInput = z.infer<typeof deleteQuotationInput>;
