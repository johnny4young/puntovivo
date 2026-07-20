/**
 * transfer-order schema and deferred receipt relations.
 *
 * @module db/schema/inventory/transfers
 */

import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { nowIso, sqliteNow, syncStatusEnum } from '../base.js';
import { sites, tenants, users } from '../auth.js';
import { products } from '../products.js';

// ============================================================================
// TRANSFER ORDERS (immediate step, no ship/receive lifecycle)
// ============================================================================

export const transferOrderStatusEnum = ['completed', 'in_transit', 'void'] as const;

/**
 * A transfer order captures a cross-site stock movement. * shipped the immediate `completed` transfer (create + ship + receive
 * collapsed into one atomic step). Step 3 adds the `in_transit` state for
 * deferred-receive transfers — origin is debited on create, destination is
 * credited later via `transfers.receive`. A future step may add an explicit
 * `draft` state if transfers need to be staged without touching balances.
 */
export const transferOrders = sqliteTable(
  'transfer_orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    fromSiteId: text('from_site_id')
      .notNull()
      .references(() => sites.id),
    toSiteId: text('to_site_id')
      .notNull()
      .references(() => sites.id),
    status: text('status', { enum: transferOrderStatusEnum }).notNull().default('completed'),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    // receipt metadata for the in_transit → completed
    // transition. Null on immediate transfers that skip the deferred window.
    receivedAt: text('received_at'),
    receivedBy: text('received_by').references(() => users.id),
    // optional note captured by the receiver when they record
    // a variance between shipped and received quantities.
    discrepancyNotes: text('discrepancy_notes'),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_transfer_orders_tenant').on(table.tenantId),
    index('idx_transfer_orders_from_site').on(table.fromSiteId),
    index('idx_transfer_orders_to_site').on(table.toSiteId),
    index('idx_transfer_orders_status').on(table.status),
    index('idx_transfer_orders_received_by').on(table.receivedBy),
  ]
);

export const transferOrderItems = sqliteTable(
  'transfer_order_items',
  {
    id: text('id').primaryKey(),
    transferOrderId: text('transfer_order_id')
      .notNull()
      .references(() => transferOrders.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: real('quantity').notNull(),
    // what the destination actually received. Null for legacy
    // receipts and for lines still in transit; populated on every line at
    // receive time, defaulting to `quantity` when the receiver did not edit.
    receivedQuantity: real('received_quantity'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_transfer_order_items_order').on(table.transferOrderId),
    index('idx_transfer_order_items_product').on(table.productId),
  ]
);

export const transferOrdersRelations = relations(transferOrders, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [transferOrders.tenantId],
    references: [tenants.id],
  }),
  fromSite: one(sites, {
    fields: [transferOrders.fromSiteId],
    references: [sites.id],
  }),
  toSite: one(sites, {
    fields: [transferOrders.toSiteId],
    references: [sites.id],
  }),
  createdByUser: one(users, {
    fields: [transferOrders.createdBy],
    references: [users.id],
  }),
  items: many(transferOrderItems),
}));

export const transferOrderItemsRelations = relations(transferOrderItems, ({ one }) => ({
  order: one(transferOrders, {
    fields: [transferOrderItems.transferOrderId],
    references: [transferOrders.id],
  }),
  product: one(products, {
    fields: [transferOrderItems.productId],
    references: [products.id],
  }),
}));
