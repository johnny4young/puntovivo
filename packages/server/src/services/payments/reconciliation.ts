/**
 * Payment reconciliation service ( / ).
 *
 * Decomposed into per-concern modules under `reconciliation/` (
 * slice 23): the read-side report (`report.ts`) and the write-back matcher
 * pass (`pass.ts`), over shared constants / row aliases / classification
 * helpers. This file stays as a thin re-export barrel so existing importers
 * resolve unchanged.
 *
 * @module services/payments/reconciliation
 */

export * from './reconciliation/index.js';
