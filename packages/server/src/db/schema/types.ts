/**
 * Drizzle schema — types domain.
 *
 * relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/types
 */
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import {
  moneyPositiveChecks,
  moneyTwoDecimalCheck,
  nowIso,
  sqliteNow,
  syncStatusEnum,
} from './base.js';
import { companies, logos, sites, tenants, users } from './auth.js';
import {
  categories,
  cities,
  countries,
  departments,
  providers,
  sequentials,
  units,
  vatRates,
} from './catalogs.js';
import { categoryXProvider, productXProvider, products, unitXProduct } from './products.js';
import { commercialActivities, customers } from './customers.js';
import {
  invoiceUploads,
  orderItems,
  orders,
  purchaseItems,
  purchaseReturnItems,
  purchaseReturns,
  purchases,
} from './purchasing.js';
import { sales } from './sales.js';
import {
  paymentOutbox,
  productSerials,
  productSerialTransfers,
  saleItemSerials,
  saleItems,
  salePayments,
  saleReturns,
} from './salesAux.js';
import {
  initialInventory,
  inventoryBalances,
  inventoryMovements,
  transferOrderItems,
  transferOrderStatusEnum,
  transferOrders,
} from './inventory.js';
import { auditLogs, quotationItems, quotations } from './quotationsAudit.js';
import { devices, idempotencyKeys, operationEvents } from './devices.js';
import {
  appSettings,
  countryCatalog,
  currencyCatalog,
  receiptTemplates,
  syncConflicts,
  tenantLocaleSettings,
} from './config.js';

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

export type ProductSerial = typeof productSerials.$inferSelect;
export type NewProductSerial = typeof productSerials.$inferInsert;
export type ProductSerialTransfer = typeof productSerialTransfers.$inferSelect;
export type NewProductSerialTransfer = typeof productSerialTransfers.$inferInsert;
export type SaleItemSerial = typeof saleItemSerials.$inferSelect;
export type NewSaleItemSerial = typeof saleItemSerials.$inferInsert;

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
// FISCAL CAFS (Pack Chile DTE 1.0 — Códigos de Autorización
// de Folios). The SII issues a signed XML CAF that authorizes a tenant
// to emit a TipoDTE in a folio range; this table stores the per-tenant
// metadata + raw CAF XML so the allocator can advance the folio cursor
// atomically with the fiscal_documents insert. Mexico's CFDI 4.0 model
// has no equivalent.  adds the upload UI + RSA signature parse.
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
     * for the curated set  shipped.
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
    /** Raw CAF XML preserved for  TED RSA signing. */
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
// WEBHOOK OUTBOX (public events foundation, 5th outbox per
// ADR-0003). The operation-journal projector + the fiscal worker
// emit rows here when a public event is published. The HTTP delivery
// worker that drains them lands in .
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
    /** Schema version of the payload —  v1 ships version 1. */
    eventVersion: integer('event_version').notNull().default(1),
    /**
     * Soft-FK to the `operation_events` row that triggered this
     * webhook event. Nullable because the `fiscal_document.accepted`
     * branch fires from the fiscal worker and may not carry an
     * operation_id (the accept happens out-of-band of the original
     * sale's command envelope).
     */
    operationEventId: text('operation_event_id').references(() => operationEvents.id, {
      onDelete: 'set null',
    }),
    /** Public-contract payload (validated by the manifest's Zod schema before insert). */
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    status: text('status', { enum: webhookOutboxStatusEnum }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    /** Normalized error written by the kernel on `fail`. */
    lastError: text('last_error', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    priority: real('priority').notNull().default(0),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    /**
     * Envelope-keyed idempotency. Mirrors 's
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

export const webhookSubscriptions = sqliteTable(
  'webhook_subscriptions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    destinationUrl: text('destination_url').notNull(),
    eventTypes: text('event_types', { mode: 'json' }).$type<string[]>().notNull(),
    /** AES-256-GCM envelope. The plaintext signing secret is never returned after create. */
    sealedSecret: text('sealed_secret'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    revokedAt: text('revoked_at'),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  table => [
    index('idx_webhook_subscriptions_tenant_enabled').on(table.tenantId, table.enabled),
    uniqueIndex('idx_webhook_subscriptions_tenant_url_active')
      .on(table.tenantId, table.destinationUrl)
      .where(sql`${table.revokedAt} IS NULL`),
  ]
);

export const webhookDeliveryStatusEnum = [
  'pending',
  'delivered',
  'retrying',
  'dead_letter',
] as const;
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatusEnum)[number];

export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    outboxId: text('outbox_id')
      .notNull()
      .references(() => webhookOutbox.id, { onDelete: 'cascade' }),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
    status: text('status', { enum: webhookDeliveryStatusEnum }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    lastErrorCode: text('last_error_code'),
    lastAttemptAt: text('last_attempt_at'),
    deliveredAt: text('delivered_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  table => [
    uniqueIndex('idx_webhook_deliveries_outbox_subscription').on(
      table.outboxId,
      table.subscriptionId
    ),
    index('idx_webhook_deliveries_tenant_status').on(table.tenantId, table.status),
  ]
);

export type WebhookSubscriptionRow = typeof webhookSubscriptions.$inferSelect;
export type NewWebhookSubscriptionRow = typeof webhookSubscriptions.$inferInsert;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDeliveryRow = typeof webhookDeliveries.$inferInsert;

// ============================================================================
// customer ledger (extension promoted to active backlog).
//
// Captures the running receivable balance for a customer as signed
// deltas. `sale` rows credit the balance when a sale closes with the
// `credit` payment method (); `payment` rows debit it when the
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
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
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
  customer: one(customers, {
    fields: [customerLedgerEntries.customerId],
    references: [customers.id],
  }),
  sale: one(sales, { fields: [customerLedgerEntries.referenceSaleId], references: [sales.id] }),
}));

export type CustomerLedgerEntryRow = typeof customerLedgerEntries.$inferSelect;
export type NewCustomerLedgerEntryRow = typeof customerLedgerEntries.$inferInsert;

// ============================================================================
// CUSTOMER STORE CREDIT
// ============================================================================

/** One materialized balance per tenant/customer/currency, backed by an immutable ledger. */
export const storeCreditAccounts = sqliteTable(
  'store_credit_accounts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    currencyCode: text('currency_code')
      .notNull()
      .default('COP')
      .references(() => currencyCatalog.code),
    balance: real('balance').notNull().default(0),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_store_credit_accounts_tenant_customer').on(table.tenantId, table.customerId),
    uniqueIndex('idx_store_credit_accounts_currency').on(
      table.tenantId,
      table.customerId,
      table.currencyCode
    ),
    ...moneyPositiveChecks('store_credit_accounts_balance', table.balance),
  ]
);

export const storeCreditMovementKindEnum = ['issue', 'redeem', 'adjust', 'revert'] as const;

export const storeCreditMovements = sqliteTable(
  'store_credit_movements',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    accountId: text('account_id')
      .notNull()
      .references(() => storeCreditAccounts.id, { onDelete: 'restrict' }),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    saleReturnId: text('sale_return_id').references(() => saleReturns.id, { onDelete: 'restrict' }),
    saleId: text('sale_id').references(() => sales.id, { onDelete: 'restrict' }),
    /** Tender that consumed the balance. Logical reference avoids a schema
     * cycle with salesAux while unique indexes enforce one debit per tender. */
    salePaymentId: text('sale_payment_id'),
    /** Original redeem movement restored by a return/void. */
    sourceMovementId: text('source_movement_id'),
    kind: text('kind', { enum: storeCreditMovementKindEnum }).notNull(),
    /** Signed delta: issues/restorations are positive; redemptions are negative. */
    amount: real('amount').notNull(),
    balanceAfter: real('balance_after').notNull(),
    currencyCode: text('currency_code')
      .notNull()
      .default('COP')
      .references(() => currencyCatalog.code),
    note: text('note'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_store_credit_movements_tenant_account').on(table.tenantId, table.accountId),
    index('idx_store_credit_movements_customer').on(table.customerId),
    uniqueIndex('idx_store_credit_movements_return_issue')
      .on(table.tenantId, table.saleReturnId)
      .where(sql`${table.kind} = 'issue' and ${table.saleReturnId} is not null`),
    uniqueIndex('idx_store_credit_movements_payment_redeem')
      .on(table.tenantId, table.salePaymentId)
      .where(sql`${table.kind} = 'redeem' and ${table.salePaymentId} is not null`),
    uniqueIndex('idx_store_credit_movements_return_source')
      .on(table.tenantId, table.saleReturnId, table.sourceMovementId, table.kind)
      .where(sql`${table.saleReturnId} is not null and ${table.sourceMovementId} is not null`),
    uniqueIndex('idx_store_credit_movements_void_source')
      .on(table.tenantId, table.saleId, table.sourceMovementId, table.kind)
      .where(sql`${table.saleReturnId} is null and ${table.sourceMovementId} is not null`),
    check(
      'chk_store_credit_movements_sign',
      sql`(${table.kind} IN ('issue', 'revert') AND ${table.amount} > 0) OR (${table.kind} = 'redeem' AND ${table.amount} < 0) OR (${table.kind} = 'adjust' AND ${table.amount} <> 0)`
    ),
    moneyTwoDecimalCheck('store_credit_movements_amount', table.amount),
    ...moneyPositiveChecks('store_credit_movements_balance', table.balanceAfter),
  ]
);

export const storeCreditAccountsRelations = relations(storeCreditAccounts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [storeCreditAccounts.tenantId], references: [tenants.id] }),
  customer: one(customers, {
    fields: [storeCreditAccounts.customerId],
    references: [customers.id],
  }),
  movements: many(storeCreditMovements),
}));

export const storeCreditMovementsRelations = relations(storeCreditMovements, ({ one }) => ({
  account: one(storeCreditAccounts, {
    fields: [storeCreditMovements.accountId],
    references: [storeCreditAccounts.id],
  }),
  customer: one(customers, {
    fields: [storeCreditMovements.customerId],
    references: [customers.id],
  }),
  saleReturn: one(saleReturns, {
    fields: [storeCreditMovements.saleReturnId],
    references: [saleReturns.id],
  }),
  sale: one(sales, { fields: [storeCreditMovements.saleId], references: [sales.id] }),
  createdByUser: one(users, {
    fields: [storeCreditMovements.createdBy],
    references: [users.id],
  }),
}));

export type StoreCreditAccount = typeof storeCreditAccounts.$inferSelect;
export type NewStoreCreditAccount = typeof storeCreditAccounts.$inferInsert;
export type StoreCreditMovement = typeof storeCreditMovements.$inferSelect;
export type NewStoreCreditMovement = typeof storeCreditMovements.$inferInsert;

// ============================================================================
// delivery orders (extension promoted to active backlog).
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
/** Fulfillment states; delivered and cancelled are terminal, independently of payment. */
export type DeliveryOrderStatus = (typeof deliveryOrderStatusEnum)[number];

export const deliveryOrders = sqliteTable(
  'delivery_orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    customerId: text('customer_id').references(() => customers.id),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone'),
    address: text('address').notNull(),
    addressNotes: text('address_notes'),
    courierName: text('courier_name'),
    status: text('status', { enum: deliveryOrderStatusEnum }).notNull().default('accepted'),
    // Null provenance/currency remain readable for historical queues; no invented backfill.
    source: text('source', { enum: ['legacy', 'manual', 'sale'] })
      .notNull()
      .default('legacy'),
    currencyCode: text('currency_code'),
    version: integer('version').notNull().default(1),
    cancellationReason: text('cancellation_reason'),
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
    index('idx_delivery_orders_tenant_site_status').on(table.tenantId, table.siteId, table.status),
    index('idx_delivery_orders_tenant_accepted').on(table.tenantId, table.acceptedAt),
    index('idx_delivery_orders_queue_cursor').on(
      table.tenantId,
      table.siteId,
      table.status,
      table.acceptedAt,
      table.id
    ),
    index('idx_delivery_orders_sale').on(table.tenantId, table.saleId),
    check('chk_delivery_orders_version', sql`${table.version} >= 1`),
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
// whats-new entries + acknowledgements.
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
  table => [index('idx_whats_new_entries_tenant_published').on(table.tenantId, table.publishedAt)]
);

export const whatsNewAcks = sqliteTable(
  'whats_new_acks',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id')
      .notNull()
      .references(() => whatsNewEntries.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    acknowledgedAt: text('acknowledged_at').notNull().default(sqliteNow),
  },
  table => [uniqueIndex('idx_whats_new_acks_unique').on(table.entryId, table.userId)]
);

export type WhatsNewEntryRow = typeof whatsNewEntries.$inferSelect;
export type NewWhatsNewEntryRow = typeof whatsNewEntries.$inferInsert;
export type WhatsNewAckRow = typeof whatsNewAcks.$inferSelect;
export type NewWhatsNewAckRow = typeof whatsNewAcks.$inferInsert;
