/**
 * Drizzle schema — quotationsAudit domain.
 *
 * relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/quotationsAudit
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
  quotationStatusEnum,
  sqliteNow,
  syncStatusEnum,
  taxKindEnum,
} from './base.js';
import { sites, tenants, users } from './auth.js';
import { products } from './products.js';
import { customers } from './customers.js';
import { units } from './catalogs.js';
import { sales } from './sales.js';
import { currencyCatalog } from './config.js';

// ============================================================================
// QUOTATIONS (pre-sale documents)
// ============================================================================

/**
 * A quotation is a non-binding pre-sale document captured for a customer.
 * It carries a list of line items, totals, a validity window, and a status
 * that drives the quote-to-sale workflow. Inventory is NOT decremented when
 * a quotation is created — only when it is converted into a sale (deferred
 * to a later slice).
 */
export const quotations = sqliteTable(
  'quotations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    quotationNumber: text('quotation_number').notNull(),
    customerId: text('customer_id').references(() => customers.id),
    // Explicit price grid selected by the operator when the quote was
    // authored. It is a snapshot, not a live customer lookup.
    priceTier: integer('price_tier').notNull().default(1),
    status: text('status', { enum: quotationStatusEnum }).notNull().default('draft'),
    subtotal: real('subtotal').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    discountAmount: real('discount_amount').notNull().default(0),
    total: real('total').notNull().default(0),
    // mirror sales currency seam. When the quotation is
    // promoted to a sale (`quotations.convert`), these three fields
    // are copied into the new `sales` row verbatim so the customer's
    // quoted price stays denominated in the same currency.
    currencyCode: text('currency_code')
      .notNull()
      .default('COP')
      .references(() => currencyCatalog.code),
    exchangeRateAtSale: real('exchange_rate_at_sale').notNull().default(1),
    settleCurrencyCode: text('settle_currency_code').references(() => currencyCatalog.code),
    /** ISO timestamp at which the quotation expires. Optional. */
    validUntil: text('valid_until'),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    /** Timestamp + actor of the most recent status transition. */
    statusChangedAt: text('status_changed_at'),
    statusChangedBy: text('status_changed_by').references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_quotations_tenant').on(table.tenantId),
    index('idx_quotations_site').on(table.siteId),
    index('idx_quotations_customer').on(table.customerId),
    index('idx_quotations_status').on(table.status),
    index('idx_quotations_created_by').on(table.createdBy),
    uniqueIndex('idx_quotations_tenant_number').on(table.tenantId, table.quotationNumber),
    // "expiring soon" dashboard filters by tenant + status and
    // sorts/limits by valid_until.
    index('idx_quotations_tenant_status_valid_until').on(
      table.tenantId,
      table.status,
      table.validUntil
    ),
    // mirror sales: subtotal/tax/total positive, discount signed.
    ...moneyPositiveChecks('quotations_subtotal', table.subtotal),
    ...moneyPositiveChecks('quotations_tax', table.taxAmount),
    ...moneyPositiveChecks('quotations_total', table.total),
    moneyTwoDecimalCheck('quotations_discount', table.discountAmount),
    // exchange rate must be strictly positive.
    check('chk_quotations_exchange_rate_positive', sql`${table.exchangeRateAtSale} > 0`),
  ]
);

export const quotationItems = sqliteTable(
  'quotation_items',
  {
    id: text('id').primaryKey(),
    quotationId: text('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    // New quotations freeze the exact base-unit assignment used by the
    // authoring surface. Nullable only for historical rows whose unit cannot
    // be proven during migration; those rows fail closed at conversion.
    unitId: text('unit_id').references(() => units.id),
    unitEquivalence: real('unit_equivalence'),
    quantity: real('quantity').notNull().default(1),
    unitPrice: real('unit_price').notNull().default(0),
    discount: real('discount').notNull().default(0),
    taxRate: real('tax_rate').notNull().default(0),
    // Frozen with the quotation line so a later product/rate edit cannot
    // silently reclassify an accepted quote from IVA to INC or vice versa.
    taxKind: text('tax_kind', { enum: taxKindEnum }).notNull().default('iva'),
    taxAmount: real('tax_amount').notNull().default(0),
    total: real('total').notNull().default(0),
    // line-level mirror of sale_items currency seam.
    currencyCode: text('currency_code')
      .notNull()
      .default('COP')
      .references(() => currencyCatalog.code),
    exchangeRateAtSale: real('exchange_rate_at_sale').notNull().default(1),
    settleCurrencyCode: text('settle_currency_code').references(() => currencyCatalog.code),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_quotation_items_quotation').on(table.quotationId),
    index('idx_quotation_items_product').on(table.productId),
    index('idx_quotation_items_unit').on(table.unitId),
    // line-level mirror of sale_items.
    ...moneyPositiveChecks('quotation_items_unit_price', table.unitPrice),
    ...moneyPositiveChecks('quotation_items_tax', table.taxAmount),
    ...moneyPositiveChecks('quotation_items_total', table.total),
    moneyTwoDecimalCheck('quotation_items_discount', table.discount),
    // exchange rate must be strictly positive (mirror sales).
    check('chk_quotation_items_exchange_rate_positive', sql`${table.exchangeRateAtSale} > 0`),
  ]
);

export const quotationsRelations = relations(quotations, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [quotations.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [quotations.siteId],
    references: [sites.id],
  }),
  customer: one(customers, {
    fields: [quotations.customerId],
    references: [customers.id],
  }),
  createdByUser: one(users, {
    fields: [quotations.createdBy],
    references: [users.id],
  }),
  statusChangedByUser: one(users, {
    fields: [quotations.statusChangedBy],
    references: [users.id],
  }),
  items: many(quotationItems),
}));

export const quotationItemsRelations = relations(quotationItems, ({ one }) => ({
  quotation: one(quotations, {
    fields: [quotationItems.quotationId],
    references: [quotations.id],
  }),
  product: one(products, {
    fields: [quotationItems.productId],
    references: [products.id],
  }),
  unit: one(units, {
    fields: [quotationItems.unitId],
    references: [units.id],
  }),
}));

/**
 * Immutable authoritative bridge between one accepted quotation and the one
 * sale created from it. Both sides are unique so retries or two registers can
 * never convert the same quote twice or attach one sale to multiple quotes.
 */
export const quotationSaleLinks = sqliteTable(
  'quotation_sale_links',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    quotationId: text('quotation_id')
      .notNull()
      .references(() => quotations.id),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id),
    convertedBy: text('converted_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_quotation_sale_links_tenant').on(table.tenantId),
    uniqueIndex('idx_quotation_sale_links_quotation').on(table.quotationId),
    uniqueIndex('idx_quotation_sale_links_sale').on(table.saleId),
  ]
);

export const quotationSaleLinksRelations = relations(quotationSaleLinks, ({ one }) => ({
  tenant: one(tenants, {
    fields: [quotationSaleLinks.tenantId],
    references: [tenants.id],
  }),
  quotation: one(quotations, {
    fields: [quotationSaleLinks.quotationId],
    references: [quotations.id],
  }),
  sale: one(sales, {
    fields: [quotationSaleLinks.saleId],
    references: [sales.id],
  }),
  convertedByUser: one(users, {
    fields: [quotationSaleLinks.convertedBy],
    references: [users.id],
  }),
}));

// ============================================================================
// AUDIT LOGS (sensitive-action traceability)
// ============================================================================

/**
 * A single immutable row per auditable operation. `before` / `after` capture
 * a relevant JSON snapshot of the affected resource so the viewer can render
 * a diff without re-joining upstream tables (those rows may have been
 * deleted — e.g. deleted quotations).
 *
 * `metadata` is a free-form bag for per-action details that don't fit the
 * before/after model (e.g. a void reason string, a discrepancy note).
 */
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    before: text('before', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    after: text('after', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    /**
     * Foundation Reset wave. Carries the `operationId` from the
     * Command Envelope (ADR-0002) when the audit row was emitted under a
     * critical mutation. Nullable because (a) audit rows pre-dating
     * have no operation id, and (b) future flows may emit audit rows
     * outside the envelope-decorated procedures.  backfills the
     * column for journaled operations.
     */
    operationId: text('operation_id'),
    // append-only hash chain. Every row written through
    // writeAuditLog carries:
    // - contentHash: SHA-256 of the row's canonical payload. Survives
    //   the privacy disposal that nulls before/after/metadata, so a
    //   legally redacted row stays verifiable without its content.
    // - prevHash: the chain head at write time ('genesis' for the
    //   tenant's first chained row).
    // - chainHash: SHA-256(prevHash + contentHash) - the link.
    // Nullable: rows from before the chain shipped are legacy and the
    // verifier reports them as unchained rather than broken.
    contentHash: text('content_hash'),
    prevHash: text('prev_hash'),
    chainHash: text('chain_hash'),
    // set when a privacy disposal scrubbed before/after/
    // metadata. The verifier skips the content-digest check for these
    // rows; the CHAIN check still applies.
    redactedAt: text('redacted_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    index('idx_audit_logs_tenant').on(table.tenantId),
    index('idx_audit_logs_actor').on(table.actorId),
    index('idx_audit_logs_action').on(table.action),
    index('idx_audit_logs_resource').on(table.resourceType, table.resourceId),
    index('idx_audit_logs_created_at').on(table.createdAt),
    index('idx_audit_logs_operation_id').on(table.operationId),
    // listing query filters by tenant + a createdAt range.
    index('idx_audit_logs_tenant_created').on(table.tenantId, table.createdAt),
    // listing query optionally narrows by action.
    index('idx_audit_logs_tenant_action_created').on(table.tenantId, table.action, table.createdAt),
    // the verifier resolves prev-hash links by chain hash.
    index('idx_audit_logs_chain_hash').on(table.chainHash),
  ]
);

/**
 * One chain head per tenant. writeAuditLog reads and
 * advances it inside the caller's transaction, so SQLite's single
 * writer serializes the chain without an explicit sequence column.
 *
 * head_mac anchors the head outside the database's own trust
 * domain: HMAC-SHA256 of (tenantId, anchorCounter, headHash) under a key that lives
 * in the OS keychain envelope (desktop) or an env secret
 * (standalone), never inside this DB. An adversary who can rewrite
 * every row and recompute the whole sha256 chain still cannot forge
 * the anchor without that key. Nullable: heads written before the
 * anchor key existed carry no MAC and are reported as unanchored.
 */
export const auditChainHeads = sqliteTable('audit_chain_heads', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  headHash: text('head_hash').notNull(),
  headMac: text('head_mac'),
  /** Monotonic freshness value included in the external anchor and head MAC. */
  anchorCounter: integer('anchor_counter').notNull().default(0),
  /** CAS token for fail-closed head advancement across shared-DB writers. */
  version: integer('version').notNull().default(0),
  /** Rows created on/after adoption must carry chain columns. */
  adoptedAt: text('adopted_at').notNull().default('1970-01-01T00:00:00.000Z'),
  updatedAt: text('updated_at').notNull(),
});

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  tenant: one(tenants, {
    fields: [auditLogs.tenantId],
    references: [tenants.id],
  }),
  actor: one(users, {
    fields: [auditLogs.actorId],
    references: [users.id],
  }),
}));
