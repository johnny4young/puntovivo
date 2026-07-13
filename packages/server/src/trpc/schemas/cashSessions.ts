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

export const pendingChecksInput = z
  .object({
    sessionId: z.string().min(1).optional(),
  })
  .optional();

/** ENG-198 — day-close ritual: the closed session the summary is about. */
export const dayCloseSummaryInput = z.object({
  sessionId: z.string().min(1, 'Session id is required'),
});

/** WC-C8 — explicit output contract keeps owner-only pulse redaction and the
 * share-card metrics visible to the WC-E2 API snapshot gate. */
export const dayCloseSummaryOutput = z.object({
  session: z.object({
    registerName: z.string(),
    closedAt: z.string(),
    actualCount: z.number().nullable(),
    overShort: z.number().nullable(),
    balanced: z.boolean(),
  }),
  day: z.object({
    date: z.string(),
    salesCount: z.number().int().min(0),
    revenue: z.number(),
  }),
  pulse: z
    .object({
      averageTicket: z.number(),
      previousWeekRevenue: z.number(),
      revenueChangePct: z.number().nullable(),
    })
    .nullable(),
  topProducts: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      sku: z.string(),
      revenue: z.number(),
      grossProfit: z.number().nullable(),
      grossMarginPct: z.number().nullable(),
    })
  ),
  margin: z
    .object({
      grossProfit: z.number(),
      grossMarginPct: z.number(),
    })
    .nullable(),
  streakDays: z.number().int().min(0),
});

export type CashSessionDenominationInput = z.infer<typeof cashSessionDenominationInput>;
export type GetActiveCashSessionInput = z.infer<typeof getActiveCashSessionInput>;
export type OpenCashSessionInput = z.infer<typeof openCashSessionInput>;
export type CloseCashSessionInput = z.infer<typeof closeCashSessionInput>;
export type CashSessionMovementsInput = z.infer<typeof cashSessionMovementsInput>;
export type CashSessionReportInput = z.infer<typeof cashSessionReportInput>;
export type RecordCashMovementInput = z.infer<typeof recordCashMovementInput>;
export type PendingChecksInput = z.infer<typeof pendingChecksInput>;
export type DayCloseSummaryInput = z.infer<typeof dayCloseSummaryInput>;
export type DayCloseSummaryOutput = z.infer<typeof dayCloseSummaryOutput>;
