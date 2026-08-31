/**
 * Drizzle schema — purchasing domain.
 *
 * relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/purchasing
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
  orderStatusEnum,
  purchaseStatusEnum,
  sqliteNow,
  syncStatusEnum,
} from './base.js';
import { sites, tenants, users } from './auth.js';
import { providers, units } from './catalogs.js';
import { products } from './products.js';

export const providerPayableInvoiceKindEnum = ['invoice', 'opening_balance'] as const;
export type ProviderPayableInvoiceKind = (typeof providerPayableInvoiceKindEnum)[number];
export const providerPayableSourceTypeEnum = ['payment', 'credit'] as const;
export type ProviderPayableSourceType = (typeof providerPayableSourceTypeEnum)[number];
export const providerPayablePaymentMethodEnum = ['cash', 'card', 'transfer', 'other'] as const;
export type ProviderPayablePaymentMethod = (typeof providerPayablePaymentMethodEnum)[number];

// ============================================================================
// PURCHASES
// ============================================================================

/** A purchase records inventory that was actually received from a provider and therefore affects stock and product cost. */
export const purchases = sqliteTable(
  'purchases',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    purchaseNumber: text('purchase_number').notNull(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    orderId: text('order_id').references(() => orders.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    status: text('status', { enum: purchaseStatusEnum }).notNull().default('completed'),
    subtotal: real('subtotal').notNull().default(0),
    total: real('total').notNull().default(0),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_purchases_tenant').on(table.tenantId),
    index('idx_purchases_provider').on(table.providerId),
    index('idx_purchases_order').on(table.orderId),
    index('idx_purchases_site').on(table.siteId),
    index('idx_purchases_created_by').on(table.createdBy),
    uniqueIndex('idx_purchases_tenant_number').on(table.tenantId, table.purchaseNumber),
    // purchase totals are always positive (a refund creates a
    // separate purchase_returns row, never a negative purchase).
    ...moneyPositiveChecks('purchases_subtotal', table.subtotal),
    ...moneyPositiveChecks('purchases_total', table.total),
  ]
);

export const purchasesRelations = relations(purchases, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [purchases.tenantId],
    references: [tenants.id],
  }),
  provider: one(providers, {
    fields: [purchases.providerId],
    references: [providers.id],
  }),
  sourceOrder: one(orders, {
    fields: [purchases.orderId],
    references: [orders.id],
  }),
  site: one(sites, {
    fields: [purchases.siteId],
    references: [sites.id],
  }),
  createdByUser: one(users, {
    fields: [purchases.createdBy],
    references: [users.id],
  }),
  items: many(purchaseItems),
  returns: many(purchaseReturns),
}));

export const invoiceUploads = sqliteTable(
  'invoice_uploads',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id').references(() => sites.id),
    userId: text('user_id').references(() => users.id),
    fileName: text('file_name'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    payloadBase64: text('payload_base64').notNull(),
    payloadHash: text('payload_hash').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_invoice_uploads_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_invoice_uploads_tenant_site_created').on(
      table.tenantId,
      table.siteId,
      table.createdAt
    ),
    index('idx_invoice_uploads_payload_hash').on(table.payloadHash),
  ]
);

export const invoiceUploadsRelations = relations(invoiceUploads, ({ one }) => ({
  tenant: one(tenants, {
    fields: [invoiceUploads.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [invoiceUploads.siteId],
    references: [sites.id],
  }),
  user: one(users, {
    fields: [invoiceUploads.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// PURCHASE ITEMS
// ============================================================================

export const purchaseItems = sqliteTable(
  'purchase_items',
  {
    id: text('id').primaryKey(),
    purchaseId: text('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    sourceOrderItemId: text('source_order_item_id').references(() => orderItems.id),
    quantity: real('quantity').notNull().default(1),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    unitEquivalence: real('unit_equivalence').notNull().default(1),
    costPerUnit: real('cost_per_unit').notNull().default(0),
    baseUnitCost: real('base_unit_cost').notNull().default(0),
    total: real('total').notNull().default(0),
  },
  table => [
    index('idx_purchase_items_purchase').on(table.purchaseId),
    index('idx_purchase_items_product').on(table.productId),
    index('idx_purchase_items_source_order_item').on(table.sourceOrderItemId),
    // purchase-item costs are always positive.
    ...moneyPositiveChecks('purchase_items_cost_per_unit', table.costPerUnit),
    ...moneyPositiveChecks('purchase_items_base_cost', table.baseUnitCost),
    ...moneyPositiveChecks('purchase_items_total', table.total),
  ]
);

export const purchaseItemsRelations = relations(purchaseItems, ({ one, many }) => ({
  purchase: one(purchases, {
    fields: [purchaseItems.purchaseId],
    references: [purchases.id],
  }),
  product: one(products, {
    fields: [purchaseItems.productId],
    references: [products.id],
  }),
  sourceOrderItem: one(orderItems, {
    fields: [purchaseItems.sourceOrderItemId],
    references: [orderItems.id],
  }),
  unit: one(units, {
    fields: [purchaseItems.unitId],
    references: [units.id],
  }),
  returnItems: many(purchaseReturnItems),
}));

// ============================================================================
// PROVIDER PAYABLES
// ============================================================================

/**
 * One supplier charge. Historical balances are represented only by the
 * explicit opening_balance kind; migrations never infer debt from purchases.
 */
export const providerPayableInvoices = sqliteTable(
  'provider_payable_invoices',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    purchaseId: text('purchase_id').references(() => purchases.id),
    kind: text('kind', { enum: providerPayableInvoiceKindEnum }).notNull(),
    documentNumber: text('document_number').notNull(),
    issuedAt: text('issued_at').notNull(),
    dueAt: text('due_at').notNull(),
    amount: real('amount').notNull(),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(1),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_provider_payable_invoices_tenant_provider_due').on(
      table.tenantId,
      table.providerId,
      table.dueAt
    ),
    index('idx_provider_payable_invoices_purchase').on(table.purchaseId),
    uniqueIndex('idx_provider_payable_invoices_provider_document').on(
      table.tenantId,
      table.providerId,
      table.documentNumber
    ),
    uniqueIndex('idx_provider_payable_invoices_purchase_unique')
      .on(table.tenantId, table.purchaseId)
      .where(sql`${table.purchaseId} IS NOT NULL`),
    check('chk_provider_payable_invoices_amount_positive', sql`${table.amount} > 0`),
    moneyTwoDecimalCheck('provider_payable_invoices_amount', table.amount),
  ]
);

/** One immutable supplier payment. It must be allocated in full at creation. */
export const providerPayablePayments = sqliteTable(
  'provider_payable_payments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    amount: real('amount').notNull(),
    method: text('method', { enum: providerPayablePaymentMethodEnum }).notNull(),
    reference: text('reference'),
    paidAt: text('paid_at').notNull(),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(1),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_provider_payable_payments_tenant_provider_paid').on(
      table.tenantId,
      table.providerId,
      table.paidAt
    ),
    check('chk_provider_payable_payments_amount_positive', sql`${table.amount} > 0`),
    moneyTwoDecimalCheck('provider_payable_payments_amount', table.amount),
  ]
);

/** One immutable supplier credit note, also allocated in full at creation. */
export const providerPayableCredits = sqliteTable(
  'provider_payable_credits',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    amount: real('amount').notNull(),
    documentNumber: text('document_number').notNull(),
    creditedAt: text('credited_at').notNull(),
    reason: text('reason').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(1),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_provider_payable_credits_tenant_provider_credited').on(
      table.tenantId,
      table.providerId,
      table.creditedAt
    ),
    uniqueIndex('idx_provider_payable_credits_provider_document').on(
      table.tenantId,
      table.providerId,
      table.documentNumber
    ),
    check('chk_provider_payable_credits_amount_positive', sql`${table.amount} > 0`),
    moneyTwoDecimalCheck('provider_payable_credits_amount', table.amount),
  ]
);

/**
 * Allocation of one payment or credit to one supplier invoice. Exactly one
 * source FK is present, and the application transaction enforces provider,
 * tenant and outstanding-amount boundaries before insertion.
 */
export const providerPayableAllocations = sqliteTable(
  'provider_payable_allocations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => providerPayableInvoices.id),
    sourceType: text('source_type', { enum: providerPayableSourceTypeEnum }).notNull(),
    paymentId: text('payment_id').references(() => providerPayablePayments.id),
    creditId: text('credit_id').references(() => providerPayableCredits.id),
    amount: real('amount').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(1),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_provider_payable_allocations_invoice').on(table.invoiceId),
    index('idx_provider_payable_allocations_payment').on(table.paymentId),
    index('idx_provider_payable_allocations_credit').on(table.creditId),
    uniqueIndex('idx_provider_payable_allocations_payment_invoice')
      .on(table.paymentId, table.invoiceId)
      .where(sql`${table.paymentId} IS NOT NULL`),
    uniqueIndex('idx_provider_payable_allocations_credit_invoice')
      .on(table.creditId, table.invoiceId)
      .where(sql`${table.creditId} IS NOT NULL`),
    check('chk_provider_payable_allocations_amount_positive', sql`${table.amount} > 0`),
    moneyTwoDecimalCheck('provider_payable_allocations_amount', table.amount),
    check(
      'chk_provider_payable_allocations_source',
      sql`(${table.sourceType} = 'payment' AND ${table.paymentId} IS NOT NULL AND ${table.creditId} IS NULL) OR (${table.sourceType} = 'credit' AND ${table.creditId} IS NOT NULL AND ${table.paymentId} IS NULL)`
    ),
  ]
);

export const providerPayableInvoicesRelations = relations(
  providerPayableInvoices,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [providerPayableInvoices.tenantId],
      references: [tenants.id],
    }),
    provider: one(providers, {
      fields: [providerPayableInvoices.providerId],
      references: [providers.id],
    }),
    site: one(sites, {
      fields: [providerPayableInvoices.siteId],
      references: [sites.id],
    }),
    purchase: one(purchases, {
      fields: [providerPayableInvoices.purchaseId],
      references: [purchases.id],
    }),
    allocations: many(providerPayableAllocations),
  })
);

export const providerPayablePaymentsRelations = relations(
  providerPayablePayments,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [providerPayablePayments.tenantId],
      references: [tenants.id],
    }),
    provider: one(providers, {
      fields: [providerPayablePayments.providerId],
      references: [providers.id],
    }),
    site: one(sites, {
      fields: [providerPayablePayments.siteId],
      references: [sites.id],
    }),
    allocations: many(providerPayableAllocations),
  })
);

export const providerPayableCreditsRelations = relations(
  providerPayableCredits,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [providerPayableCredits.tenantId],
      references: [tenants.id],
    }),
    provider: one(providers, {
      fields: [providerPayableCredits.providerId],
      references: [providers.id],
    }),
    site: one(sites, {
      fields: [providerPayableCredits.siteId],
      references: [sites.id],
    }),
    allocations: many(providerPayableAllocations),
  })
);

export const providerPayableAllocationsRelations = relations(
  providerPayableAllocations,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [providerPayableAllocations.tenantId],
      references: [tenants.id],
    }),
    provider: one(providers, {
      fields: [providerPayableAllocations.providerId],
      references: [providers.id],
    }),
    invoice: one(providerPayableInvoices, {
      fields: [providerPayableAllocations.invoiceId],
      references: [providerPayableInvoices.id],
    }),
    payment: one(providerPayablePayments, {
      fields: [providerPayableAllocations.paymentId],
      references: [providerPayablePayments.id],
    }),
    credit: one(providerPayableCredits, {
      fields: [providerPayableAllocations.creditId],
      references: [providerPayableCredits.id],
    }),
  })
);

// ============================================================================
// PURCHASE RETURNS
// ============================================================================

/** A purchase return records goods sent back to a provider after receipt, reducing stock while preserving the original purchase as history. */
export const purchaseReturns = sqliteTable(
  'purchase_returns',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    purchaseId: text('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    returnAmount: real('return_amount').notNull().default(0),
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
    index('idx_purchase_returns_tenant').on(table.tenantId),
    index('idx_purchase_returns_purchase').on(table.purchaseId),
    index('idx_purchase_returns_created_by').on(table.createdBy),
    // refund amount is the absolute value being returned.
    ...moneyPositiveChecks('purchase_returns_amount', table.returnAmount),
  ]
);

export const purchaseReturnsRelations = relations(purchaseReturns, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [purchaseReturns.tenantId],
    references: [tenants.id],
  }),
  purchase: one(purchases, {
    fields: [purchaseReturns.purchaseId],
    references: [purchases.id],
  }),
  createdByUser: one(users, {
    fields: [purchaseReturns.createdBy],
    references: [users.id],
  }),
  items: many(purchaseReturnItems),
}));

// ============================================================================
// PURCHASE RETURN ITEMS
// ============================================================================

export const purchaseReturnItems = sqliteTable(
  'purchase_return_items',
  {
    id: text('id').primaryKey(),
    purchaseReturnId: text('purchase_return_id')
      .notNull()
      .references(() => purchaseReturns.id, { onDelete: 'cascade' }),
    purchaseItemId: text('purchase_item_id')
      .notNull()
      .references(() => purchaseItems.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: real('quantity').notNull().default(1),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    unitEquivalence: real('unit_equivalence').notNull().default(1),
    costPerUnit: real('cost_per_unit').notNull().default(0),
    baseUnitCost: real('base_unit_cost').notNull().default(0),
    total: real('total').notNull().default(0),
  },
  table => [
    index('idx_purchase_return_items_return').on(table.purchaseReturnId),
    index('idx_purchase_return_items_purchase_item').on(table.purchaseItemId),
    index('idx_purchase_return_items_product').on(table.productId),
  ]
);

export const purchaseReturnItemsRelations = relations(purchaseReturnItems, ({ one }) => ({
  purchaseReturn: one(purchaseReturns, {
    fields: [purchaseReturnItems.purchaseReturnId],
    references: [purchaseReturns.id],
  }),
  purchaseItem: one(purchaseItems, {
    fields: [purchaseReturnItems.purchaseItemId],
    references: [purchaseItems.id],
  }),
  product: one(products, {
    fields: [purchaseReturnItems.productId],
    references: [products.id],
  }),
  unit: one(units, {
    fields: [purchaseReturnItems.unitId],
    references: [units.id],
  }),
}));

// ============================================================================
// ORDERS
// ============================================================================

/** An order records a purchase request sent to a provider before goods are received; it plans buying but does not move stock by itself. */
export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    orderNumber: text('order_number').notNull(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    status: text('status', { enum: orderStatusEnum }).notNull().default('submitted'),
    subtotal: real('subtotal').notNull().default(0),
    total: real('total').notNull().default(0),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_orders_tenant').on(table.tenantId),
    index('idx_orders_provider').on(table.providerId),
    index('idx_orders_site').on(table.siteId),
    index('idx_orders_created_by').on(table.createdBy),
    uniqueIndex('idx_orders_tenant_number').on(table.tenantId, table.orderNumber),
    // orders are planning artifacts; totals never go negative.
    ...moneyPositiveChecks('orders_subtotal', table.subtotal),
    ...moneyPositiveChecks('orders_total', table.total),
  ]
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [orders.tenantId],
    references: [tenants.id],
  }),
  provider: one(providers, {
    fields: [orders.providerId],
    references: [providers.id],
  }),
  site: one(sites, {
    fields: [orders.siteId],
    references: [sites.id],
  }),
  createdByUser: one(users, {
    fields: [orders.createdBy],
    references: [users.id],
  }),
  linkedPurchases: many(purchases),
  items: many(orderItems),
}));

// ============================================================================
// ORDER ITEMS
// ============================================================================

export const orderItems = sqliteTable(
  'order_items',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: real('quantity').notNull().default(1),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    unitEquivalence: real('unit_equivalence').notNull().default(1),
    costPerUnit: real('cost_per_unit').notNull().default(0),
    baseUnitCost: real('base_unit_cost').notNull().default(0),
    total: real('total').notNull().default(0),
  },
  table => [
    index('idx_order_items_order').on(table.orderId),
    index('idx_order_items_product').on(table.productId),
    // order-item costs are always positive.
    ...moneyPositiveChecks('order_items_cost_per_unit', table.costPerUnit),
    ...moneyPositiveChecks('order_items_base_cost', table.baseUnitCost),
    ...moneyPositiveChecks('order_items_total', table.total),
  ]
);

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
  unit: one(units, {
    fields: [orderItems.unitId],
    references: [units.id],
  }),
}));
