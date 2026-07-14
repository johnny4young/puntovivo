/**
 * Drizzle schema — base domain.
 *
 * ENG-178 — relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/base
 */
import { check, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { UNIT_DIMENSIONS } from '@puntovivo/shared/units';
import type { UnitDimension } from '@puntovivo/shared/units';
import { USER_ROLES } from '@puntovivo/shared/roles';

// ============================================================================
// MONEY INVARIANTS (ENG-176a)
// ============================================================================
//
// Every monetary column in the schema is stored as `real()` (SQLite IEEE-754
// double). The application layer rounds to two decimals at the Zod boundary
// (ENG-166 hardened that with `.strict()`), but the storage layer itself had
// no defence against an unrounded write — a bug in a future feature, a raw
// SQL CLI session, or a botched import could persist values like
// `100.005000000001` or a negative `total = -50`. The audit
// (ENG-176) names this as a data-integrity gap
// that blocks ENG-156 (multi-currency operations) and ENG-161 (NFe Brazil).
//
// ENG-176a closes the gap with table-level CHECK constraints. The
// decision is documented in `docs/architecture/0009-money-storage-and-validation.md`
// (real + CHECK invariants chosen over integer minor units; the latter
// remains a future option if rounding bugs surface at the IEEE-754 layer).
//
// Two helpers cover the two categories of monetary columns:
//
//   - `moneyPositiveChecks(name, col)` — emits BOTH a non-negative
//     (`>= 0`) CHECK AND a two-decimal precision (`round(col, 2) = col`)
//     CHECK. Apply to columns that can NEVER hold a negative value
//     (totals, subtotals, taxes, costs, tips, service charges, opening
//     floats, credit limits, refund amounts).
//
//   - `moneyTwoDecimalCheck(name, col)` — emits ONLY the precision
//     CHECK. Apply to signed columns (discounts, cash-movement
//     amounts, sale-payment reverses, cash-session over/short
//     variance) where negative values are semantically meaningful but
//     decimal drift beyond two digits is not.
//
// The 2-decimal rule is hard-coded for now. ENG-176b stores
// `currency_code` on transactional rows, and a future iteration can
// refine the CHECK to honour the per-currency decimal count from
// `currency_catalog` (JPY = 0, BHD = 3). For the current LATAM-only
// deployment window every active currency uses 2 decimals, so the
// simple form is correct.
//
// The precision invariant relies on the application layer rounding
// every monetary value to two decimals at the write boundary using
// `roundMoney()` from `lib/money.ts`. ENG-176a Step-a shipped the
// `_nonneg` invariant alone; ENG-176a-rounding Step-b extended the
// schema to both invariants once the application sweep landed (see
// `lib/money.ts` for the canonical helper and the call-site policy:
// every `db.insert/update` to a monetary column passes through
// `roundMoney()` first).
//
// Naming: every constraint is prefixed `chk_<table>_<column>_<kind>`
// so the SQLite error message ("CHECK constraint failed:
// chk_sales_total_nonneg" or "chk_sale_items_discount_2dec") is
// self-describing in operator dashboards and log lines.
export const moneyPositiveChecks = (constraintPrefix: string, col: AnySQLiteColumn) => [
  check(`chk_${constraintPrefix}_nonneg`, sql`${col} >= 0`),
  check(`chk_${constraintPrefix}_2dec`, sql`round(${col}, 2) = ${col}`),
];

/**
 * Signed-column precision invariant. Emits only `chk_<prefix>_2dec`
 * (`round(col, 2) = col`). Use for monetary columns that legitimately
 * hold negative values: discounts represented as deltas
 * (`sales.discountAmount`, `sale_items.discount`), cash-movement
 * amounts (paid_out / refund / skim), reverse sale payments, and
 * cash-session over/short variance.
 */
export const moneyTwoDecimalCheck = (constraintPrefix: string, col: AnySQLiteColumn) =>
  check(`chk_${constraintPrefix}_2dec`, sql`round(${col}, 2) = ${col}`);

// ============================================================================
// ENUMS (as string literals for SQLite)
// ============================================================================

export const syncStatusEnum = ['pending', 'synced', 'conflict', 'error'] as const;
export const paymentMethodEnum = ['cash', 'card', 'transfer', 'credit', 'other'] as const;
export const paymentStatusEnum = ['pending', 'paid', 'partial', 'refunded'] as const;
export const idempotencyKeyStatusEnum = ['processing', 'succeeded', 'failed'] as const;
export const saleStatusEnum = ['draft', 'completed', 'cancelled', 'voided'] as const;
export const purchaseStatusEnum = [
  'draft',
  'completed',
  'partial_returned',
  'returned',
  'voided',
] as const;
export const orderStatusEnum = ['submitted', 'partial_received', 'received', 'voided'] as const;
export const movementTypeEnum = ['purchase', 'sale', 'adjustment', 'transfer', 'return'] as const;
export const cashSessionStatusEnum = ['open', 'closed'] as const;
export const cashMovementTypeEnum = [
  'sale',
  'refund',
  'paid_in',
  'paid_out',
  'skim',
  'replenishment',
] as const;
export type CashMovementType = (typeof cashMovementTypeEnum)[number];
export const userRoleEnum = USER_ROLES;
export const deviceAuthorityRoleEnum = ['authority_node', 'hub_client', 'web_client'] as const;
export type DeviceAuthorityRole = (typeof deviceAuthorityRoleEnum)[number];

export const devicePairingCodeStatusEnum = ['pending', 'claimed', 'expired', 'revoked'] as const;
export type DevicePairingCodeStatus = (typeof devicePairingCodeStatusEnum)[number];

export const sequentialDocumentTypeEnum = ['sale', 'purchase', 'order', 'quotation'] as const;
export const quotationStatusEnum = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'converted',
] as const;
export type QuotationStatus = (typeof quotationStatusEnum)[number];
export const initialInventoryModeEnum = ['initial', 'physical'] as const;

/**
 * Lifecycle of an inventory lot (Auditoría 2026-07 — lots & costing).
 * `active` lots are FEFO-consumable; `depleted` reached zero on-hand;
 * `expired` passed its date and is held out of sale; `quarantined` is
 * blocked pending inspection/recall. Stored as text; nullable/default
 * 'active' on the column.
 */
export const lotStatusEnum = ['active', 'depleted', 'expired', 'quarantined'] as const;
export type LotStatus = (typeof lotStatusEnum)[number];

/**
 * Physical dimension of a measurement unit (Auditoría 2026-07 — units
 * foundation). Groups otherwise free-form tenant units so the app can
 * validate dimensional coherence (a product's units should share a
 * dimension), drive global conversions, and map to a standard
 * unit-of-measure code for fiscal e-invoicing. `count` is the default
 * for piece/each; `other` is the escape hatch for units that do not fit a
 * physical dimension. Nullable on the column so legacy rows round-trip.
 */
export const unitDimensionEnum = UNIT_DIMENSIONS;
export type { UnitDimension };

/**
 * Phase 8 / Tier-2 #8 — audit trail for sensitive operations.
 *
 * The list is intentionally open-ended: the full set of `action` / `resource_type`
 * values is enforced in the service layer (`services/audit-logs.ts`), not at
 * the DB enum level, so new auditable operations can be added without a
 * migration. The string is stored as plain text and new values simply round
 * trip.
 */
export const auditLogActionEnum = [
  'transfer.void',
  'quotation.delete',
  'quotation.convert',
  // Phase 8 / Tier-2 #8 — sensitive sale, cash, and inventory actions.
  // The DB column is free-form text (no enum constraint at the SQL layer)
  // so adding entries here NEVER requires a migration; only the TS-level
  // narrowing is widened.
  'sale.void',
  'sale.return',
  'cash_session.close',
  // ENG-056 — shift-lifecycle parity. open had no audit row before; add
  // it alongside close so the audit trail brackets every shift symmetrically.
  // movement covers the manual paid_in / paid_out / skim / replenishment
  // mutations routed through `application/cash-sessions/recordCashMovement`.
  'cash_session.open',
  'cash_session.movement',
  'inventory.adjust_stock',
  // ENG-007 second wave — purchase voids, admin user lifecycle, manual
  // price overrides at checkout. Same free-form-text rule applies: no
  // migration is needed to add audit actions here.
  'purchase.void',
  'user.create',
  'user.update',
  'sale.price_override',
  // ENG-018 — park-and-resume (multi-cart workspace). `sale.park` is emitted
  // when a cashier suspends a draft sale; `sale.resume` when the same or
  // another cashier (manager/admin override) reopens it. Gated at the
  // service level by the optional `audit_park_sale` tenant setting so
  // tenants that consider park churn noise can suppress the rows.
  'sale.park',
  'sale.resume',
  // ENG-019 — receipt reprint. One row per reprint invocation, metadata
  // carries the reason dropdown value + reprint ordinal count.
  'sale.reprint',
  // ENG-018c — draft completion. Emitted by `sales.completeDraft` when
  // a draft sale transitions to `status='completed'`. Creates the audit
  // parity with void/return/park — any state-change on an existing sale
  // leaves a row in the log.
  'sale.complete',
  // ENG-047 — local anomaly detector persistence. Emitted when the
  // dashboard detector surfaces a new non-snoozed alert.
  'ai.anomaly.detected',
  // ENG-068 — module activation kernel. Admin toggles a tenant
  // module on/off via `modules.setActive`; metadata carries
  // `{moduleId, wasExplicit, defaultEnabled}` for activation history.
  'module.toggle',
  // ENG-075 — Authority Node operability. Admin revokes a hub-client
  // terminal from the Operations Center Authority tab.
  'device.revoke',
  // ENG-168 — every successful pairing claim (the moment a fresh
  // Electron install consumes its short-lived pairing code) leaves an
  // audit row scoped to the claiming user. `metadata` carries the
  // last 4 chars of the code + the resolved siteId + kind so an
  // operator can reconcile a device handover after-the-fact without
  // re-running the pairing flow. Emitted by
  // `services/devices/authority/pairing.ts:claimPairingCodeForDevice` only
  // when the caller passes an `actorUserId` (the tRPC routers always
  // do).
  'device.pairing.claimed',
  // ENG-065d — Operations Center payment reconciliation admin gestures.
  // `payment.retry` resets a `payment_outbox` row back to `queued` so
  // the worker re-dispatches it. `payment.mark_settled` is a manual
  // override the operator uses when the provider already confirmed
  // settlement out-of-band. Both rows carry the row's prior status +
  // attempts in `before` so forensics can replay the lifecycle.
  'payment.retry',
  'payment.mark_settled',
  // ENG-039b — restaurant table catalog admin gestures. Every CRUD on
  // a `restaurant_tables` row emits an audit entry carrying the row's
  // prior + post-action snapshot so forensics can replay the catalog
  // history across pilots.
  'restaurant_table.create',
  'restaurant_table.update',
  'restaurant_table.archive',
  // ENG-039c — `sales.changeTable` moves a suspended draft between
  // restaurant tables (or detaches it back to free text). Audit row
  // captures the prior + post tableId so forensics can reconstruct
  // table occupancy timelines.
  'sale.changeTable',
  // ENG-039c3 — `sales.splitDraft` carves a subset of items out of a
  // suspended draft into a brand-new suspended draft so the operator
  // can bill guests separately. Audit row's `resourceId` is the NEW
  // draft id (the forensic primary); `metadata.sourceSaleNumber`
  // carries the back-pointer to the donor draft.
  'sale.splitDraft',
  'ai.invoice_ocr.extract',
  'ai.invoice_ocr.confirm',
  'ai.copilot.query',
  'ai.anomaly.silenced',
  'ai.semantic_search.regenerate_embeddings',
  // ENG-098 — kitchen display lifecycle. `kds.order.ready` is the cook
  // marking a card Listo; `kds.order.recalled` is the recovery affordance
  // when the cook misclicks and needs to flip a ready row back to pending.
  // Both rows carry the row's prior + post snapshot so forensics can
  // reconstruct the kitchen timeline.
  'kds.order.ready',
  'kds.order.recalled',
  // ENG-007 closure — credit-policy mutations. `customer.credit_limit.update`
  // captures every per-customer cupo adjustment from the customers admin;
  // `sale.credit_override` fires when an admin authorised a sale whose
  // projected balance exceeded the customer's credit_limit (overrideApplied
  // === true in the credit-limit projection). The ENG-007 original wording
  // mentioned a `company_credit_settings` table that ENG-090 never created
  // (the credit-sales feature put the cupo on the customer row instead);
  // these two actions cover the two real mutation surfaces.
  'customer.credit_limit.update',
  // ENG-129b — every disclosure of a customer's allowlisted personal-data
  // document is auditable. Metadata carries only schema version + aggregate
  // section counts; PII remains inside the one-time response document.
  'customer.personal_data.export',
  'sale.credit_override',
  // ENG-103 — audit-grade export contract. `fiscal.xml.downloaded` is
  // emitted every time `reports.fiscal.getXml` returns a signed XML body
  // to the operator. The audit row carries the document id + cufe in
  // `metadata` so forensics can reconstruct who downloaded which XML
  // when. The download itself is admin / manager — gated, scoped by
  // tenant — emitted on the server side of the procedure right before
  // the response.
  'fiscal.xml.downloaded',
  // ENG-135 — production observability foundation rail. Emitted every
  // time an admin flips `tenants.settings.telemetryOptIn` via
  // `companies.updateTelemetryOptIn`. `before` / `after` carry the
  // boolean state so forensics can replay the consent timeline.
  // Free-form text in the SQL layer — no migration needed.
  'telemetry.opt_in.updated',
  // ENG-199 — expiry radar. `discount_suggested` fires when a manager
  // accepts the radar CTA for an expiring lot (metadata carries lotNumber,
  // productId, discountPct, lotExpiresAt); `discount_suggestion_dismissed`
  // when the suggestion is retired without a promo. Both key on the
  // price_suggestions row id. Free-form text at the SQL layer.
  'inventory.lot.discount_suggested',
  'inventory.lot.discount_suggestion_dismissed',
] as const;
export type AuditLogAction = (typeof auditLogActionEnum)[number];

export const auditLogResourceTypeEnum = [
  'transfer_order',
  'quotation',
  'sale',
  'cash_session',
  // ENG-056 — manual cash movements emit cash_session.movement audit rows
  // keyed to the inserted cash_movements row id.
  'cash_movement',
  'product',
  // ENG-007 second wave resources.
  'purchase',
  'user',
  // ENG-047 wrote anomaly rows keyed to the flagged cashier in early
  // dev databases. Keep the reader tolerant so those rows stay visible.
  'cashier',
  // ENG-068 — module activation kernel. `module.toggle` audit rows
  // key on the module id (one row per module per tenant per toggle).
  'tenant_module',
  // ENG-075 — hub-client terminal registry lifecycle.
  'device',
  // ENG-065d — payment_outbox rows targeted by admin retry / mark_settled.
  'payment_outbox',
  // ENG-039b — restaurant table catalog rows.
  'restaurant_table',
  'ai_feature',
  // ENG-098 — kitchen display rows.
  'kds_order',
  // ENG-007 closure — customer rows targeted by credit-limit audits.
  // ENG-089/090 shipped the credit-sales feature without ever emitting
  // audit rows from the customers router, so this resource type is new.
  'customer',
  // ENG-103 — fiscal documents targeted by the new `getXml` download
  // procedure. The audit row's `resourceId` is the `fiscal_documents.id`
  // (internal id, NOT cufe) so cross-tenant collapse stays consistent
  // with the rest of the resource catalog.
  'fiscal_document',
  // ENG-135 — tenant-level settings rows targeted by
  // `telemetry.opt_in.updated`. `resourceId` is the tenantId itself
  // so cross-tenant collapse keeps the toggle history scoped.
  'tenant',
  // ENG-199 — price_suggestions rows targeted by the expiry-radar CTA
  // audits (resourceId = the suggestion row id; the lot travels in
  // metadata so the row survives lot deletion).
  'price_suggestion',
] as const;
export type AuditLogResourceType = (typeof auditLogResourceTypeEnum)[number];

/**
 * Iter 2 — Receipt templates (declarative editor + pure renderer).
 *
 * `kind` partitions templates by document type; `paper_width` is denormalized
 * out of the JSON layout so the list view can filter without parsing every
 * blob. The actual block tree lives in `layout_json` as a `ReceiptLayout`
 * shape validated by Zod at the router boundary — no free-form HTML is
 * accepted, only a closed set of atomic blocks (text, logo, items table,
 * totals, tenders, qr, separator, barcode128).
 */
export const receiptTemplateKindEnum = ['sale', 'quotation', 'fiscal_dee'] as const;
export type ReceiptTemplateKind = (typeof receiptTemplateKindEnum)[number];

export const receiptTemplatePaperWidthEnum = ['58mm', '80mm', 'letter', 'a4'] as const;
export type ReceiptTemplatePaperWidth = (typeof receiptTemplatePaperWidthEnum)[number];

export interface CashSessionDenomination {
  value: number;
  count: number;
}

export const nowIso = () => new Date().toISOString();
export const sqliteNow = sql`(datetime('now'))`;
