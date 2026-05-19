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
// ENG-014 — split-tender method enum mirrors paymentMethodEnum so a single
// sale can mix instant tenders (cash / card / transfer / other) with a
// credit portion that lands as an IOU on `customer_ledger_entries`. The
// "all-or-nothing" credit restriction shipped in ENG-090 was the only thing
// blocking apartado / layaway; the resolver now sums credit tenders and
// fires the limit invariant + ledger hook for that portion only.
export const splitPaymentMethodEnum = z.enum(['cash', 'card', 'transfer', 'credit', 'other']);
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
  // ENG-039d2 — per-line modifier ("sin cebolla", "extra queso").
  // 280-char cap mirrors restaurantTables.notes. Empty / whitespace
  // strings collapse to null at the resolver to keep the column
  // semantically two-state: present (real note) or absent.
  notes: z.string().trim().max(280).nullable().optional(),
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

/**
 * ENG-039d — restaurant tip / propina method enum. `tipAmount` defaults
 * to 0 so retail tenants that ignore the input pay no contract cost.
 * The cross-field `.refine()` below rejects the "method picked, amount
 * zeroed by stale form" bug.
 */
export const tipMethodEnum = z.enum(['percentage', 'fixed']);

export const createSaleInput = z
  .object({
    customerId: z.string().optional(),
    items: z.array(saleItemInput).min(1, 'At least one item is required'),
    paymentMethod: paymentMethodEnum.default('cash'),
    paymentStatus: paymentStatusEnum.default('pending'),
    status: saleStatusEnum.default('completed'),
    notes: z.string().optional(),
    amountReceived: z.number().min(0).optional(),
    discountAmount: z.number().min(0).default(0),
    tipAmount: z.number().min(0).default(0),
    tipMethod: tipMethodEnum.optional(),
    /**
     * ENG-039d3 — restaurant service charge / propina sugerida. Driven
     * by `tenants.settings.restaurant.serviceChargeRate`; the server
     * re-validates `serviceChargeAmount ≈ subtotal × rate / 100` to
     * reject stale-form drift. `serviceChargeRate` (0–30%) is echoed
     * onto the row so reporting can reconstruct what was active.
     */
    serviceChargeAmount: z.number().min(0).default(0),
    serviceChargeRate: z.number().min(0).max(30).optional(),
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
    /**
     * ENG-090 — admin override flag for the credit limit invariant.
     * When `true`, `requireCreditLimitNotExceeded` skips the throw even
     * when `currentBalance + grandTotal > creditLimit`. The router
     * gates this field to admin callers; the manager + cashier paths
     * reject `true` with `CREDIT_OVERRIDE_FORBIDDEN` before the sale
     * tx runs.
     */
    creditOverride: z.boolean().optional(),
  })
  .refine(value => !value.tipMethod || (value.tipAmount ?? 0) > 0, {
    message: 'tipMethod requires a positive tipAmount',
    path: ['tipAmount'],
  })
  .refine(
    value => value.serviceChargeRate === undefined || (value.serviceChargeAmount ?? 0) > 0,
    {
      message: 'serviceChargeRate requires a positive serviceChargeAmount',
      path: ['serviceChargeAmount'],
    }
  )
  .refine(
    value =>
      value.paymentMethod !== 'credit' ||
      (value.customerId !== undefined && value.customerId.length > 0),
    {
      message: 'Credit sales require a customer to be attached',
      path: ['customerId'],
    }
  )
  // ENG-014 — split tender may include a credit portion; require customer.
  .refine(
    value =>
      !value.payments?.some(p => p.method === 'credit') ||
      (value.customerId !== undefined && value.customerId.length > 0),
    {
      message: 'Credit sales require a customer to be attached',
      path: ['customerId'],
    }
  );

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
export const completeDraftInput = z
  .object({
    saleId: z.string().min(1, 'Sale ID is required'),
    paymentMethod: paymentMethodEnum.default('cash'),
    paymentStatus: completablePaymentStatusEnum.default('pending'),
    notes: z.string().optional(),
    amountReceived: z.number().min(0).optional(),
    tipAmount: z.number().min(0).default(0),
    tipMethod: tipMethodEnum.optional(),
    /**
     * ENG-039d3 — see `createSaleInput.serviceChargeAmount`. The server
     * re-validates the amount against the live tenant rate at commit
     * time so a long-suspended draft cannot bypass a rate change.
     */
    serviceChargeAmount: z.number().min(0).default(0),
    serviceChargeRate: z.number().min(0).max(30).optional(),
    /**
     * Optional multi-tender list. When present, Σ(amount) must equal the
     * draft's existing total plus any tip + service charge (the caller
     * can read the frozen subtotal/tax/discount from `sales.getById`).
     * The server re-validates to avoid trusting stale client-side
     * computations.
     */
    payments: z.array(salePaymentInput).optional(),
    /**
     * ENG-090 — admin override flag mirrors `createSaleInput.creditOverride`
     * so a draft that resumed as credit can also bypass the cupo limit
     * at finalize time when an admin co-signs. Router gates `true` to
     * admin callers.
     */
    creditOverride: z.boolean().optional(),
  })
  .refine(value => !value.tipMethod || (value.tipAmount ?? 0) > 0, {
    message: 'tipMethod requires a positive tipAmount',
    path: ['tipAmount'],
  })
  .refine(
    value => value.serviceChargeRate === undefined || (value.serviceChargeAmount ?? 0) > 0,
    {
      message: 'serviceChargeRate requires a positive serviceChargeAmount',
      path: ['serviceChargeAmount'],
    }
  );

// ENG-014 — no Zod refine here for "credit tender requires customerId":
// the draft's customer is locked at create-time and lives on the DB row,
// not in the completeDraft input. The service layer enforces the
// invariant in `runCompleteDraft` via the `hasCreditPortion` guard,
// which throws `CREDIT_SALE_CUSTOMER_REQUIRED` when a credit tender
// arrives on a draft that never had a customerId.

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
