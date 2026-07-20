/**
 * Diagnostic reports sub-router (`reports.diagnostics.*`).
 *
 * Operator-facing bulk export for support tickets. Two procedures:
 *
 * - `preview({fromDate, toDate})` — counts per source so the admin
 * can size the bundle before downloading. Surfaces `willHitLimit`
 * when any source crosses the per-table hard cap.
 * - `export({fromDate, toDate, includeOutboxes?})` — the actual
 * bundle. Returns a flat manifest + JSON-typed arrays per
 * included table. The web client wraps the result in a zip via
 * jszip and triggers a Blob download.
 *
 * Both are admin-only per ADR-0004 — the payloads echo enough of the
 * tenant's runtime state (sale items, customer names, fiscal CUFEs,
 * device identifiers) that we keep the surface to the same role that
 * already sees those rows directly in the existing UI tabs.
 *
 * **Bundle extensibility.** ADR-0003 lists 5 outboxes
 * (sync/fiscal/hardware/payment/webhook). Only the first three exist
 * today; payment_outbox is gated on , webhook_outbox on
 * . The `manifest.counts` keyset is intentionally locked to
 * the 5-name shape (with 0 for the missing two) so `schemaVersion: 1`
 * can be consumed by future tooling without forking. When the gated
 * outboxes ship, append their arrays to `tables.*` and bump the
 * schemaVersion.
 *
 * @module trpc/routers/reports/diagnostics
 */

import { router } from '../../../init.js';
import { previewProcedures } from './preview.js';
import { exportProcedures } from './export.js';

export const diagnosticsReportsRouter = router({
  ...previewProcedures,
  ...exportProcedures,
});

export type DiagnosticsReportsRouter = typeof diagnosticsReportsRouter;

// Re-exported for tests so the assertion threshold tracks the source.
export { __TEST_ROW_LIMIT } from './helpers.js';
// Re-exported so future  /  tickets can update the
// keyset in lockstep with the bundle schema version bump.
export { ALL_OUTBOX_NAMES } from './helpers.js';
