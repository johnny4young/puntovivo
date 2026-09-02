/**
 * transfer-order schema and deferred receipt relations.
 *
 * @module db/schema/inventory/transfers
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
import { lotStatusEnum, moneyPositiveChecks, nowIso, sqliteNow, syncStatusEnum } from '../base.js';
import { sites, tenants, users } from '../auth.js';
import { products } from '../products.js';
import { inventoryLots } from './lots.js';

// ============================================================================
// TRANSFER ORDERS
// ============================================================================

export const transferOrderStatusEnum = ['completed', 'in_transit', 'void'] as const;

/**
 * A transfer order captures a cross-site stock movement. An immediate
 * `completed` transfer collapses dispatch and receipt into one atomic command.
 * A deferred transfer remains `in_transit` after the origin debit and credits
 * the destination later through `transfers.receive`.
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
    /** Destination balance revision immediately after a positive credit. */
    destinationResultingBalanceVersion: integer('destination_resulting_balance_version'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_transfer_order_items_order').on(table.transferOrderId),
    index('idx_transfer_order_items_product').on(table.productId),
    check(
      'chk_transfer_order_items_destination_version_nonnegative',
      sql`${table.destinationResultingBalanceVersion} IS NULL OR ${table.destinationResultingBalanceVersion} >= 0`
    ),
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

export const transferOrderItemsRelations = relations(transferOrderItems, ({ one, many }) => ({
  order: one(transferOrders, {
    fields: [transferOrderItems.transferOrderId],
    references: [transferOrders.id],
  }),
  product: one(products, {
    fields: [transferOrderItems.productId],
    references: [products.id],
  }),
  lots: many(transferOrderItemLots),
}));

/**
 * Exact physical batches shipped by a transfer line. The source identity and
 * immutable lot snapshots are frozen at dispatch; destinationLotId and
 * receivedQuantity are populated immediately or when a deferred shipment is
 * received. This makes shortages and reversals batch-specific instead of
 * inferring them from aggregate balances.
 */
export const transferOrderItemLots = sqliteTable(
  'transfer_order_item_lots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    transferOrderItemId: text('transfer_order_item_id')
      .notNull()
      .references(() => transferOrderItems.id, { onDelete: 'cascade' }),
    sourceLotId: text('source_lot_id')
      .notNull()
      .references(() => inventoryLots.id),
    destinationLotId: text('destination_lot_id').references(() => inventoryLots.id),
    lotNumberSnapshot: text('lot_number_snapshot').notNull(),
    expiresAtSnapshot: text('expires_at_snapshot'),
    sourceStatusSnapshot: text('source_status_snapshot', { enum: lotStatusEnum }).notNull(),
    quantity: real('quantity').notNull(),
    receivedQuantity: real('received_quantity'),
    unitCost: real('unit_cost').notNull(),
    destinationLotWasCreated: integer('destination_lot_was_created', { mode: 'boolean' }),
    destinationPreviousOnHand: real('destination_previous_on_hand'),
    destinationPreviousUnitCost: real('destination_previous_unit_cost'),
    destinationPreviousStatus: text('destination_previous_status', { enum: lotStatusEnum }),
    destinationResultingOnHand: real('destination_resulting_on_hand'),
    destinationResultingUnitCost: real('destination_resulting_unit_cost'),
    destinationResultingStatus: text('destination_resulting_status', { enum: lotStatusEnum }),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_transfer_order_item_lots_tenant').on(table.tenantId),
    index('idx_transfer_order_item_lots_item').on(table.transferOrderItemId),
    index('idx_transfer_order_item_lots_source').on(table.sourceLotId),
    index('idx_transfer_order_item_lots_destination').on(table.destinationLotId),
    uniqueIndex('idx_transfer_order_item_lots_item_source').on(
      table.transferOrderItemId,
      table.sourceLotId
    ),
    check('chk_transfer_order_item_lots_quantity_positive', sql`${table.quantity} > 0`),
    check(
      'chk_transfer_order_item_lots_received_range',
      sql`${table.receivedQuantity} IS NULL OR (${table.receivedQuantity} >= 0 AND ${table.receivedQuantity} <= ${table.quantity})`
    ),
    check(
      'chk_transfer_order_item_lots_destination_snapshot',
      sql`(${table.receivedQuantity} IS NULL AND ${table.destinationLotId} IS NULL AND ${table.destinationLotWasCreated} IS NULL AND ${table.destinationPreviousOnHand} IS NULL AND ${table.destinationPreviousUnitCost} IS NULL AND ${table.destinationPreviousStatus} IS NULL AND ${table.destinationResultingOnHand} IS NULL AND ${table.destinationResultingUnitCost} IS NULL AND ${table.destinationResultingStatus} IS NULL) OR (${table.receivedQuantity} = 0 AND ${table.destinationLotId} IS NULL AND ${table.destinationLotWasCreated} IS NULL AND ${table.destinationPreviousOnHand} IS NULL AND ${table.destinationPreviousUnitCost} IS NULL AND ${table.destinationPreviousStatus} IS NULL AND ${table.destinationResultingOnHand} IS NULL AND ${table.destinationResultingUnitCost} IS NULL AND ${table.destinationResultingStatus} IS NULL) OR (${table.receivedQuantity} > 0 AND ${table.destinationLotId} IS NOT NULL AND ${table.destinationLotWasCreated} IS NOT NULL AND ${table.destinationResultingOnHand} IS NOT NULL AND ${table.destinationResultingUnitCost} IS NOT NULL AND ${table.destinationResultingStatus} IS NOT NULL AND ((${table.destinationLotWasCreated} = 1 AND ${table.destinationPreviousOnHand} IS NULL AND ${table.destinationPreviousUnitCost} IS NULL AND ${table.destinationPreviousStatus} IS NULL) OR (${table.destinationLotWasCreated} = 0 AND ${table.destinationPreviousOnHand} IS NOT NULL AND ${table.destinationPreviousUnitCost} IS NOT NULL AND ${table.destinationPreviousStatus} IS NOT NULL)))`
    ),
    ...moneyPositiveChecks('transfer_order_item_lots_unit_cost', table.unitCost),
    check(
      'chk_transfer_order_item_lots_destination_previous_on_hand_nonnegative',
      sql`${table.destinationPreviousOnHand} IS NULL OR ${table.destinationPreviousOnHand} >= 0`
    ),
    check(
      'chk_transfer_order_item_lots_destination_resulting_on_hand_nonnegative',
      sql`${table.destinationResultingOnHand} IS NULL OR ${table.destinationResultingOnHand} >= 0`
    ),
  ]
);

export const transferOrderItemLotsRelations = relations(transferOrderItemLots, ({ one }) => ({
  tenant: one(tenants, {
    fields: [transferOrderItemLots.tenantId],
    references: [tenants.id],
  }),
  transferOrderItem: one(transferOrderItems, {
    fields: [transferOrderItemLots.transferOrderItemId],
    references: [transferOrderItems.id],
  }),
  sourceLot: one(inventoryLots, {
    fields: [transferOrderItemLots.sourceLotId],
    references: [inventoryLots.id],
    relationName: 'transferSourceLot',
  }),
  destinationLot: one(inventoryLots, {
    fields: [transferOrderItemLots.destinationLotId],
    references: [inventoryLots.id],
    relationName: 'transferDestinationLot',
  }),
}));
