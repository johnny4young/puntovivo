/**
 * Drizzle schema — salesAux domain.
 *
 * relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/salesAux
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
  paymentMethodEnum,
  productSerialStatusEnum,
  sqliteNow,
  syncStatusEnum,
  taxKindEnum,
} from './base.js';
import { sites, tenants, users } from './auth.js';
import { units, vatRates } from './catalogs.js';
import { products } from './products.js';
import { purchaseItems } from './purchasing.js';
import { sales } from './sales.js';
import { inventoryLots, transferOrderItems } from './inventory.js';
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
    // Immutable sale-time catalog labels for exact ordinary-receipt
    // reprints. Nullable for historical rows, whose renderer safely falls
    // back to the current product record.
    productNameSnapshot: text('product_name_snapshot'),
    productSkuSnapshot: text('product_sku_snapshot'),
    // Immutable sale-time inventory semantics. The reversal paths
    // (return / void / discard) must credit exactly what the forward path
    // debited, and `products.tracks_stock` can flip between the sale and
    // its reversal. Reading the live flag would silently lose stock on a
    // physical-to-service conversion and conjure phantom stock on the
    // reverse. Null for historical rows, which predate services and are
    // therefore stock-tracked.
    tracksStockSnapshot: integer('tracks_stock_snapshot', { mode: 'boolean' }),
    quantity: real('quantity').notNull().default(1),
    unitPrice: real('unit_price').notNull().default(0),
    // Frozen catalog tier grid used to judge a draft only when it is
    // finally completed. Nullable for pre-migration drafts, whose
    // completion path falls back to the live tenant-scoped assignment.
    catalogUnitPrice1: real('catalog_unit_price1'),
    catalogUnitPrice2: real('catalog_unit_price2'),
    catalogUnitPrice3: real('catalog_unit_price3'),
    unitId: text('unit_id').references(() => units.id),
    unitEquivalence: real('unit_equivalence').notNull().default(1),
    // sale-time snapshot of the unit's UN/ECE Rec 20 code, same
    // freeze rationale as unitEquivalence and taxKind: a credit note
    // emitted weeks later must declare the SAME unit code as the
    // document it references, even if the operator edited the unit
    // catalog in between. Null for pre-foundation rows (readers fall
    // back to the live unit, then to the EA default).
    unitStandardCode: text('unit_standard_code'),
    discount: real('discount').notNull().default(0),
    taxRate: real('tax_rate').notNull().default(0),
    // sale-time snapshot of which tax the line levied ('iva' or
    // 'inc'). Freezing it here keeps receipts, reports, and the fiscal
    // document classification honest even if the product's rate is
    // re-pointed later. Default 'iva' covers every historical row.
    taxKind: text('tax_kind', { enum: taxKindEnum }).notNull().default('iva'),
    taxAmount: real('tax_amount').notNull().default(0),
    costAtSale: real('cost_at_sale').notNull().default(0),
    total: real('total').notNull().default(0),
    // line-level currency seam. By contract these three
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
    settleCurrencyCode: text('settle_currency_code').references(() => currencyCatalog.code),
    // per-line free-form modifier note ("sin cebolla",
    // "extra queso", etc.). Captured at sale creation time by the
    // voice-ordering surface and snapshotted into the KDS card so
    // the cook sees the modifier inline with each product instead
    // of aggregated at the bottom of the ticket. Nullable so retail
    // tenants and pre- sales pass through unchanged.
    notes: text('notes'),
  },
  table => [
    index('idx_sale_items_sale').on(table.saleId),
    index('idx_sale_items_product').on(table.productId),
    // line totals, prices, tax, and snapshot cost are always
    // positive; discount is signed (per-line discount represented as a
    // negative delta in some legacy fixtures, positive in newer flows —
    // both shapes round-trip safely with only the precision invariant).
    ...moneyPositiveChecks('sale_items_unit_price', table.unitPrice),
    ...moneyPositiveChecks('sale_items_catalog_unit_price1', table.catalogUnitPrice1),
    ...moneyPositiveChecks('sale_items_catalog_unit_price2', table.catalogUnitPrice2),
    ...moneyPositiveChecks('sale_items_catalog_unit_price3', table.catalogUnitPrice3),
    ...moneyPositiveChecks('sale_items_tax', table.taxAmount),
    ...moneyPositiveChecks('sale_items_cost', table.costAtSale),
    ...moneyPositiveChecks('sale_items_total', table.total),
    moneyTwoDecimalCheck('sale_items_discount', table.discount),
    // exchange rate must be strictly positive (mirror sales).
    check('chk_sale_items_exchange_rate_positive', sql`${table.exchangeRateAtSale} > 0`),
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
// PRODUCT SERIALS (per-unit inventory and sale provenance)
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
    // immutable receiving provenance when the unit entered through
    // procurement. Legacy/manual inventory receipts remain null.
    sourcePurchaseItemId: text('source_purchase_item_id').references(() => purchaseItems.id, {
      onDelete: 'restrict',
    }),
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
    index('idx_product_serials_source_purchase_item').on(table.sourcePurchaseItemId),
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
  sourcePurchaseItem: one(purchaseItems, {
    fields: [productSerials.sourcePurchaseItemId],
    references: [purchaseItems.id],
  }),
  saleItem: one(saleItems, {
    fields: [productSerials.saleItemId],
    references: [saleItems.id],
  }),
}));

// ============================================================================
// PRODUCT SERIAL TRANSFERS (exact inter-site identity provenance)
// ============================================================================

/**
 * Immutable bridge between a transfer line and every physical unit selected
 * for it. The current location/status stays on product_serials; this bridge
 * lets deferred receive and void operations recover the exact identities.
 */
export const productSerialTransfers = sqliteTable(
  'product_serial_transfers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    transferOrderItemId: text('transfer_order_item_id')
      .notNull()
      .references(() => transferOrderItems.id, { onDelete: 'cascade' }),
    productSerialId: text('product_serial_id')
      .notNull()
      .references(() => productSerials.id, { onDelete: 'restrict' }),
    serialNumber: text('serial_number').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_product_serial_transfers_tenant').on(table.tenantId),
    index('idx_product_serial_transfers_item').on(table.transferOrderItemId),
    index('idx_product_serial_transfers_serial').on(table.productSerialId),
    uniqueIndex('idx_product_serial_transfers_item_serial').on(
      table.tenantId,
      table.transferOrderItemId,
      table.productSerialId
    ),
  ]
);

export const productSerialTransfersRelations = relations(productSerialTransfers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [productSerialTransfers.tenantId],
    references: [tenants.id],
  }),
  transferOrderItem: one(transferOrderItems, {
    fields: [productSerialTransfers.transferOrderItemId],
    references: [transferOrderItems.id],
  }),
  productSerial: one(productSerials, {
    fields: [productSerialTransfers.productSerialId],
    references: [productSerials.id],
  }),
}));

// ============================================================================
// SALE ITEM SERIALS (immutable serialized-sale provenance)
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
// SALE PAYMENTS (multi-tender / split payments)
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
    // sale_payments.amount is intentionally
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
// PAYMENT OUTBOX (LATAM payment rails foundation)
// ============================================================================

/**
 * Closed list of payment rails Puntovivo models in . Real
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
    // payment_outbox.amount is always positive: both
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
// RESTAURANT TABLES ()
// ============================================================================

/**
 * restaurant table catalog.
 *
 * Persistent per-site list of physical tables a waiter can pick when
 * opening an order on the voice-ordering / mobile-waiter surfaces.
 * v1 keeps `sales.suspendedLabel` as the persistence column (no
 * `sales.tableId` FK yet) — the dropdown just resolves the picked
 * row's `name` into the existing text label.  will introduce
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
    // partial unique on the active name so archived (isActive=0)
    // rows free the name for re-use without colliding. The index itself
    // was first introduced by migration `0023_restaurant_tables.sql` as a
    // hand-appended `CREATE UNIQUE INDEX ... WHERE is_active = 1`;
    // brings the declaration into Drizzle's schema source-of-truth
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
    destination: text('destination', { enum: ['original', 'store_credit'] as const })
      .notNull()
      .default('original'),
    subtotal: real('subtotal').notNull().default(0),
    /** Frozen restaurant tip returned with this slice of the ticket. */
    tipAmount: real('tip_amount').notNull().default(0),
    /** Frozen restaurant service charge returned with this slice. */
    serviceChargeAmount: real('service_charge_amount').notNull().default(0),
    /** Header-level discount allocated to this return (line discounts stay on items). */
    discountAmount: real('discount_amount').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    refundAmount: real('refund_amount').notNull().default(0),
    currencyCode: text('currency_code')
      .notNull()
      .default('COP')
      .references(() => currencyCatalog.code),
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
    // refund amount stores the absolute value being returned.
    ...moneyPositiveChecks('sale_returns_subtotal', table.subtotal),
    ...moneyPositiveChecks('sale_returns_tip', table.tipAmount),
    ...moneyPositiveChecks('sale_returns_service_charge', table.serviceChargeAmount),
    ...moneyPositiveChecks('sale_returns_discount', table.discountAmount),
    ...moneyPositiveChecks('sale_returns_tax', table.taxAmount),
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

// ============================================================================
// NORMALIZED PARTIAL RETURN SNAPSHOTS
// ============================================================================

/**
 * Frozen per-line return evidence. Monetary fields are deltas against the
 * original immutable sale line, not recomputations from the live catalog.
 */
export const saleReturnItems = sqliteTable(
  'sale_return_items',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleReturnId: text('sale_return_id')
      .notNull()
      .references(() => saleReturns.id, { onDelete: 'cascade' }),
    saleItemId: text('sale_item_id')
      .notNull()
      .references(() => saleItems.id, { onDelete: 'restrict' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    productNameSnapshot: text('product_name_snapshot').notNull(),
    productSkuSnapshot: text('product_sku_snapshot').notNull(),
    quantity: real('quantity').notNull(),
    baseQuantity: real('base_quantity').notNull(),
    unitPrice: real('unit_price').notNull(),
    unitEquivalence: real('unit_equivalence').notNull(),
    unitStandardCode: text('unit_standard_code'),
    discountRate: real('discount_rate').notNull().default(0),
    taxKind: text('tax_kind', { enum: taxKindEnum }).notNull().default('iva'),
    taxRate: real('tax_rate').notNull().default(0),
    subtotal: real('subtotal').notNull().default(0),
    discountAmount: real('discount_amount').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    total: real('total').notNull().default(0),
    costAmount: real('cost_amount').notNull().default(0),
    currencyCode: text('currency_code')
      .notNull()
      .default('COP')
      .references(() => currencyCatalog.code),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sale_return_items_tenant_return').on(table.tenantId, table.saleReturnId),
    index('idx_sale_return_items_sale_item').on(table.saleItemId),
    uniqueIndex('idx_sale_return_items_return_line').on(table.saleReturnId, table.saleItemId),
    check('chk_sale_return_items_quantity_positive', sql`${table.quantity} > 0`),
    check('chk_sale_return_items_base_quantity_positive', sql`${table.baseQuantity} > 0`),
    check('chk_sale_return_items_equivalence_positive', sql`${table.unitEquivalence} > 0`),
    ...moneyPositiveChecks('sale_return_items_price', table.unitPrice),
    ...moneyPositiveChecks('sale_return_items_subtotal', table.subtotal),
    ...moneyPositiveChecks('sale_return_items_discount', table.discountAmount),
    ...moneyPositiveChecks('sale_return_items_tax', table.taxAmount),
    ...moneyPositiveChecks('sale_return_items_total', table.total),
    ...moneyPositiveChecks('sale_return_items_cost', table.costAmount),
  ]
);

export const saleReturnItemTaxComponents = sqliteTable(
  'sale_return_item_tax_components',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleReturnItemId: text('sale_return_item_id')
      .notNull()
      .references(() => saleReturnItems.id, { onDelete: 'cascade' }),
    componentKey: text('component_key').notNull(),
    vatRateId: text('vat_rate_id').references(() => vatRates.id, { onDelete: 'restrict' }),
    taxKind: text('tax_kind', { enum: taxKindEnum }).notNull(),
    taxRate: real('tax_rate').notNull(),
    taxableAmount: real('taxable_amount').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    position: integer('position').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sale_return_tax_tenant_line').on(table.tenantId, table.saleReturnItemId),
    uniqueIndex('idx_sale_return_tax_key').on(table.saleReturnItemId, table.componentKey),
    uniqueIndex('idx_sale_return_tax_position').on(table.saleReturnItemId, table.position),
    check('chk_sale_return_tax_position', sql`${table.position} between 0 and 3`),
    check('chk_sale_return_tax_rate', sql`${table.taxRate} >= 0 and ${table.taxRate} <= 100`),
    ...moneyPositiveChecks('sale_return_tax_base', table.taxableAmount),
    ...moneyPositiveChecks('sale_return_tax_amount', table.taxAmount),
  ]
);

/** Immutable bridge from a returned quantity to the exact consumed lot. */
export const saleReturnItemLots = sqliteTable(
  'sale_return_item_lots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleReturnItemId: text('sale_return_item_id')
      .notNull()
      .references(() => saleReturnItems.id, { onDelete: 'cascade' }),
    saleItemLotId: text('sale_item_lot_id')
      .notNull()
      .references(() => saleItemLots.id, { onDelete: 'restrict' }),
    lotId: text('lot_id')
      .notNull()
      .references(() => inventoryLots.id, { onDelete: 'restrict' }),
    quantity: real('quantity').notNull(),
    unitCost: real('unit_cost').notNull().default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sale_return_lots_tenant_line').on(table.tenantId, table.saleReturnItemId),
    index('idx_sale_return_lots_original').on(table.saleItemLotId),
    uniqueIndex('idx_sale_return_lots_line_original').on(
      table.saleReturnItemId,
      table.saleItemLotId
    ),
    check('chk_sale_return_lots_quantity_positive', sql`${table.quantity} > 0`),
    ...moneyPositiveChecks('sale_return_lots_cost', table.unitCost),
  ]
);

/** Immutable bridge from a return line to the exact serialized unit. */
export const saleReturnItemSerials = sqliteTable(
  'sale_return_item_serials',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleReturnItemId: text('sale_return_item_id')
      .notNull()
      .references(() => saleReturnItems.id, { onDelete: 'cascade' }),
    saleItemSerialId: text('sale_item_serial_id')
      .notNull()
      .references(() => saleItemSerials.id, { onDelete: 'restrict' }),
    productSerialId: text('product_serial_id')
      .notNull()
      .references(() => productSerials.id, { onDelete: 'restrict' }),
    serialNumber: text('serial_number').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sale_return_serials_tenant_line').on(table.tenantId, table.saleReturnItemId),
    index('idx_sale_return_serials_original').on(table.saleItemSerialId),
    uniqueIndex('idx_sale_return_serials_once').on(table.saleItemSerialId),
  ]
);

export const saleReturnPaymentAllocations = sqliteTable(
  'sale_return_payment_allocations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleReturnId: text('sale_return_id')
      .notNull()
      .references(() => saleReturns.id, { onDelete: 'cascade' }),
    salePaymentId: text('sale_payment_id').references(() => salePayments.id, {
      onDelete: 'restrict',
    }),
    originalMethod: text('original_method', { enum: paymentMethodEnum }).notNull(),
    destination: text('destination', {
      enum: ['cash', 'receivable', 'external', 'store_credit'] as const,
    }).notNull(),
    amount: real('amount').notNull(),
    externalReference: text('external_reference'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sale_return_allocations_tenant_return').on(table.tenantId, table.saleReturnId),
    index('idx_sale_return_allocations_payment').on(table.salePaymentId),
    uniqueIndex('idx_sale_return_allocations_return_payment').on(
      table.saleReturnId,
      table.salePaymentId
    ),
    ...moneyPositiveChecks('sale_return_allocations_amount', table.amount),
  ]
);

/** Auditable relationship between a return and the independent replacement sale. */
export const saleExchanges = sqliteTable(
  'sale_exchanges',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleReturnId: text('sale_return_id')
      .notNull()
      .references(() => saleReturns.id, { onDelete: 'restrict' }),
    replacementSaleId: text('replacement_sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'restrict' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sale_exchanges_tenant').on(table.tenantId),
    uniqueIndex('idx_sale_exchanges_return').on(table.saleReturnId),
    uniqueIndex('idx_sale_exchanges_replacement').on(table.replacementSaleId),
  ]
);
