/**
 * Receipt Template Service (Iter 2 — declarative editor + pure renderer).
 *
 * The service owns persistence + the "one default per (tenant, kind)"
 * invariant. Default flips run inside a SQLite transaction so the old
 * default and the new default never both hold `is_default = 1`
 * simultaneously, even under concurrent admins. This complements the
 * partial unique index in the raw DDL mirror (which would otherwise
 * fail the second insert with a constraint violation — the transaction
 * makes the failure mode "first writer wins" predictably).
 *
 * Decomposed into per-concern modules under `receipt-templates/` (
 * slice 22). This file stays as a thin re-export barrel so existing
 * importers resolve unchanged.
 *
 * @module services/receipt-templates
 */

export * from './receipt-templates/index.js';
