/**
 * Drizzle schema — salesAux domain.
 *
 * ENG-178 — relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/salesAux
 */
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { moneyPositiveChecks, moneyTwoDecimalCheck, nowIso, paymentMethodEnum, productSerialStatusEnum, sqliteNow, syncStatusEnum } from './base.js';
import { sites, tenants, users } from './auth.js';
import { units } from './catalogs.js';
import { products } from './products.js';
import { sales } from './sales.js';
import { inventoryLots } from './inventory.js';
import { currencyCatalog } from './config.js';

// ============================================================================
// SALE ITEMS
// ============================================================================

export const saleItems = sqliteTable(
  'sale_items',
  {
    id: text('id').primaryKey(),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: real('quantity').notNull().default(1),
    unitPrice: real('unit_price').notNull().default(0),
    unitId: text('unit_id').references(() => units.id),
    unitEquivalence: real('unit_equivalence').notNull().default(1),
    discount: real('discount').notNull().default(0),
    taxRate: real('tax_rate').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    costAtSale: real('cost_at_sale').notNull().default(0),
    total: real('total').notNull().default(0),
    // ENG-176b — line-level currency seam. By contract these three
    // columns mirror the parent `sales.currency_code` /
    // `exchange_rate_at_sale` / `settle_currency_code`. The redundant
    // storage avoids a join on every line render and keeps the
    // invariant CHECK-able on this row alone (cross-table CHECKs are
    // not supported in SQLite). `completeSale` propagates the header
    // value to every item; a future multi-currency feature can
    // refine.
    currencyCode: text('currency_code')
      .notNull()
      .default('COP')
      .references(() => currencyCatalog.code),
    exchangeRateAtSale: real('exchange_rate_at_sale').notNull().default(1),
    settleCurrencyCode: text('settle_currency_code').references(
      () => currencyCatalog.code
    ),
    // ENG-039d2 — per-line free-form modifier note ("sin cebolla",
    // "extra queso", etc.). Captured at sale creation time by the
    // voice-ordering surface and snapshotted into the KDS card so
    // the cook sees the modifier inline with each product instead
    // of aggregated at the bottom of the ticket. Nullable so retail
    // tenants and pre-ENG-039d2 sales pass through unchanged.
    notes: text('notes'),
  },
  table => [
    index('idx_sale_items_sale').on(table.saleId),
    index('idx_sale_items_product').on(table.productId),
    // ENG-176a — line totals, prices, tax, and snapshot cost are always
    // positive; discount is signed (per-line discount represented as a
    // negative delta in some legacy fixtures, positive in newer flows —
    // both shapes round-trip safely with only the precision invariant).
    ...moneyPositiveChecks('sale_items_unit_price', table.unitPrice),
    ...moneyPositiveChecks('sale_items_tax', table.taxAmount),
    ...moneyPositiveChecks('sale_items_cost', table.costAtSale),
    ...moneyPositiveChecks('sale_items_total', table.total),
    moneyTwoDecimalCheck('sale_items_discount', table.discount),
    // ENG-176b — exchange rate must be strictly positive (mirror sales).
    check(
      'chk_sale_items_exchange_rate_positive',
      sql`${table.exchangeRateAtSale} > 0`
    ),
  ]
);

export const saleItemsRelations = relations(saleItems, ({ one }) => ({
  sale: one(sales, {
    fields: [saleItems.saleId],
    references: [sales.id],
  }),
  product: one(products, {
    fields: [saleItems.productId],
    references: [products.id],
  }),
  unit: one(units, {
    fields: [saleItems.unitId],
    references: [units.id],
  }),
}));

// ============================================================================
// SALE ITEM LOTS (Auditoría 2026-07 — lot consumption provenance & COGS)
// ============================================================================

/**
 * One row per (sale line, lot) that a lot-tracked sale line consumed. It is
 * the auditable COGS ledger — `quantity` base units drawn from `lotId` at
 * `unitCost` — and the exact record a reversal (return / void / discard)
 * reads to restore the right lots. Written only when the product has
 * `tracks_lots = true`; non-lot sales never touch this table.
 */
export const saleItemLots = sqliteTable(
  'sale_item_lots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleItemId: text('sale_item_id')
      .notNull()
      .references(() => saleItems.id, { onDelete: 'cascade' }),
    lotId: text('lot_id')
      .notNull()
      .references(() => inventoryLots.id),
    /** Base units drawn from this lot for the line. */
    quantity: real('quantity').notNull(),
    /** The lot's unit cost at consumption — the COGS layer snapshot. */
    unitCost: real('unit_cost').notNull().default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sale_item_lots_tenant').on(table.tenantId),
    index('idx_sale_item_lots_sale_item').on(table.saleItemId),
    index('idx_sale_item_lots_lot').on(table.lotId),
    ...moneyPositiveChecks('sale_item_lots_unit_cost', table.unitCost),
  ]
);

export const saleItemLotsRelations = relations(saleItemLots, ({ one }) => ({
  tenant: one(tenants, {
    fields: [saleItemLots.tenantId],
    references: [tenants.id],
  }),
  saleItem: one(saleItems, {
    fields: [saleItemLots.saleItemId],
    references: [saleItems.id],
  }),
  lot: one(inventoryLots, {
    fields: [saleItemLots.lotId],
    references: [inventoryLots.id],
  }),
}));

// ============================================================================
// PRODUCT SERIALS (ENG-110c — per-unit inventory and sale provenance)
// ============================================================================

/**
 * One row per physical serialized unit. Quantities never live here: each row
 * represents exactly one base unit. `saleItemId` points at the draft or sale
 * line currently reserving/selling the unit. Historical ownership lives in
 * `sale_item_serials`, so clearing this current pointer on a reversal never
 * destroys warranty provenance.
 */
export const productSerials = sqliteTable(
  'product_serials',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    currentSiteId: text('current_site_id')
      .notNull()
      .references(() => sites.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    serialNumber: text('serial_number').notNull(),
    status: text('status', { enum: productSerialStatusEnum }).notNull().default('in_stock'),
    saleItemId: text('sale_item_id').references(() => saleItems.id, { onDelete: 'set null' }),
    unitCost: real('unit_cost').notNull().default(0),
    warrantyExpiresAt: text('warranty_expires_at'),
    receivedAt: text('received_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    soldAt: text('sold_at'),
    returnedAt: text('returned_at'),
    notes: text('notes'),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_product_serials_tenant_product').on(table.tenantId, table.productId),
    index('idx_product_serials_tenant_site_status').on(
      table.tenantId,
      table.currentSiteId,
      table.status
    ),
    index('idx_product_serials_sale_item').on(table.saleItemId),
    uniqueIndex('idx_product_serials_tenant_product_number').on(
      table.tenantId,
      table.productId,
      table.serialNumber
    ),
    ...moneyPositiveChecks('product_serials_unit_cost', table.unitCost),
  ]
);

export const productSerialsRelations = relations(productSerials, ({ one }) => ({
  tenant: one(tenants, {
    fields: [productSerials.tenantId],
    references: [tenants.id],
  }),
  currentSite: one(sites, {
    fields: [productSerials.currentSiteId],
    references: [sites.id],
  }),
  product: one(products, {
    fields: [productSerials.productId],
    references: [products.id],
  }),
  saleItem: one(saleItems, {
    fields: [productSerials.saleItemId],
    references: [saleItems.id],
  }),
}));

// ============================================================================
// SALE ITEM SERIALS (ENG-110c — immutable serialized-sale provenance)
// ============================================================================

/**
 * Immutable bridge between a physical serial and every sale line that ever
 * owned it. A returned unit may later be sold again, so productSerialId is
 * deliberately not globally unique; the pair is unique only within a line.
 * `serialNumber` is a snapshot so receipts and warranty reads remain legible
 * even if a future repair workflow corrects the registry value.
 */
export const saleItemSerials = sqliteTable(
  'sale_item_serials',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleItemId: text('sale_item_id')
      .notNull()
      .references(() => saleItems.id, { onDelete: 'cascade' }),
    productSerialId: text('product_serial_id')
      .notNull()
      .references(() => productSerials.id, { onDelete: 'restrict' }),
    serialNumber: text('serial_number').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sale_item_serials_tenant').on(table.tenantId),
    index('idx_sale_item_serials_sale_item').on(table.saleItemId),
    index('idx_sale_item_serials_product_serial').on(table.productSerialId),
    uniqueIndex('idx_sale_item_serials_line_serial').on(
      table.tenantId,
      table.saleItemId,
      table.productSerialId
    ),
  ]
);

export const saleItemSerialsRelations = relations(saleItemSerials, ({ one }) => ({
  tenant: one(tenants, {
    fields: [saleItemSerials.tenantId],
    references: [tenants.id],
  }),
  saleItem: one(saleItems, {
    fields: [saleItemSerials.saleItemId],
    references: [saleItems.id],
  }),
  productSerial: one(productSerials, {
    fields: [saleItemSerials.productSerialId],
    references: [productSerials.id],
  }),
}));

// ============================================================================
// SALE PAYMENTS (Phase 2 Tier-2 step 5 — multi-tender / split payments)
// ============================================================================

/**
 * A sale payment records one tender applied to a sale. A single-tender sale
 * has exactly one row here (legacy flow is normalized into the table on
 * `sales.create`). Split-payment sales have multiple rows whose `amount` sums
 * to the sale's `total`. The `method` enum is the same as `sales.paymentMethod`
 * so classic reports keep working against either surface.
 */
export const salePayments = sqliteTable(
  'sale_payments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    method: text('method', { enum: paymentMethodEnum }).notNull(),
    amount: real('amount').notNull(),
    /**
     * Optional free-form reference (e.g. card authorization code, transfer
     * receipt number). Not a FK — it's purely descriptive audit context.
     */
    reference: text('reference'),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sale_payments_tenant').on(table.tenantId),
    index('idx_sale_payments_sale').on(table.saleId),
    index('idx_sale_payments_method').on(table.method),
    // ENG-176a-rounding — sale_payments.amount is intentionally
    // signed (reverse-payment + split-refund flows). Only precision
    // enforced; application rounds via roundMoney() before writing.
    moneyTwoDecimalCheck('sale_payments_amount', table.amount),
  ]
);

export const salePaymentsRelations = relations(salePayments, ({ one }) => ({
  tenant: one(tenants, {
    fields: [salePayments.tenantId],
    references: [tenants.id],
  }),
  sale: one(sales, {
    fields: [salePayments.saleId],
    references: [sales.id],
  }),
}));

// ============================================================================
// PAYMENT OUTBOX (ENG-038 — LATAM payment rails foundation)
// ============================================================================

/**
 * Closed list of payment rails Puntovivo models in ENG-038. Real
 * provider credentials and terminal SDK handshakes remain follow-up
 * work; this enum locks the public rail ids used by the outbox,
 * registry and Operations Center reconciliation tab.
 */
export const paymentRailIdEnum = [
  'wompi',
  'bold',
  'epayco',
  'mercado_pago',
  'nequi',
  'daviplata',
] as const;
export type PaymentRailId = (typeof paymentRailIdEnum)[number];

/**
 * Kernel-compatible lifecycle for provider side effects. A row starts
 * queued, the future worker moves it through submitting, and provider
 * verdicts settle into approved / declined / timeout / retrying /
 * settled / dead_letter.
 */
export const paymentOutboxStatusEnum = [
  'queued',
  'submitting',
  'approved',
  'declined',
  'timeout',
  'retrying',
  'settled',
  'dead_letter',
] as const;
export type PaymentOutboxStatus = (typeof paymentOutboxStatusEnum)[number];

export const paymentOutboxKindEnum = ['charge', 'refund', 'get_status'] as const;
export type PaymentOutboxKind = (typeof paymentOutboxKindEnum)[number];

export const paymentOutbox = sqliteTable(
  'payment_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /**
     * Optional link to the POS tender being reconciled. Nullable so
     * imported provider statements can land before the matching tender
     * is identified by the reconciliation pass.
     */
    salePaymentId: text('sale_payment_id').references(() => salePayments.id, {
      onDelete: 'set null',
    }),
    railId: text('rail_id', { enum: paymentRailIdEnum }).notNull(),
    kind: text('kind', { enum: paymentOutboxKindEnum }).notNull().default('charge'),
    status: text('status', { enum: paymentOutboxStatusEnum }).notNull().default('queued'),
    amount: real('amount').notNull(),
    currencyCode: text('currency_code').notNull().default('COP'),
    /** POS-side reference, usually sale number or tender reference. */
    reference: text('reference').notNull(),
    /** Provider transaction id / payment intent id when the rail returns one. */
    providerTransactionId: text('provider_transaction_id'),
    /** Rail-specific request/response snapshot; must never contain PAN / CVV. */
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    payloadVersion: integer('payload_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    lastError: text('last_error', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    priority: real('priority').notNull().default(0),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    /**
     * Envelope-derived idempotency key. Mirrors hardware/webhook
     * outbox semantics: duplicate rows with the same key collapse via
     * the partial unique index below; NULL keys stay independent.
     */
    idempotencyKey: text('idempotency_key'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    index('idx_payment_outbox_tenant_status_retry').on(
      table.tenantId,
      table.status,
      table.nextRetryAt
    ),
    index('idx_payment_outbox_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_payment_outbox_sale_payment').on(table.salePaymentId),
    index('idx_payment_outbox_rail_status').on(table.tenantId, table.railId, table.status),
    uniqueIndex('idx_payment_outbox_idempotent')
      .on(table.tenantId, table.railId, table.kind, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    // ENG-176b — payment_outbox.amount is always positive: both
    // `charge` and `refund` kinds store the absolute amount being
    // moved (the direction is encoded in `kind`, not the sign of
    // amount). Precision must match the rest of the money model.
    ...moneyPositiveChecks('payment_outbox_amount', table.amount),
  ]
);

export const paymentOutboxRelations = relations(paymentOutbox, ({ one }) => ({
  tenant: one(tenants, {
    fields: [paymentOutbox.tenantId],
    references: [tenants.id],
  }),
  salePayment: one(salePayments, {
    fields: [paymentOutbox.salePaymentId],
    references: [salePayments.id],
  }),
}));

export type PaymentOutboxRow = typeof paymentOutbox.$inferSelect;
export type NewPaymentOutboxRow = typeof paymentOutbox.$inferInsert;

// ============================================================================
// RESTAURANT TABLES (ENG-039b)
// ============================================================================

/**
 * ENG-039b — restaurant table catalog.
 *
 * Persistent per-site list of physical tables a waiter can pick when
 * opening an order on the voice-ordering / mobile-waiter surfaces.
 * v1 keeps `sales.suspendedLabel` as the persistence column (no
 * `sales.tableId` FK yet) — the dropdown just resolves the picked
 * row's `name` into the existing text label. ENG-039c will introduce
 * the FK + open/seat/transfer/split state machine on top.
 *
 * The partial-unique index lives in `0023_restaurant_tables.sql` as a
 * hand-appended statement; Drizzle's SQLite dialect cannot emit the
 * `WHERE is_active = 1` clause natively.
 */
export const restaurantTables = sqliteTable(
  'restaurant_tables',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    name: text('name').notNull(),
    seatCount: integer('seat_count'),
    area: text('area'),
    notes: text('notes'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    index('idx_restaurant_tables_tenant_site').on(table.tenantId, table.siteId),
    // ENG-175 — partial unique on the active name so archived (isActive=0)
    // rows free the name for re-use without colliding. The index itself
    // was first introduced by migration `0023_restaurant_tables.sql` as a
    // hand-appended `CREATE UNIQUE INDEX ... WHERE is_active = 1`;
    // ENG-175 brings the declaration into Drizzle's schema source-of-truth
    // (reusing the existing index name) so `drizzle-kit generate` does
    // not drift on future schema edits.
    uniqueIndex('idx_restaurant_tables_unique_active_name')
      .on(table.tenantId, table.siteId, table.name)
      .where(sql`${table.isActive} = 1`),
  ]
);

export const restaurantTablesRelations = relations(restaurantTables, ({ one }) => ({
  tenant: one(tenants, {
    fields: [restaurantTables.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [restaurantTables.siteId],
    references: [sites.id],
  }),
}));

export type RestaurantTableRow = typeof restaurantTables.$inferSelect;
export type NewRestaurantTableRow = typeof restaurantTables.$inferInsert;

// ============================================================================
// SALE RETURNS
// ============================================================================

/** A sale return records a refunded sale after completion, restoring stock while preserving the original sale as historical evidence. */
export const saleReturns = sqliteTable(
  'sale_returns',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    refundAmount: real('refund_amount').notNull().default(0),
    reason: text('reason'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sale_returns_tenant').on(table.tenantId),
    index('idx_sale_returns_sale').on(table.saleId),
    index('idx_sale_returns_created_by').on(table.createdBy),
    uniqueIndex('idx_sale_returns_sale_unique').on(table.saleId),
    // ENG-176a — refund amount stores the absolute value being returned.
    ...moneyPositiveChecks('sale_returns_refund', table.refundAmount),
  ]
);

export const saleReturnsRelations = relations(saleReturns, ({ one }) => ({
  tenant: one(tenants, {
    fields: [saleReturns.tenantId],
    references: [tenants.id],
  }),
  sale: one(sales, {
    fields: [saleReturns.saleId],
    references: [sales.id],
  }),
  createdByUser: one(users, {
    fields: [saleReturns.createdBy],
    references: [users.id],
  }),
}));
