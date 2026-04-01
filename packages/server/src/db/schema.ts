/**
 * Drizzle ORM Schema for Open Yojob POS System
 *
 * This is the source-of-truth schema for the SQLite database.
 * All tables support multi-tenant isolation via tenant_id.
 *
 * @module db/schema
 */

import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ============================================================================
// ENUMS (as string literals for SQLite)
// ============================================================================

export const syncStatusEnum = ['pending', 'synced', 'conflict', 'error'] as const;
export const paymentMethodEnum = ['cash', 'card', 'transfer', 'credit', 'other'] as const;
export const paymentStatusEnum = ['pending', 'paid', 'partial', 'refunded'] as const;
export const saleStatusEnum = ['draft', 'completed', 'cancelled', 'voided'] as const;
export const movementTypeEnum = ['purchase', 'sale', 'adjustment', 'transfer', 'return'] as const;
export const userRoleEnum = ['admin', 'manager', 'cashier'] as const;

// ============================================================================
// TENANTS
// ============================================================================

export const tenants = sqliteTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    settings: text('settings', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [uniqueIndex('idx_tenants_slug').on(table.slug)]
);

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  products: many(products),
  categories: many(categories),
  customers: many(customers),
  sales: many(sales),
  inventoryMovements: many(inventoryMovements),
}));

// ============================================================================
// USERS
// ============================================================================

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: userRoleEnum }).notNull().default('cashier'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_users_tenant').on(table.tenantId),
    uniqueIndex('idx_users_email').on(table.email),
  ]
);

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  sales: many(sales),
  inventoryMovements: many(inventoryMovements),
}));

// ============================================================================
// CATEGORIES
// ============================================================================

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    description: text('description'),
    parentId: text('parent_id'),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_categories_tenant').on(table.tenantId),
    index('idx_categories_parent').on(table.parentId),
  ]
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [categories.tenantId],
    references: [tenants.id],
  }),
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'categoryParent',
  }),
  children: many(categories, { relationName: 'categoryParent' }),
  products: many(products),
}));

// ============================================================================
// PRODUCTS
// ============================================================================

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    sku: text('sku').notNull(),
    description: text('description'),
    categoryId: text('category_id').references(() => categories.id),
    price: real('price').notNull().default(0),
    cost: real('cost').notNull().default(0),
    taxRate: real('tax_rate').notNull().default(0),
    stock: integer('stock').notNull().default(0),
    minStock: integer('min_stock').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    barcode: text('barcode'),
    imageUrl: text('image_url'),
    // Sync fields
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_products_tenant').on(table.tenantId),
    index('idx_products_sku').on(table.sku),
    index('idx_products_barcode').on(table.barcode),
    index('idx_products_category').on(table.categoryId),
    uniqueIndex('idx_products_tenant_sku').on(table.tenantId, table.sku),
  ]
);

export const productsRelations = relations(products, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [products.tenantId],
    references: [tenants.id],
  }),
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  saleItems: many(saleItems),
  inventoryMovements: many(inventoryMovements),
}));

// ============================================================================
// CUSTOMERS
// ============================================================================

export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    country: text('country'),
    taxId: text('tax_id'),
    notes: text('notes'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    // Sync fields
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_customers_tenant').on(table.tenantId),
    index('idx_customers_email').on(table.email),
  ]
);

export const customersRelations = relations(customers, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [customers.tenantId],
    references: [tenants.id],
  }),
  sales: many(sales),
}));

// ============================================================================
// SALES
// ============================================================================

export const sales = sqliteTable(
  'sales',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleNumber: text('sale_number').notNull(),
    customerId: text('customer_id').references(() => customers.id),
    subtotal: real('subtotal').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    discountAmount: real('discount_amount').notNull().default(0),
    total: real('total').notNull().default(0),
    paymentMethod: text('payment_method', { enum: paymentMethodEnum }).notNull().default('cash'),
    paymentStatus: text('payment_status', { enum: paymentStatusEnum }).notNull().default('pending'),
    status: text('status', { enum: saleStatusEnum }).notNull().default('draft'),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    // Sync fields
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
    updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_sales_tenant').on(table.tenantId),
    index('idx_sales_customer').on(table.customerId),
    index('idx_sales_created_by').on(table.createdBy),
    uniqueIndex('idx_sales_tenant_number').on(table.tenantId, table.saleNumber),
  ]
);

export const salesRelations = relations(sales, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [sales.tenantId],
    references: [tenants.id],
  }),
  customer: one(customers, {
    fields: [sales.customerId],
    references: [customers.id],
  }),
  createdByUser: one(users, {
    fields: [sales.createdBy],
    references: [users.id],
  }),
  items: many(saleItems),
}));

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
    quantity: integer('quantity').notNull().default(1),
    unitPrice: real('unit_price').notNull().default(0),
    discount: real('discount').notNull().default(0),
    taxRate: real('tax_rate').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    total: real('total').notNull().default(0),
  },
  table => [
    index('idx_sale_items_sale').on(table.saleId),
    index('idx_sale_items_product').on(table.productId),
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
}));

// ============================================================================
// INVENTORY MOVEMENTS
// ============================================================================

export const inventoryMovements = sqliteTable(
  'inventory_movements',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    type: text('type', { enum: movementTypeEnum }).notNull(),
    quantity: integer('quantity').notNull(),
    previousStock: integer('previous_stock').notNull(),
    newStock: integer('new_stock').notNull(),
    reference: text('reference'),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    // Sync fields
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_inventory_tenant').on(table.tenantId),
    index('idx_inventory_product').on(table.productId),
    index('idx_inventory_created_by').on(table.createdBy),
  ]
);

export const inventoryMovementsRelations = relations(inventoryMovements, ({ one }) => ({
  tenant: one(tenants, {
    fields: [inventoryMovements.tenantId],
    references: [tenants.id],
  }),
  product: one(products, {
    fields: [inventoryMovements.productId],
    references: [products.id],
  }),
  createdByUser: one(users, {
    fields: [inventoryMovements.createdBy],
    references: [users.id],
  }),
}));

// ============================================================================
// SYNC QUEUE (Local operations waiting to be synced)
// ============================================================================

export const syncQueue = sqliteTable(
  'sync_queue',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    entityType: text('entity_type').notNull(), // e.g., 'products', 'sales', 'customers'
    entityId: text('entity_id').notNull(),
    operation: text('operation', { enum: ['create', 'update', 'delete'] as const }).notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
    localVersion: integer('local_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_sync_queue_tenant').on(table.tenantId),
    index('idx_sync_queue_entity').on(table.entityType, table.entityId),
  ]
);

// ============================================================================
// SYNC CONFLICTS
// ============================================================================

export const syncConflicts = sqliteTable(
  'sync_conflicts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    localData: text('local_data', { mode: 'json' }).$type<Record<string, unknown>>(),
    remoteData: text('remote_data', { mode: 'json' }).$type<Record<string, unknown>>(),
    status: text('status', { enum: ['pending', 'resolved'] as const })
      .notNull()
      .default('pending'),
    resolution: text('resolution', { enum: ['local_wins', 'remote_wins', 'merged'] as const }),
    resolvedAt: text('resolved_at'),
    createdAt: text('created_at').notNull().default(new Date().toISOString()),
  },
  table => [
    index('idx_sync_conflicts_tenant').on(table.tenantId),
    index('idx_sync_conflicts_status').on(table.status),
  ]
);

// ============================================================================
// APP SETTINGS (Local app configuration)
// ============================================================================

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>(),
  updatedAt: text('updated_at').notNull().default(new Date().toISOString()),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type Sale = typeof sales.$inferSelect;
export type NewSale = typeof sales.$inferInsert;

export type SaleItem = typeof saleItems.$inferSelect;
export type NewSaleItem = typeof saleItems.$inferInsert;

export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type NewInventoryMovement = typeof inventoryMovements.$inferInsert;

export type SyncQueueItem = typeof syncQueue.$inferSelect;
export type NewSyncQueueItem = typeof syncQueue.$inferInsert;

export type SyncConflict = typeof syncConflicts.$inferSelect;
export type NewSyncConflict = typeof syncConflicts.$inferInsert;

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
