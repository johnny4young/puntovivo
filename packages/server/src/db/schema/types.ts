/**
 * Drizzle schema — types domain.
 *
 * ENG-178 — relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/types
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { sqliteNow } from './base.js';
import { companies, logos, sites, tenants, users } from './auth.js';
import { categories, cities, countries, departments, providers, sequentials, units, vatRates } from './catalogs.js';
import { categoryXProvider, productXProvider, products, unitXProduct } from './products.js';
import { commercialActivities, customers } from './customers.js';
import { invoiceUploads, orderItems, orders, purchaseItems, purchaseReturnItems, purchaseReturns, purchases } from './purchasing.js';
import { sales } from './sales.js';
import { paymentOutbox, saleItems, salePayments, saleReturns } from './salesAux.js';
import { initialInventory, inventoryBalances, inventoryMovements, transferOrderItems, transferOrderStatusEnum, transferOrders } from './inventory.js';
import { auditLogs, quotationItems, quotations } from './quotationsAudit.js';
import { devices, idempotencyKeys, operationEvents } from './devices.js';
import { appSettings, countryCatalog, currencyCatalog, receiptTemplates, syncConflicts, tenantLocaleSettings } from './config.js';

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Logo = typeof logos.$inferSelect;
export type NewLogo = typeof logos.$inferInsert;

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;

export type Country = typeof countries.$inferSelect;
export type NewCountry = typeof countries.$inferInsert;

export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;

export type City = typeof cities.$inferSelect;
export type NewCity = typeof cities.$inferInsert;

export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;

export type CommercialActivity = typeof commercialActivities.$inferSelect;
export type NewCommercialActivity = typeof commercialActivities.$inferInsert;

export type Unit = typeof units.$inferSelect;
export type NewUnit = typeof units.$inferInsert;

export type VatRate = typeof vatRates.$inferSelect;
export type NewVatRate = typeof vatRates.$inferInsert;

export type Sequential = typeof sequentials.$inferSelect;
export type NewSequential = typeof sequentials.$inferInsert;

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

export type UnitXProduct = typeof unitXProduct.$inferSelect;
export type NewUnitXProduct = typeof unitXProduct.$inferInsert;

export type ProductXProvider = typeof productXProvider.$inferSelect;
export type NewProductXProvider = typeof productXProvider.$inferInsert;

export type CategoryXProvider = typeof categoryXProvider.$inferSelect;
export type NewCategoryXProvider = typeof categoryXProvider.$inferInsert;

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;

export type InvoiceUpload = typeof invoiceUploads.$inferSelect;
export type NewInvoiceUpload = typeof invoiceUploads.$inferInsert;

export type PurchaseItem = typeof purchaseItems.$inferSelect;
export type NewPurchaseItem = typeof purchaseItems.$inferInsert;

export type PurchaseReturn = typeof purchaseReturns.$inferSelect;
export type NewPurchaseReturn = typeof purchaseReturns.$inferInsert;

export type PurchaseReturnItem = typeof purchaseReturnItems.$inferSelect;
export type NewPurchaseReturnItem = typeof purchaseReturnItems.$inferInsert;

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;

export type Sale = typeof sales.$inferSelect;
export type NewSale = typeof sales.$inferInsert;

export type SaleItem = typeof saleItems.$inferSelect;
export type NewSaleItem = typeof saleItems.$inferInsert;

export type SalePayment = typeof salePayments.$inferSelect;
export type NewSalePayment = typeof salePayments.$inferInsert;

export type PaymentOutbox = typeof paymentOutbox.$inferSelect;
export type NewPaymentOutbox = typeof paymentOutbox.$inferInsert;

export type SaleReturn = typeof saleReturns.$inferSelect;
export type NewSaleReturn = typeof saleReturns.$inferInsert;

export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type NewInventoryMovement = typeof inventoryMovements.$inferInsert;

export type InitialInventory = typeof initialInventory.$inferSelect;
export type NewInitialInventory = typeof initialInventory.$inferInsert;

export type InventoryBalance = typeof inventoryBalances.$inferSelect;
export type NewInventoryBalance = typeof inventoryBalances.$inferInsert;

export type TransferOrder = typeof transferOrders.$inferSelect;
export type NewTransferOrder = typeof transferOrders.$inferInsert;
export type TransferOrderItem = typeof transferOrderItems.$inferInsert;
export type TransferOrderStatus = (typeof transferOrderStatusEnum)[number];

export type Quotation = typeof quotations.$inferSelect;
export type NewQuotation = typeof quotations.$inferInsert;
export type QuotationItem = typeof quotationItems.$inferSelect;
export type NewQuotationItem = typeof quotationItems.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type DeviceKind = NonNullable<Device['kind']>;

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;

export type ReceiptTemplate = typeof receiptTemplates.$inferSelect;
export type NewReceiptTemplate = typeof receiptTemplates.$inferInsert;

export type SyncConflict = typeof syncConflicts.$inferSelect;
export type NewSyncConflict = typeof syncConflicts.$inferInsert;

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;

export type CurrencyCatalogRow = typeof currencyCatalog.$inferSelect;
export type NewCurrencyCatalogRow = typeof currencyCatalog.$inferInsert;

export type CountryCatalogRow = typeof countryCatalog.$inferSelect;
export type NewCountryCatalogRow = typeof countryCatalog.$inferInsert;

export type TenantLocaleSettingsRow = typeof tenantLocaleSettings.$inferSelect;
export type NewTenantLocaleSettingsRow = typeof tenantLocaleSettings.$inferInsert;

// ============================================================================
// FISCAL CAFS (ENG-036b — Pack Chile DTE 1.0 — Códigos de Autorización
// de Folios). The SII issues a signed XML CAF that authorizes a tenant
// to emit a TipoDTE in a folio range; this table stores the per-tenant
// metadata + raw CAF XML so the allocator can advance the folio cursor
// atomically with the fiscal_documents insert. Mexico's CFDI 4.0 model
// has no equivalent. ENG-036c adds the upload UI + RSA signature parse.
// ============================================================================

export const fiscalCafStatusEnum = ['active', 'exhausted', 'revoked'] as const;
export type FiscalCafStatus = (typeof fiscalCafStatusEnum)[number];

export const fiscalCafs = sqliteTable(
  'fiscal_cafs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /**
     * SII TipoDTE — '33' factura electrónica, '39' boleta electrónica,
     * '61' nota crédito, etc. See `services/fiscal/packs/cl/catalogs/tipoDte.ts`
     * for the curated set ENG-036a shipped.
     */
    tipoDte: text('tipo_dte').notNull(),
    /** RUT emisor — soft-FK to `tenants.settings.fiscal.cl.rut` at ingestion. */
    rutEmisor: text('rut_emisor').notNull(),
    folioDesde: integer('folio_desde').notNull(),
    folioHasta: integer('folio_hasta').notNull(),
    /**
     * Cursor: next folio to allocate. Starts at folio_desde; advances
     * by one per emission until > folio_hasta → status='exhausted'.
     */
    currentFolio: integer('current_folio').notNull(),
    fechaAutorizacion: text('fecha_autorizacion').notNull(),
    /** Raw CAF XML preserved for ENG-036c TED RSA signing. */
    rawXml: text('raw_xml').notNull(),
    status: text('status', { enum: fiscalCafStatusEnum }).notNull().default('active'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  table => [
    // Primary lookup: the active CAF for a (tenant, tipoDte) pair.
    // Partial unique idx — one active CAF per pair, enforced at the
    // schema level. Exhausted/revoked rows free the slot.
    uniqueIndex('idx_fiscal_cafs_active')
      .on(table.tenantId, table.tipoDte)
      .where(sql`${table.status} = 'active'`),
    // Admin listing of all CAFs (active + historical) for a tenant.
    index('idx_fiscal_cafs_tenant').on(table.tenantId, table.status),
  ]
);

export const fiscalCafsRelations = relations(fiscalCafs, ({ one }) => ({
  tenant: one(tenants, {
    fields: [fiscalCafs.tenantId],
    references: [tenants.id],
  }),
}));

export type FiscalCafRow = typeof fiscalCafs.$inferSelect;
export type NewFiscalCafRow = typeof fiscalCafs.$inferInsert;

// ============================================================================
// WEBHOOK OUTBOX (ENG-070 — public events foundation, 5th outbox per
// ADR-0003). The operation-journal projector + the fiscal worker
// emit rows here when a public event is published. The HTTP delivery
// worker that drains them lands in ENG-070b.
// ============================================================================

export const webhookOutboxStatusEnum = [
  'queued',
  'submitting',
  'delivered',
  'failed',
  'retrying',
  'dead_letter',
] as const;
export type WebhookOutboxStatus = (typeof webhookOutboxStatusEnum)[number];

export const webhookOutbox = sqliteTable(
  'webhook_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** Public event type from `services/events/manifest.PUBLIC_EVENT_TYPES`. */
    eventType: text('event_type').notNull(),
    /** Schema version of the payload — ENG-070 v1 ships version 1. */
    eventVersion: integer('event_version').notNull().default(1),
    /**
     * Soft-FK to the `operation_events` row that triggered this
     * webhook event. Nullable because the `fiscal_document.accepted`
     * branch fires from the fiscal worker and may not carry an
     * operation_id (the accept happens out-of-band of the original
     * sale's command envelope).
     */
    operationEventId: text('operation_event_id').references(
      () => operationEvents.id,
      { onDelete: 'set null' }
    ),
    /** Public-contract payload (validated by the manifest's Zod schema before insert). */
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    status: text('status', { enum: webhookOutboxStatusEnum })
      .notNull()
      .default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    /** Normalized error written by the kernel on `fail`. */
    lastError: text('last_error', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    priority: real('priority').notNull().default(0),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    /**
     * Envelope-keyed idempotency. Mirrors ENG-067b's
     * `hardware_outbox.idempotency_key` shape: a duplicate enqueue
     * with the same key collapses to one row via the partial unique
     * idx; rows with NULL stay independent (admin-triggered replays).
     */
    idempotencyKey: text('idempotency_key'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  table => [
    // Primary path for the future kernel claimNext: filter by tenant +
    // status (queued or retrying) + nextRetryAt window.
    index('idx_webhook_outbox_tenant_status_retry').on(
      table.tenantId,
      table.status,
      table.nextRetryAt
    ),
    // Operations Center listing + peek.
    index('idx_webhook_outbox_tenant_created').on(table.tenantId, table.createdAt),
    // Partial unique idx for envelope-keyed idempotency. SQLite +
    // Drizzle support partial indexes via the `where` chained call.
    uniqueIndex('idx_webhook_outbox_idempotent')
      .on(table.tenantId, table.eventType, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ]
);

export const webhookOutboxRelations = relations(webhookOutbox, ({ one }) => ({
  tenant: one(tenants, {
    fields: [webhookOutbox.tenantId],
    references: [tenants.id],
  }),
  operationEvent: one(operationEvents, {
    fields: [webhookOutbox.operationEventId],
    references: [operationEvents.id],
  }),
}));

export type WebhookOutboxRow = typeof webhookOutbox.$inferSelect;
export type NewWebhookOutboxRow = typeof webhookOutbox.$inferInsert;

// ============================================================================
// ENG-089 — customer ledger (Phase 5 extension promoted to active backlog).
//
// Captures the running receivable balance for a customer as signed
// deltas. `sale` rows credit the balance when a sale closes with the
// `credit` payment method (ENG-090); `payment` rows debit it when the
// customer abona; `adjustment` covers manual reconciliations.
// Current balance = SUM(amount) WHERE customer_id = X (no denorm column
// to avoid dual-write drift).
// ============================================================================

export const customerLedgerKindEnum = ['sale', 'payment', 'adjustment'] as const;
export type CustomerLedgerKind = (typeof customerLedgerKindEnum)[number];

export const customerLedgerEntries = sqliteTable(
  'customer_ledger_entries',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    customerId: text('customer_id').notNull().references(() => customers.id),
    occurredAt: text('occurred_at').notNull().default(sqliteNow),
    kind: text('kind', { enum: customerLedgerKindEnum }).notNull(),
    amount: real('amount').notNull(),
    referenceSaleId: text('reference_sale_id').references(() => sales.id),
    note: text('note'),
    createdBy: text('created_by').references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    index('idx_customer_ledger_tenant_customer_occurred').on(
      table.tenantId,
      table.customerId,
      table.occurredAt
    ),
    index('idx_customer_ledger_tenant_kind').on(table.tenantId, table.kind),
  ]
);

export const customerLedgerEntriesRelations = relations(customerLedgerEntries, ({ one }) => ({
  tenant: one(tenants, { fields: [customerLedgerEntries.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [customerLedgerEntries.customerId], references: [customers.id] }),
  sale: one(sales, { fields: [customerLedgerEntries.referenceSaleId], references: [sales.id] }),
}));

export type CustomerLedgerEntryRow = typeof customerLedgerEntries.$inferSelect;
export type NewCustomerLedgerEntryRow = typeof customerLedgerEntries.$inferInsert;

// ============================================================================
// ENG-091 — delivery orders (Phase 5 extension promoted to active backlog).
//
// Per-site delivery queue. Status flows linearly accepted → preparing →
// dispatched → delivered, with cancelled reachable from any state.
// Courier (domiciliario) is free-text today; a couriers catalog is a
// follow-up.
// ============================================================================

export const deliveryOrderStatusEnum = [
  'accepted',
  'preparing',
  'dispatched',
  'delivered',
  'cancelled',
] as const;
export type DeliveryOrderStatus = (typeof deliveryOrderStatusEnum)[number];

export const deliveryOrders = sqliteTable(
  'delivery_orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    siteId: text('site_id').notNull().references(() => sites.id),
    customerId: text('customer_id').references(() => customers.id),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone'),
    address: text('address').notNull(),
    addressNotes: text('address_notes'),
    courierName: text('courier_name'),
    status: text('status', { enum: deliveryOrderStatusEnum }).notNull().default('accepted'),
    totalAmount: real('total_amount').notNull().default(0),
    itemsSnapshot: text('items_snapshot'),
    saleId: text('sale_id').references(() => sales.id),
    acceptedAt: text('accepted_at').notNull().default(sqliteNow),
    preparingAt: text('preparing_at'),
    dispatchedAt: text('dispatched_at'),
    deliveredAt: text('delivered_at'),
    cancelledAt: text('cancelled_at'),
    createdAt: text('created_at').notNull().default(sqliteNow),
    updatedAt: text('updated_at').notNull().default(sqliteNow),
  },
  table => [
    index('idx_delivery_orders_tenant_site_status').on(
      table.tenantId,
      table.siteId,
      table.status
    ),
    index('idx_delivery_orders_tenant_accepted').on(table.tenantId, table.acceptedAt),
  ]
);

export const deliveryOrdersRelations = relations(deliveryOrders, ({ one }) => ({
  tenant: one(tenants, { fields: [deliveryOrders.tenantId], references: [tenants.id] }),
  site: one(sites, { fields: [deliveryOrders.siteId], references: [sites.id] }),
  customer: one(customers, { fields: [deliveryOrders.customerId], references: [customers.id] }),
  sale: one(sales, { fields: [deliveryOrders.saleId], references: [sales.id] }),
}));

export type DeliveryOrderRow = typeof deliveryOrders.$inferSelect;
export type NewDeliveryOrderRow = typeof deliveryOrders.$inferInsert;

// ============================================================================
// ENG-092 — whats-new entries + acknowledgements.
//
// Per-release announcement records. AuthProvider checks for unread
// entries against the current user on login; the Overlay primitive
// surfaces the most recent unseen one, and clicking "Lo vi" writes a
// row to `whats_new_acks` so the same release is not repeated for
// that user.
// ============================================================================

export const whatsNewEntries = sqliteTable(
  'whats_new_entries',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id),
    version: text('version').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    publishedAt: text('published_at').notNull().default(sqliteNow),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    index('idx_whats_new_entries_tenant_published').on(table.tenantId, table.publishedAt),
  ]
);

export const whatsNewAcks = sqliteTable(
  'whats_new_acks',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id').notNull().references(() => whatsNewEntries.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    acknowledgedAt: text('acknowledged_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_whats_new_acks_unique').on(table.entryId, table.userId),
  ]
);

export type WhatsNewEntryRow = typeof whatsNewEntries.$inferSelect;
export type NewWhatsNewEntryRow = typeof whatsNewEntries.$inferInsert;
export type WhatsNewAckRow = typeof whatsNewAcks.$inferSelect;
export type NewWhatsNewAckRow = typeof whatsNewAcks.$inferInsert;
