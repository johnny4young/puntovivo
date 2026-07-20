// UI + enum layer of the former monolithic `types/index.ts`.
//
// Everything here is a shared primitive string-literal union, a generic
// response wrapper, or another primitive helper shape. None of these
// reference a domain entity, so this module sits at
// the bottom of the type dependency graph and `domain.ts` imports the
// unions it needs from here. Re-exported through `types/index.ts` (a
// shim kept for one release); prefer importing from `@/types/ui`
// directly in new code.

export type { UserRole } from '@puntovivo/shared/roles';

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'credit' | 'other';
export type PaymentStatus = 'pending' | 'paid' | 'partial' | 'refunded';
export type SaleStatus = 'draft' | 'completed' | 'cancelled' | 'voided';
export type CashSessionStatus = 'open' | 'closed';
export type CashMovementType =
  'sale' | 'refund' | 'paid_in' | 'paid_out' | 'skim' | 'replenishment';

export type TransferHistoryStatus = 'completed' | 'in_transit' | 'void';

// ============================================================================
// QUOTATIONS ()
// ============================================================================

export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted';

/** Statuses an operator can transition to via the UI today. */
export type QuotationTransitionStatus = Extract<
  QuotationStatus,
  'sent' | 'accepted' | 'rejected' | 'expired' | 'converted'
>;

// ============================================================================
// AUDIT LOGS ()
// ============================================================================

// Mirror of `auditLogActionEnum` in packages/server/src/db/schema.ts. The
// canonical source of truth is the server enum; this duplication exists only
// because the audit-logs page declares <option> arrays and React needs the
// literal union at compile time. Update both when adding a new audited
// action so the picker shows the new entry.
export type AuditLogAction =
  | 'transfer.void'
  | 'quotation.delete'
  | 'quotation.convert'
  | 'sale.void'
  | 'sale.return'
  | 'cash_session.close'
  // shift-lifecycle parity (open + manual movement audits).
  | 'cash_session.open'
  | 'cash_session.movement'
  | 'inventory.adjust_stock'
  // second wave — admin-surface events.
  | 'purchase.void'
  | 'user.create'
  | 'user.update'
  | 'user.pin.update'
  | 'auth.staff_switch'
  | 'employee_shift.clock_in'
  | 'employee_shift.clock_out'
  | 'employee_shift.correct'
  // explicit employee break boundaries.
  | 'employee_shift_break.start'
  | 'employee_shift_break.end'
  // manager-authored schedule lifecycle.
  | 'scheduled_shift.create'
  | 'scheduled_shift.update'
  | 'scheduled_shift.cancel'
  | 'manager_approval.request'
  | 'manager_approval.approve'
  | 'manager_approval.reject'
  | 'manager_approval.cancel'
  | 'manager_approval.consume'
  | 'loss_prevention.settings.updated'
  | 'loss_prevention.triggered'
  | 'loss_prevention.alert.acknowledged'
  | 'cash_drawer.open'
  | 'sale.price_override'
  // park-and-resume (including discard metadata flag).
  | 'sale.park'
  | 'sale.resume'
  // receipt reprint.
  | 'sale.reprint'
  // draft completion (state change on an existing draft).
  | 'sale.complete'
  // local anomaly detector audit persistence.
  | 'ai.anomaly.detected'
  // module activation kernel toggle audit row.
  | 'module.toggle'
  // A-30 — vertical preset applied (sets several surface modules at once).
  | 'module.preset_applied'
  // hub-client terminal revocation.
  | 'device.revoke'
  // fresh device claims its pairing code (handover trail).
  | 'device.pairing.claimed'
  // Operations Center payment admin gestures.
  | 'payment.retry'
  | 'payment.mark_settled'
  // restaurant table catalog admin gestures.
  | 'restaurant_table.create'
  | 'restaurant_table.update'
  | 'restaurant_table.archive'
  // restaurant table FK move on a suspended draft.
  | 'sale.changeTable'
  // split-bill: subset of items moved out of a suspended
  // draft into a brand-new suspended draft. resourceId references the
  // new draft; metadata.sourceSaleNumber names the donor.
  | 'sale.splitDraft'
  // / AI Núcleo 2026-05-15 — generic AI-feature audit rows.
  | 'ai.invoice_ocr.extract'
  | 'ai.invoice_ocr.confirm'
  | 'ai.copilot.query'
  | 'ai.anomaly.silenced'
  | 'ai.semantic_search.regenerate_embeddings'
  // kitchen display Listo + recall actions.
  | 'kds.order.ready'
  | 'kds.order.recalled'
  // closure — credit-policy mutations.
  | 'customer.credit_limit.update'
  // audited customer personal-data disclosure.
  | 'customer.personal_data.export'
  | 'customer.personal_data.delete'
  | 'customer.personal_data.anonymize'
  // tenant retention policy changes and manual sweeps.
  | 'data_retention.policy.updated'
  | 'data_retention.sweep.run'
  | 'sale.credit_override'
  // audit-grade export contract. Emitted by
  // `reports.fiscal.getXml` every time an admin / manager downloads
  // a signed XML body. Metadata carries `{ cufe, documentNumber }`.
  | 'fiscal.xml.downloaded'
  // production observability rail. Emitted every time an
  // admin flips `tenants.settings.telemetryOptIn` via
  // `companies.updateTelemetryOptIn`. before/after carry the boolean
  // state so forensics can replay the consent timeline.
  | 'telemetry.opt_in.updated'
  // expiry-radar discount suggestions (accept + dismiss).
  | 'inventory.lot.discount_suggested'
  | 'inventory.lot.discount_suggestion_dismissed'
  // admin restore-readiness evidence.
  | 'backup.restore_drill'
  // through  — launch import summaries.
  | 'data_import.products'
  | 'data_import.customers'
  | 'data_import.providers'
  | 'data_import.customer_balances'
  | 'data_import.opening_cash'
  | 'data_import.fiscal_profile'
  // immutable comprehensive day-close attestation.
  | 'day_close.sign_off';

export type AuditLogResourceType =
  | 'transfer_order'
  | 'quotation'
  | 'sale'
  | 'cash_session'
  // manual cash movements emit audit rows keyed to the
  // cash_movements row id.
  | 'cash_movement'
  | 'product'
  | 'purchase'
  | 'user'
  | 'employee_shift'
  | 'employee_shift_break'
  | 'scheduled_shift'
  | 'manager_approval'
  | 'loss_prevention_rule'
  | 'loss_prevention_alert'
  | 'site'
  | 'cashier'
  // module activation kernel resource type.
  | 'tenant_module'
  // hub-client terminal registry lifecycle.
  | 'device'
  // payment_outbox rows targeted by admin retry / mark_settled.
  | 'payment_outbox'
  // restaurant_tables catalog rows.
  | 'restaurant_table'
  // / AI Núcleo 2026-05-15 — generic AI-feature resource rows.
  | 'ai_feature'
  // kitchen display rows.
  | 'kds_order'
  // closure — customer rows targeted by credit-limit audits.
  | 'customer'
  // fiscal documents targeted by the `getXml` download
  // procedure. `resourceId` is the internal `fiscal_documents.id`,
  // not the cufe.
  | 'fiscal_document'
  // tenant-level settings rows targeted by the
  // `telemetry.opt_in.updated` action. `resourceId` is the tenantId.
  | 'tenant'
  // price_suggestions rows targeted by the expiry-radar audits.
  | 'price_suggestion'
  // scheduler-owned encrypted snapshot.
  | 'backup_snapshot'
  // one auditable launch import run.
  | 'data_import'
  // signed comprehensive day-close evidence.
  | 'day_close_signoff';

export type PurchaseStatus = 'draft' | 'completed' | 'partial_returned' | 'returned' | 'voided';

export type OrderStatus = 'submitted' | 'partial_received' | 'received' | 'voided';

export type MovementType = 'purchase' | 'sale' | 'adjustment' | 'transfer' | 'return';

export type InitialInventoryMode = 'initial' | 'physical';

export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'error';

// API Response Types

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
