import { z } from 'zod';
import { providerPayablePaymentMethodEnum } from '../../db/schema.js';

const providerIdInput = z.object({ providerId: z.string().min(1) }).strict();
const payableAmountInput = z.number().finite().min(0.01).multipleOf(0.01);
const payableCalendarDayInput = z.iso.date({ error: 'Expected a valid YYYY-MM-DD calendar day' });

function occursOnOrAfter(later: string, earlier: string): boolean {
  return later >= earlier;
}

export const providerPayableOverviewInput = providerIdInput;

export const createProviderInvoiceInput = z
  .object({
    providerId: z.string().min(1),
    purchaseId: z.string().min(1).optional(),
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
  });

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
