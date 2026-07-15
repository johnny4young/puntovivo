/**
 * ENG-065b — Zod schemas for `reports.cash.*` + `reports.inventory.*`
 * sub-routers (Operations Center cash + inventory reconciliation tabs).
 *
 * The fiscal sub-router already keeps its schemas in `schemas/fiscal.ts`
 * for legacy reasons; new reports namespaces colocate here.
 *
 * @module trpc/schemas/reports
 */

import { z } from 'zod';
import { fiscalDocumentStatusEnum, paymentMethodEnum } from '../../db/schema.js';

// ─────────────────────────────────────────────────────────────────
// reports.cash.reconciliation
// ─────────────────────────────────────────────────────────────────

export const cashReconciliationInput = z
  .object({
    /**
     * Maximum number of closed sessions returned in
     * `recentDiscrepancies`. The summary + bySite tiles always cover the
     * whole tenant; this clamp only affects the discrepancy tail.
     */
    limit: z.number().int().min(1).max(100).default(20),
  })
  .default({ limit: 20 });

export type CashReconciliationInput = z.infer<typeof cashReconciliationInput>;

// ─────────────────────────────────────────────────────────────────
// reports.inventory.discrepancies
// ─────────────────────────────────────────────────────────────────

export const inventoryDiscrepanciesInput = z
  .object({
    /**
     * Maximum number of flagged rows returned. Tenants with deep
     * historical drift can have thousands of flagged products; we
     * paginate the surface to keep the panel responsive.
     */
    limit: z.number().int().min(1).max(500).default(100),
  })
  .default({ limit: 100 });

export type InventoryDiscrepanciesInput = z.infer<typeof inventoryDiscrepanciesInput>;

// ─────────────────────────────────────────────────────────────────
// reports.diagnostics.preview / reports.diagnostics.export
// ENG-065c — Operations Center diagnostic export.
// ─────────────────────────────────────────────────────────────────

const isoDateTime = z.string().datetime({ offset: true });

function isChronologicalRange(value: { fromDate: string; toDate: string }): boolean {
  return Date.parse(value.fromDate) <= Date.parse(value.toDate);
}

/**
 * Lock list of outboxes the export can include. Mirrors ADR-0003
 * taxonomy. `payment` and `webhook` are reserved names for ENG-063 +
 * ENG-070 and currently rejected — keeping them out of the literal
 * keeps the input shape honest about what's wired today.
 */
export const diagnosticIncludeOutbox = z.enum(['sync', 'fiscal', 'hardware']);
export type DiagnosticIncludeOutbox = z.infer<typeof diagnosticIncludeOutbox>;

const dateRangeSchema = z
  .object({
    fromDate: isoDateTime,
    toDate: isoDateTime,
  })
  .refine(isChronologicalRange, {
    message: 'fromDate must be on or before toDate',
    path: ['toDate'],
  });

export const diagnosticsPreviewInput = dateRangeSchema;
export type DiagnosticsPreviewInput = z.infer<typeof diagnosticsPreviewInput>;

export const diagnosticsExportInput = z
  .object({
    fromDate: isoDateTime,
    toDate: isoDateTime,
    /**
     * Subset of outboxes to include in `tables.*`. Counts are always
     * returned for every known source regardless of this filter.
     * Omitted == include all three. Empty array == include none.
     */
    includeOutboxes: z.array(diagnosticIncludeOutbox).max(3).optional(),
  })
  .refine(isChronologicalRange, {
    message: 'fromDate must be on or before toDate',
    path: ['toDate'],
  });
export type DiagnosticsExportInput = z.infer<typeof diagnosticsExportInput>;

// ─────────────────────────────────────────────────────────────────
// reports.profit.margin
// ENG-190 — margin / COGS report sourced from the sale_item_lots ledger.
// ─────────────────────────────────────────────────────────────────

export const profitMarginInput = z
  .object({
    /** Inclusive lower bound on `sales.created_at` (ISO 8601 with offset). */
    fromDate: isoDateTime,
    /** Inclusive upper bound on `sales.created_at` (ISO 8601 with offset). */
    toDate: isoDateTime,
    /**
     * Maximum product rows returned in the breakdown, ordered by gross
     * profit descending. The summary tiles always cover the full range;
     * this clamp only trims the per-product tail so a deep catalog does
     * not balloon the payload.
     */
    limit: z.number().int().min(1).max(500).default(50),
  })
  .refine(isChronologicalRange, {
    message: 'fromDate must be on or before toDate',
    path: ['toDate'],
  });
export type ProfitMarginInput = z.infer<typeof profitMarginInput>;

// ─────────────────────────────────────────────────────────────────
// reports.dayClose.preview / signoff / signOff
// ENG-141a/ENG-141b — tenant-local comprehensive manager report + evidence.
// ─────────────────────────────────────────────────────────────────

const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine(value => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Expected a valid calendar day');

export const dayClosePreviewInput = z.object({ date: calendarDay });
export const dayCloseSignOffInput = z.object({
  date: calendarDay,
  /** Explicit irreversible-attestation acknowledgement from the manager UI. */
  attestationAccepted: z.literal(true),
});

const money = z.number().finite();
const readinessCode = z.enum([
  'open_sessions',
  'cash_discrepancies',
  'fiscal_pending',
  'fiscal_rejected',
  'high_anomalies',
  'commissions_not_tracked',
  'waste_not_tracked',
]);

export const comprehensiveDayCloseReportOutput = z.object({
  date: calendarDay,
  timeZone: z.string().min(1),
  currencyCode: z.string().length(3),
  generatedAt: isoDateTime,
  window: z.object({ start: isoDateTime, endExclusive: isoDateTime }),
  sales: z.object({
    count: z.number().int().nonnegative(),
    subtotal: money,
    discounts: money,
    taxes: money,
    tips: money,
    serviceCharges: money,
    grossRevenue: money,
    refundAmount: money,
    netRevenue: money,
  }),
  payments: z.array(
    z.object({
      method: z.enum(paymentMethodEnum),
      amount: money,
      transactionCount: z.number().int().nonnegative(),
    })
  ),
  cash: z.object({
    closedSessions: z.number().int().nonnegative(),
    openSessions: z.number().int().nonnegative(),
    expected: money,
    counted: money,
    overShort: money,
    balancedSessions: z.number().int().nonnegative(),
    discrepancySessions: z.number().int().nonnegative(),
  }),
  fiscal: z.object({
    total: z.number().int().nonnegative(),
    totalAmount: money,
    byStatus: z.object(
      Object.fromEntries(
        fiscalDocumentStatusEnum.map(status => [status, z.number().int().nonnegative()])
      ) as Record<(typeof fiscalDocumentStatusEnum)[number], z.ZodNumber>
    ),
  }),
  adjustments: z.object({
    voids: z.object({ count: z.number().int().nonnegative(), amount: money }),
    refunds: z.object({ count: z.number().int().nonnegative(), amount: money }),
  }),
  anomalies: z.object({
    total: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    byKind: z.object({
      ticketsPerHourSpike: z.number().int().nonnegative(),
      voidRate: z.number().int().nonnegative(),
      refundAmount: z.number().int().nonnegative(),
      noSaleSessions: z.number().int().nonnegative(),
    }),
  }),
  capabilities: z.object({
    commissions: z.literal('not_tracked'),
    waste: z.literal('not_tracked'),
  }),
  readiness: z.object({
    readyToSign: z.boolean(),
    blockers: z.array(readinessCode),
    warnings: z.array(readinessCode),
  }),
});

export const dayCloseSignoffMetadataOutput = z.object({
  id: z.string().min(1),
  date: calendarDay,
  schemaVersion: z.literal(1),
  timeZone: z.string().min(1),
  currencyCode: z.string().length(3),
  reportHash: z.string().regex(/^[a-f0-9]{64}$/),
  signedAt: isoDateTime,
  signedBy: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
});

export const dayCloseSignoffOutput = dayCloseSignoffMetadataOutput.extend({
  report: comprehensiveDayCloseReportOutput,
});

export type DayClosePreviewInput = z.infer<typeof dayClosePreviewInput>;
export type DayCloseSignOffInput = z.infer<typeof dayCloseSignOffInput>;
export type ComprehensiveDayCloseReportOutput = z.infer<typeof comprehensiveDayCloseReportOutput>;
export type DayCloseSignoffMetadataOutput = z.infer<typeof dayCloseSignoffMetadataOutput>;
export type DayCloseSignoffOutput = z.infer<typeof dayCloseSignoffOutput>;
