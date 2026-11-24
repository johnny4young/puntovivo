/**
 * Zod schemas for `reports.cash.*` + `reports.inventory.*`
 * sub-routers (Operations Center cash + inventory reconciliation tabs).
 *
 * The fiscal sub-router already keeps its schemas in `schemas/fiscal.ts`
 * for legacy reasons; new reports namespaces colocate here.
 *
 * @module trpc/schemas/reports
 */

import { z } from 'zod';
import {
  cashDifferenceReasonEnum,
  dayCloseSignatureMethodEnum,
  fiscalDocumentStatusEnum,
  paymentMethodEnum,
} from '../../db/schema.js';

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
// reports.accounting.vouchers
// ─────────────────────────────────────────────────────────────────

const accountingCalendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine(value => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Expected a valid calendar day');

export const accountingVouchersInput = z
  .object({
    /**
     * Inclusive TENANT-LOCAL calendar day (YYYY-MM-DD). Resolved to a
     * UTC window server-side with the tenant timezone, exactly like the
     * day-close report — a client-built `T00:00:00.000Z` would shift a
     * Colombian month by five hours at both edges and make the
     * accounting file disagree with the day-close evidence.
     */
    from: accountingCalendarDay,
    /** Inclusive tenant-local calendar day (YYYY-MM-DD). */
    to: accountingCalendarDay,
    siteId: z.string().min(1).optional(),
    /**
     * Hard cap on returned vouchers. The accounting export is a
     * month-at-a-time workflow; the UI blocks exporting when the cap is
     * hit rather than silently shipping a truncated period.
     */
    limit: z.number().int().min(1).max(5000).default(2000),
  })
  .refine(value => value.from <= value.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

export type AccountingVouchersInput = z.infer<typeof accountingVouchersInput>;

// ─────────────────────────────────────────────────────────────────
// reports.accounting settings
// ─────────────────────────────────────────────────────────────────

export const accountingPucCode = z
  .string()
  .trim()
  .regex(/^[1-9]\d{3,11}$/, 'Expected 4 to 12 digits starting from 1 to 9');

export const accountingPucAccountsInput = z
  .object({
    paymentMethods: z
      .object({
        cash: accountingPucCode,
        card: accountingPucCode,
        transfer: accountingPucCode,
        credit: accountingPucCode,
        other: accountingPucCode,
      })
      .strict(),
    income: accountingPucCode,
    iva: accountingPucCode,
    inc: accountingPucCode,
    tips: accountingPucCode,
    receivable: accountingPucCode,
    storeCredit: accountingPucCode,
    loyalty: accountingPucCode,
    refunds: accountingPucCode,
  })
  .strict();

export const accountingRememberSiteInput = z
  .object({
    siteId: z.string().min(1).nullable(),
  })
  .strict();

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
// Operations Center diagnostic export.
// ─────────────────────────────────────────────────────────────────

const isoDateTime = z.string().datetime({ offset: true });

function isChronologicalRange(value: { fromDate: string; toDate: string }): boolean {
  return Date.parse(value.fromDate) <= Date.parse(value.toDate);
}

/**
 * Lock list of outboxes the export can include. Mirrors ADR-0003
 * taxonomy. `payment` and `webhook` are reserved names for  +
 * and currently rejected — keeping them out of the literal
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
// margin / COGS report sourced from the sale_item_lots ledger.
// ─────────────────────────────────────────────────────────────────

export const profitMarginInput = z
  .object({
    /** Inclusive lower bound on checkout/return event time (ISO 8601 with offset). */
    fromDate: isoDateTime,
    /** Inclusive upper bound on checkout/return event time (ISO 8601 with offset). */
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
// -141b — tenant-local comprehensive manager report + evidence.
// ─────────────────────────────────────────────────────────────────

const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine(value => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Expected a valid calendar day');

export const dayClosePreviewInput = z.object({ date: calendarDay });
/** A drawn signature as SVG path data: absolute moves and lines only, so it renders as-is. */
const signaturePath = z
  .string()
  .max(24_000)
  .regex(
    /^M\d+(?:\.\d+)? \d+(?:\.\d+)?(?:[ML]\d+(?:\.\d+)? \d+(?:\.\d+)?)*$/,
    'Expected signature path data'
  );

export const dayCloseSignOffInput = z.object({
  date: calendarDay,
  /** Explicit irreversible-attestation acknowledgement from the manager UI. */
  attestationAccepted: z.literal(true),
  /** Without one the authenticated session signs, as the report page does. */
  signature: z
    .discriminatedUnion('method', [
      z.object({ method: z.literal('pin'), pin: z.string().regex(/^\d{6}$/) }),
      z.object({ method: z.literal('drawn'), path: signaturePath }),
    ])
    .optional(),
});

const money = z.number().finite();
const readinessCode = z.enum([
  'open_sessions',
  'unexplained_differences',
  'unresolved_drafts',
  'cash_discrepancies',
  'fiscal_pending',
  'fiscal_rejected',
  'high_anomalies',
  'commissions_not_tracked',
  'waste_not_tracked',
]);

export const transferConfirmationDestinationOutput = z.object({
  destinationId: z.string().min(1).nullable(),
  label: z.string().nullable(),
  kind: z.string().nullable(),
  confirmed: money,
  pending: money,
  count: z.number().int().nonnegative(),
  references: z.array(z.string()),
});

/**
 * Money the day's deposits reported that no tender could absorb because the
 * tender was already rejected or cancelled. It is not sale money: it is
 * evidence of a movement a human still has to resolve, and it is never added to
 * confirmed, pending or legacy.
 */
export const notAppliedDepositsOutput = z.object({
  count: z.number().int().nonnegative(),
  amount: money,
  byReason: z.object({
    tender_rejected: z.object({
      count: z.number().int().nonnegative(),
      amount: money,
    }),
    tender_cancelled: z.object({
      count: z.number().int().nonnegative(),
      amount: money,
    }),
    /**
     * Any reason this build does not name. The contract treats the reason as
     * open-ended, so unknown reasons are still money and are kept here instead
     * of being dropped.
     */
    other: z.object({
      count: z.number().int().nonnegative(),
      amount: money,
    }),
  }),
});

/**
 * Transfer confirmation evidence for one business day. Confirmed and pending
 * money are separate fields on purpose: a single transfer figure would report
 * unconfirmed money as if it were collected.
 */
export const transferConfirmationsOutput = z.object({
  saleTotal: money,
  reported: money,
  confirmed: money,
  pending: money,
  rejected: money,
  legacy: money,
  unapplied: money,
  /**
   * Rejected or cancelled tenders whose money was re-issued on the same sale:
   * reported as evidence and never part of `reported`, so each peso of tender
   * is counted once.
   *
   * Optional because a close signed before this field existed must keep
   * verifying byte for byte.
   */
  superseded: money.optional(),
  /** Money received that no tender absorbed. Additive, never sale money. */
  notApplied: notAppliedDepositsOutput.optional(),
  byStatus: z.object({
    pending: z.number().int().nonnegative(),
    customer_reported: z.number().int().nonnegative(),
    manual_confirmed: z.number().int().nonnegative(),
    provider_confirmed: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    needs_reconciliation: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    /** Tenders written before the confirmation lifecycle existed. */
    legacy: z.number().int().nonnegative(),
  }),
  destinations: z.array(transferConfirmationDestinationOutput),
});

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
  /**
   * Optional on purpose: a close signed before this section existed has no such
   * key, and its stored snapshot must keep verifying byte for byte.
   */
  transferConfirmations: transferConfirmationsOutput.optional(),
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

export const dayClosePdfArtifactOutput = z.object({
  id: z.string().min(1),
  rendererVersion: z.literal(1),
  locale: z.string().min(2),
  filename: z.string().regex(/^[A-Za-z0-9._-]+\.pdf$/),
  mimeType: z.literal('application/pdf'),
  byteSize: z.number().int().positive(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: isoDateTime,
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
  /** Null only for  evidence created before stored PDFs shipped. */
  pdf: dayClosePdfArtifactOutput.nullable(),
  signatureMethod: z.enum(dayCloseSignatureMethodEnum),
});

export const dayCloseSignoffOutput = dayCloseSignoffMetadataOutput.extend({
  report: comprehensiveDayCloseReportOutput,
  signaturePath: z.string().nullable(),
});

export const dayCloseChecklistOutput = z.object({
  date: calendarDay,
  sessions: z.array(
    z.object({
      id: z.string().min(1),
      siteId: z.string().min(1),
      registerName: z.string(),
      cashierName: z.string(),
      status: z.enum(['open', 'closed']),
      closedAt: z.string().nullable(),
      counted: z.boolean(),
      /** The drawer's starting cash, which stays out of what is deposited. */
      openingFloat: money,
      overShort: money.nullable(),
      /** Beyond the cent tolerance, so it needs a reason before the day is signed. */
      hasDifference: z.boolean(),
      differenceReason: z.enum(cashDifferenceReasonEnum).nullable(),
      differenceNote: z.string().nullable(),
    })
  ),
  drafts: z.array(
    z.object({
      id: z.string().min(1),
      saleNumber: z.string(),
      label: z.string().nullable(),
      total: money,
      suspendedAt: z.string(),
      carriedOver: z.boolean(),
    })
  ),
});

export type DayClosePreviewInput = z.infer<typeof dayClosePreviewInput>;
export type DayCloseSignOffInput = z.infer<typeof dayCloseSignOffInput>;
export type ComprehensiveDayCloseReportOutput = z.infer<typeof comprehensiveDayCloseReportOutput>;
export type DayClosePdfArtifactOutput = z.infer<typeof dayClosePdfArtifactOutput>;
export type DayCloseSignoffMetadataOutput = z.infer<typeof dayCloseSignoffMetadataOutput>;
export type DayCloseSignoffOutput = z.infer<typeof dayCloseSignoffOutput>;
export type DayCloseChecklistOutput = z.infer<typeof dayCloseChecklistOutput>;
