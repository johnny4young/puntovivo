import { z } from 'zod';

const manualCashMovementTypeEnum = z.enum(['paid_in', 'paid_out', 'skim', 'replenishment']);

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

export const cashSessionMovementsInput = z.object({
  sessionId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const cashSessionReportInput = z
  .object({
    limit: z.number().int().min(1).max(20).default(6),
  })
  .optional();

export const recordCashMovementInput = z.object({
  type: manualCashMovementTypeEnum,
  amount: z.number().positive('Cash movement amount must be greater than zero'),
  note: z
    .string()
    .trim()
    .min(3, 'Cash movement note must be at least 3 characters')
    .max(240, 'Cash movement note must be 240 characters or fewer'),
});

export type CashSessionDenominationInput = z.infer<typeof cashSessionDenominationInput>;
export type GetActiveCashSessionInput = z.infer<typeof getActiveCashSessionInput>;
export type OpenCashSessionInput = z.infer<typeof openCashSessionInput>;
export type CloseCashSessionInput = z.infer<typeof closeCashSessionInput>;
export type CashSessionMovementsInput = z.infer<typeof cashSessionMovementsInput>;
export type CashSessionReportInput = z.infer<typeof cashSessionReportInput>;
export type RecordCashMovementInput = z.infer<typeof recordCashMovementInput>;
