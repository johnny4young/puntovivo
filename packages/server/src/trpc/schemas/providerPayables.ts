import { z } from 'zod';
import { providerPayablePaymentMethodEnum } from '../../db/schema.js';

const providerIdInput = z.object({ providerId: z.string().min(1) }).strict();
const payableAmountInput = z.number().finite().min(0.01).multipleOf(0.01);
const payableCalendarDayInput = z.iso.date({ error: 'Expected a valid YYYY-MM-DD calendar day' });

function occursOnOrAfter(later: string, earlier: string): boolean {
  return later >= earlier;
}

export const providerPayableOverviewInput = providerIdInput;

export const availableProviderPurchasesInput = providerIdInput.extend({
  siteId: z.string().min(1).optional(),
  search: z.string().trim().max(80).default(''),
  page: z.number().int().min(1).max(1_000_000).default(1),
  perPage: z.number().int().min(1).max(100).default(25),
});
export type AvailableProviderPurchasesInput = z.infer<typeof availableProviderPurchasesInput>;

const providerInvoiceLineInput = z
  .object({
    productId: z.string().min(1),
    /** Quantity in the product's base unit, as printed by the supplier. */
    quantity: z.number().finite().positive(),
    /** Base-unit cost as printed by the supplier. Deliberately not the
     * payable-amount rule: a zero-cost line is legitimate and a 3-pack at
     * 10 yields a base rate of 3.33 with fractional cents — cent rounding
     * stays on the calculated line totals and the invoice amount. */
    unitCost: z.number().finite().min(0),
  })
  .strict();

export const createProviderInvoiceInput = z
  .object({
    providerId: z.string().min(1),
    purchaseId: z.string().min(1).optional(),
    /** Several deliveries (remisiones) consolidated by one final invoice.
     * Takes precedence over the legacy single purchaseId. */
    purchaseIds: z.array(z.string().min(1)).min(1).max(50).optional(),
    /** Invoice lines as printed by the supplier. Required when consolidating
     * several purchases: each product must match what was received, in base
     * units, before the invoice is accepted. */
    lines: z.array(providerInvoiceLineInput).min(1).max(200).optional(),
    documentNumber: z.string().trim().min(1).max(80),
    issuedAt: payableCalendarDayInput,
    dueAt: payableCalendarDayInput,
    amount: payableAmountInput,
    notes: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(value => occursOnOrAfter(value.dueAt, value.issuedAt), {
    message: 'Due date cannot be before issue date',
    path: ['dueAt'],
  })
  .refine(
    value => !((value.purchaseIds?.length ?? 0) > 1 && !value.lines?.length),
    {
      message: 'Invoice lines are required when consolidating several purchases',
      path: ['lines'],
    }
  )
  // Two keys that disagree about what the invoice covers is not a preference
  // to resolve silently: honouring one of them invoices the wrong deliveries.
  // Declaring the same purchase through both keys is not ambiguous, so it
  // stays accepted; contradicting itself is refused.
  .refine(
    value =>
      !(
        value.purchaseId &&
        value.purchaseIds?.length &&
        !value.purchaseIds.includes(value.purchaseId)
      ),
    {
      message:
        'purchaseId and purchaseIds disagree: include purchaseId in purchaseIds or drop one of them',
      path: ['purchaseIds'],
    }
  );

export type ProviderInvoiceLineInput = z.infer<typeof providerInvoiceLineInput>;

export const createProviderOpeningBalanceInput = z
  .object({
    providerId: z.string().min(1),
    asOf: payableCalendarDayInput,
    dueAt: payableCalendarDayInput,
    amount: payableAmountInput,
    note: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine(value => occursOnOrAfter(value.dueAt, value.asOf), {
    message: 'Due date cannot be before opening date',
    path: ['dueAt'],
  });

const allocationInput = z
  .object({
    invoiceId: z.string().min(1),
    amount: payableAmountInput,
  })
  .strict();

const allocationsInput = z
  .array(allocationInput)
  .min(1)
  .max(100)
  .superRefine((allocations, ctx) => {
    const ids = allocations.map(allocation => allocation.invoiceId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Invoice allocations must be unique' });
    }
  });

export const recordProviderPaymentInput = z
  .object({
    providerId: z.string().min(1),
    amount: payableAmountInput,
    method: z.enum(providerPayablePaymentMethodEnum),
    reference: z.string().trim().max(120).optional(),
    paidAt: payableCalendarDayInput,
    notes: z.string().trim().max(500).optional(),
    allocations: allocationsInput,
  })
  .strict();

export const recordProviderCreditInput = z
  .object({
    providerId: z.string().min(1),
    amount: payableAmountInput,
    documentNumber: z.string().trim().min(1).max(80),
    creditedAt: payableCalendarDayInput,
    reason: z.string().trim().min(1).max(500),
    allocations: allocationsInput,
  })
  .strict();

export type CreateProviderInvoiceInput = z.infer<typeof createProviderInvoiceInput>;
export type CreateProviderOpeningBalanceInput = z.infer<typeof createProviderOpeningBalanceInput>;
export type RecordProviderPaymentInput = z.infer<typeof recordProviderPaymentInput>;
export type RecordProviderCreditInput = z.infer<typeof recordProviderCreditInput>;
