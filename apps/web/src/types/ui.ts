// ENG-179c — UI + enum layer of the former monolithic `types/index.ts`.
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
// QUOTATIONS (Phase 5 / Tier-2 #6)
// ============================================================================

export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted';

/** Statuses an operator can transition to via the UI today. */
export type QuotationTransitionStatus = Extract<
  QuotationStatus,
  'sent' | 'accepted' | 'rejected' | 'expired' | 'converted'
>;

// ============================================================================
// AUDIT LOGS (Phase 8 / Tier-2 #8)
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
  // ENG-056 — shift-lifecycle parity (open + manual movement audits).
  | 'cash_session.open'
  | 'cash_session.movement'
  | 'inventory.adjust_stock'
  // ENG-007 second wave — admin-surface events.
  | 'purchase.void'
  | 'user.create'
  | 'user.update'
  | 'user.pin.update'
  | 'auth.staff_switch'
  | 'employee_shift.clock_in'
  | 'employee_shift.clock_out'
  | 'manager_approval.request'
  | 'manager_approval.approve'
  | 'manager_approval.reject'
  | 'manager_approval.cancel'
  | 'manager_approval.consume'
  | 'sale.price_override'
  // ENG-018 — park-and-resume (including discard metadata flag).
  | 'sale.park'
  | 'sale.resume'
  // ENG-019 — receipt reprint.
  | 'sale.reprint'
  // ENG-018c — draft completion (state change on an existing draft).
  | 'sale.complete'
  // ENG-047 — local anomaly detector audit persistence.
  | 'ai.anomaly.detected'
  // ENG-068 — module activation kernel toggle audit row.
  | 'module.toggle'
  // ENG-075 — hub-client terminal revocation.
  | 'device.revoke'
  // ENG-168 — fresh device claims its pairing code (handover trail).
  | 'device.pairing.claimed'
  // ENG-065d — Operations Center payment admin gestures.
  | 'payment.retry'
  | 'payment.mark_settled'
  // ENG-039b — restaurant table catalog admin gestures.
  | 'restaurant_table.create'
  | 'restaurant_table.update'
  | 'restaurant_table.archive'
  // ENG-039c — restaurant table FK move on a suspended draft.
  | 'sale.changeTable'
  // ENG-039c3 — split-bill: subset of items moved out of a suspended
  // draft into a brand-new suspended draft. resourceId references the
  // new draft; metadata.sourceSaleNumber names the donor.
  | 'sale.splitDraft'
  // ENG-094 / AI Núcleo 2026-05-15 — generic AI-feature audit rows.
  | 'ai.invoice_ocr.extract'
  | 'ai.invoice_ocr.confirm'
  | 'ai.copilot.query'
  | 'ai.anomaly.silenced'
  | 'ai.semantic_search.regenerate_embeddings'
  // ENG-098 — kitchen display Listo + recall actions.
  | 'kds.order.ready'
  | 'kds.order.recalled'
  // ENG-007 closure — credit-policy mutations.
  | 'customer.credit_limit.update'
  // ENG-129b — audited customer personal-data disclosure.
  | 'customer.personal_data.export'
  | 'customer.personal_data.delete'
  | 'customer.personal_data.anonymize'
  // ENG-129d — tenant retention policy changes and manual sweeps.
  | 'data_retention.policy.updated'
  | 'data_retention.sweep.run'
  | 'sale.credit_override'
  // ENG-103 — audit-grade export contract. Emitted by
  // `reports.fiscal.getXml` every time an admin / manager downloads
  // a signed XML body. Metadata carries `{ cufe, documentNumber }`.
  | 'fiscal.xml.downloaded'
  // ENG-135 — production observability rail. Emitted every time an
  // admin flips `tenants.settings.telemetryOptIn` via
  // `companies.updateTelemetryOptIn`. before/after carry the boolean
  // state so forensics can replay the consent timeline.
  | 'telemetry.opt_in.updated'
  // ENG-199 — expiry-radar discount suggestions (accept + dismiss).
  | 'inventory.lot.discount_suggested'
  | 'inventory.lot.discount_suggestion_dismissed'
  // ENG-136b — admin restore-readiness evidence.
  | 'backup.restore_drill';

export type AuditLogResourceType =
  | 'transfer_order'
  | 'quotation'
  | 'sale'
  | 'cash_session'
  // ENG-056 — manual cash movements emit audit rows keyed to the
  // cash_movements row id.
  | 'cash_movement'
  | 'product'
  | 'purchase'
  | 'user'
  | 'employee_shift'
  | 'manager_approval'
  | 'cashier'
  // ENG-068 — module activation kernel resource type.
  | 'tenant_module'
  // ENG-075 — hub-client terminal registry lifecycle.
  | 'device'
  // ENG-065d — payment_outbox rows targeted by admin retry / mark_settled.
  | 'payment_outbox'
  // ENG-039b — restaurant_tables catalog rows.
  | 'restaurant_table'
  // ENG-094 / AI Núcleo 2026-05-15 — generic AI-feature resource rows.
  | 'ai_feature'
  // ENG-098 — kitchen display rows.
  | 'kds_order'
  // ENG-007 closure — customer rows targeted by credit-limit audits.
  | 'customer'
  // ENG-103 — fiscal documents targeted by the `getXml` download
  // procedure. `resourceId` is the internal `fiscal_documents.id`,
  // not the cufe.
  | 'fiscal_document'
  // ENG-135 — tenant-level settings rows targeted by the
  // `telemetry.opt_in.updated` action. `resourceId` is the tenantId.
  | 'tenant'
  // ENG-199 — price_suggestions rows targeted by the expiry-radar audits.
  | 'price_suggestion'
  // ENG-136b — scheduler-owned encrypted snapshot.
  | 'backup_snapshot';

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
