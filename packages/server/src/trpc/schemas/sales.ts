/**
 * Sales Zod Schemas
 *
 * Input/output validation schemas for sales tRPC procedures
 *
 * @module trpc/schemas/sales
 */

import { z } from 'zod';
import { paginationInput } from './common.js';

// ============================================================================
// Enums
// ============================================================================

export const paymentMethodEnum = z.enum(['cash', 'card', 'transfer', 'credit', 'other']);
export const splitPaymentMethodEnum = z.enum(['cash', 'card', 'transfer', 'other']);
export const paymentStatusEnum = z.enum(['pending', 'paid', 'partial', 'refunded']);
const completablePaymentStatusEnum = z.enum(['pending', 'paid', 'partial']);
export const saleStatusEnum = z.enum(['draft', 'completed', 'cancelled', 'voided']);

// ============================================================================
// Input Schemas
// ============================================================================

export const saleItemInput = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  unitId: z.string().min(1, 'Unit ID is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
  unitPrice: z.number().min(0, 'Unit price must be non-negative'),
  discount: z.number().min(0).max(100).default(0),
  taxRate: z.number().min(0).max(100).optional(),
});

export const listSalesInput = paginationInput.extend({
  customerId: z.string().optional(),
  status: saleStatusEnum.optional(),
  paymentStatus: paymentStatusEnum.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const getSaleInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

/**
 * One tender applied to a sale. Split-payment sales supply an array of these;
 * single-tender sales use the legacy `paymentMethod` + `amountReceived`
 * fields, which the server normalizes into a single payment row. Credit sales
 * stay on the legacy path until Phase 5 adds on-account balances and abonos.
 */
export const salePaymentInput = z.object({
  method: splitPaymentMethodEnum,
  amount: z
    .number()
    .finite('Amount must be a finite number')
    .positive('Amount must be greater than zero'),
  reference: z.string().trim().max(120).optional(),
});

export const createSaleInput = z.object({
  customerId: z.string().optional(),
  items: z.array(saleItemInput).min(1, 'At least one item is required'),
  paymentMethod: paymentMethodEnum.default('cash'),
  paymentStatus: paymentStatusEnum.default('pending'),
  status: saleStatusEnum.default('completed'),
  notes: z.string().optional(),
  amountReceived: z.number().min(0).optional(),
  discountAmount: z.number().min(0).default(0),
  /**
   * Phase 2 Tier-2 step 5 — optional multi-tender list. When present, the
   * server validates Σ(amount) ≈ total and persists a row per tender. The
   * legacy `paymentMethod` + `amountReceived` pair is ignored for
   * persistence in this mode but still echoed onto `sales.paymentMethod`
   * using the dominant tender so legacy consumers keep rendering.
   */
  payments: z.array(salePaymentInput).optional(),
  /**
   * ENG-039c — optional restaurant table the draft is being opened on.
   * Server validates the row belongs to the active tenant and is active
   * before persisting the FK. Non-restaurant callers omit it.
   */
  tableId: z.string().min(1).optional(),
});

export const updateSaleInput = z.object({
  id: z.string().min(1, 'ID is required'),
  paymentMethod: paymentMethodEnum.optional(),
  paymentStatus: paymentStatusEnum.optional(),
  notes: z.string().nullable().optional(),
});

export const voidSaleInput = z.object({
  id: z.string().min(1, 'ID is required'),
  reason: z.string().optional(),
});

export const returnSaleInput = z.object({
  id: z.string().min(1, 'ID is required'),
  reason: z.string().optional(),
});

// ============================================================================
// ENG-018 — park-and-resume inputs
// ============================================================================

/**
 * Input for `sales.suspend`. The caller already owns a draft sale on
 * screen; this mutation swaps it to `status='draft'` (if not already)
 * and stamps the suspension columns. `label` is an optional operator
 * hint ("Table 5", "Customer Juan") so cashiers can recognize drafts
 * in the resume panel without opening each one.
 */
export const suspendSaleInput = z.object({
  saleId: z.string().min(1, 'Sale ID is required'),
  label: z.string().trim().max(80).optional(),
  /**
   * ENG-039c — optional restaurant table FK. When present, the server
   * validates against the tenant catalog and refreshes `suspendedLabel`
   * to the resolved table name so the panel display stays in sync.
   */
  tableId: z.string().min(1).optional(),
});

/**
 * ENG-039c — Input for `sales.changeTable`. Moves a suspended draft
 * between restaurant tables, or detaches it back to free-text mode by
 * passing `null`. The mutation gates on the existing owner-or-manager
 * rule mirrored from `sales.resume`.
 */
export const changeSaleTableInput = z.object({
  saleId: z.string().min(1, 'Sale ID is required'),
  /** `null` clears the FK (back to free-text label). */
  tableId: z.string().min(1).nullable(),
});

/**
 * ENG-039c3 — Input for `sales.splitDraft`. Moves the chosen sale items
 * out of `sourceSaleId` into a brand-new suspended draft so the
 * operator can bill multiple guests separately. v1 moves items at full
 * quantity; partial-quantity splits stay deferred for a later slice.
 *
 * - `saleItemIds` must be non-empty and every id must currently belong
 *   to the source draft. Mismatches collapse to a single error code so
 *   we do not leak cross-draft existence.
 * - `tableId` is the FK for the NEW draft. `null` leaves the new draft
 *   free-text; non-null is validated against the active table catalog
 *   for the source draft's site (same shape as `changeTable`).
 * - `label` provides an optional free-text fallback when `tableId` is
 *   null. Ignored when `tableId` resolves to a real row (the resolved
 *   table name takes precedence so the panel display stays in sync
 *   with the FK, matching `suspend`/`changeTable`).
 */
export const splitDraftInput = z.object({
  sourceSaleId: z.string().min(1, 'Source sale ID is required'),
  saleItemIds: z
    .array(z.string().min(1))
    .min(1, 'At least one sale item must be selected'),
  tableId: z.string().min(1).nullable(),
  label: z.string().trim().max(80).optional(),
});

/** Input for `sales.resume`. Returns the full sale record + items + payments. */
export const resumeSaleInput = z.object({
  saleId: z.string().min(1, 'Sale ID is required'),
});

/**
 * Input for `sales.listDrafts`. Pagination is optional and defaults to
 * page 1 × 50 rows so the resume panel renders without flicker while
 * the network round-trip completes. Filter fields are optional; the
 * server already scopes by tenant and (for non-manager roles) by
 * cashier.
 */
export const listDraftsInput = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(200).default(50),
  /** When provided, drafts are scoped to this site. Ignored for cashiers
   * because they can only ever see drafts from sessions they own. */
  siteId: z.string().optional(),
  /** Free-text match against `suspendedLabel` + `saleNumber`. */
  search: z.string().trim().max(120).optional(),
});

/**
 * Input for `sales.discardDraft`. Marks a draft as `status='cancelled'`
 * AND reverses the stock debited at draft create-time — the pre-ENG-018c
 * comment claimed drafts never decremented inventory, but `sales.create`
 * debits on any status. ENG-018c fix restores the symmetry with
 * `sales.void`.
 */
export const discardDraftInput = z.object({
  saleId: z.string().min(1, 'Sale ID is required'),
});

/**
 * Input for `sales.completeDraft` (ENG-018c). Transitions an existing
 * draft to `status='completed'`, inserts payments + cash movement, and
 * leaves items untouched. The draft must NOT be suspended — if
 * `suspended_at` is non-null the caller must first `sales.resume` to
 * clear it. Items are locked at complete-time: if the operator wants
 * different items they discard the draft and start fresh.
 */
export const completeDraftInput = z.object({
  saleId: z.string().min(1, 'Sale ID is required'),
  paymentMethod: paymentMethodEnum.default('cash'),
  paymentStatus: completablePaymentStatusEnum.default('pending'),
  notes: z.string().optional(),
  amountReceived: z.number().min(0).optional(),
  /**
   * Optional multi-tender list. When present, Σ(amount) must equal the
   * draft's existing total (the caller can read it from
   * `sales.getById`). The server re-validates to avoid trusting stale
   * client-side computations.
   */
  payments: z.array(salePaymentInput).optional(),
});

// ============================================================================
// ENG-019 — receipt reprint input
// ============================================================================

/**
 * Input for `sales.getForReprint`. Returns the full sale record so the
 * receipt renderer can produce an identical print job, and increments
 * `reprintCount` + stamps `lastReprintedAt`/`lastReprintedBy`. One
 * `sale.reprint` audit row is emitted per call with the reason in
 * metadata.
 */
export const reprintReasonEnum = z.enum([
  'paper_out',
  'customer_request',
  'prior_print_error',
  'other',
]);
export const getForReprintInput = z.object({
  saleId: z.string().min(1, 'Sale ID is required'),
  reason: reprintReasonEnum.optional(),
  /** Free-text detail when `reason === 'other'`. */
  reasonDetail: z.string().trim().max(240).optional(),
});

export type ReprintReason = z.infer<typeof reprintReasonEnum>;
export type GetForReprintInput = z.infer<typeof getForReprintInput>;

export type SaleItemInput = z.infer<typeof saleItemInput>;
export type SalePaymentInput = z.infer<typeof salePaymentInput>;
export type ListSalesInput = z.infer<typeof listSalesInput>;
export type CreateSaleInput = z.infer<typeof createSaleInput>;
export type UpdateSaleInput = z.infer<typeof updateSaleInput>;
export type VoidSaleInput = z.infer<typeof voidSaleInput>;
export type ReturnSaleInput = z.infer<typeof returnSaleInput>;
export type SuspendSaleInput = z.infer<typeof suspendSaleInput>;
export type ResumeSaleInput = z.infer<typeof resumeSaleInput>;
export type ListDraftsInput = z.infer<typeof listDraftsInput>;
export type DiscardDraftInput = z.infer<typeof discardDraftInput>;
export type CompleteDraftInput = z.infer<typeof completeDraftInput>;
export type ChangeSaleTableInput = z.infer<typeof changeSaleTableInput>;
