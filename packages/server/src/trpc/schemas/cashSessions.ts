import { z } from 'zod';

export const cashSessionDenominationInput = z.object({
  value: z.number().positive('Denomination value must be greater than zero'),
  count: z.number().int().min(0, 'Denomination count cannot be negative'),
});

export const getActiveCashSessionInput = z
  .object({
    siteId: z.string().optional(),
  })
  .optional();

export const openCashSessionInput = z.object({
  registerName: z
    .string()
    .trim()
    .min(1, 'Register name is required')
    .max(80, 'Register name must be 80 characters or fewer')
    .default('Main register'),
  openingFloat: z.number().min(0, 'Opening float cannot be negative'),
  denominations: z.array(cashSessionDenominationInput).default([]),
});

export const closeCashSessionInput = z.object({
  actualCount: z.number().min(0, 'Closing count cannot be negative'),
  denominations: z.array(cashSessionDenominationInput).default([]),
});

export type CashSessionDenominationInput = z.infer<typeof cashSessionDenominationInput>;
export type GetActiveCashSessionInput = z.infer<typeof getActiveCashSessionInput>;
export type OpenCashSessionInput = z.infer<typeof openCashSessionInput>;
export type CloseCashSessionInput = z.infer<typeof closeCashSessionInput>;
