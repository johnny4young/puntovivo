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
