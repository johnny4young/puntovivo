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
