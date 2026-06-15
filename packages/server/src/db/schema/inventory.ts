/**
 * Drizzle schema — inventory domain.
 *
 * ENG-178 — relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/inventory
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { initialInventoryModeEnum, moneyPositiveChecks, movementTypeEnum, nowIso, sqliteNow, syncStatusEnum } from './base.js';
import { sites, tenants, users } from './auth.js';
import { units } from './catalogs.js';
import { products } from './products.js';

// ============================================================================
// INVENTORY MOVEMENTS
// ============================================================================

/** An inventory movement is the auditable stock ledger entry that explains why a product's quantity changed. */
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
    // Phase 1 DB-050: movements store real quantities (2.5 m, 0.75 kg, …).
    quantity: real('quantity').notNull(),
    previousStock: real('previous_stock').notNull(),
    newStock: real('new_stock').notNull(),
    reference: text('reference'),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    // Sync fields
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_inventory_tenant').on(table.tenantId),
    index('idx_inventory_product').on(table.productId),
    index('idx_inventory_created_by').on(table.createdBy),
    // ENG-175 — traceability listings filter by tenant + order by date.
    index('idx_inventory_movements_tenant_created').on(table.tenantId, table.createdAt),
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
// INITIAL INVENTORY
// ============================================================================

/** An initial inventory entry captures opening stock or physical count adjustments used to establish or reconcile stock balances. */
export const initialInventory = sqliteTable(
  'initial_inventory',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    siteId: text('site_id').references(() => sites.id),
    mode: text('mode', { enum: initialInventoryModeEnum }).notNull(),
    quantity: real('quantity').notNull(),
    unitEquivalence: real('unit_equivalence').notNull().default(1),
    normalizedQuantity: real('normalized_quantity').notNull(),
    cost: real('cost').notNull().default(0),
    previousStock: real('previous_stock').notNull(),
    newStock: real('new_stock').notNull(),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_initial_inventory_tenant').on(table.tenantId),
    index('idx_initial_inventory_product').on(table.productId),
    index('idx_initial_inventory_unit').on(table.unitId),
    index('idx_initial_inventory_site').on(table.siteId),
    index('idx_initial_inventory_created_by').on(table.createdBy),
    // ENG-176a — opening cost is always positive.
    ...moneyPositiveChecks('initial_inventory_cost', table.cost),
  ]
);

export const initialInventoryRelations = relations(initialInventory, ({ one }) => ({
  tenant: one(tenants, {
    fields: [initialInventory.tenantId],
    references: [tenants.id],
  }),
  product: one(products, {
    fields: [initialInventory.productId],
    references: [products.id],
  }),
  unit: one(units, {
    fields: [initialInventory.unitId],
    references: [units.id],
  }),
  site: one(sites, {
    fields: [initialInventory.siteId],
    references: [sites.id],
  }),
  createdByUser: one(users, {
    fields: [initialInventory.createdBy],
    references: [users.id],
  }),
}));

// ============================================================================
// INVENTORY BALANCES (Phase 2 DB-101)
// ============================================================================

/**
 * An inventory balance is the on-hand stock attributed to a specific site for a
 * product. Phase 2 step 0 introduced the (site, product) grain; step 1 made
 * the row authoritative — `transfers.create` is the first write path that
 * mutates it. A future step will add location-level granularity and an
 * in-transit / reserved column for the full transfer lifecycle.
 */
export const inventoryBalances = sqliteTable(
  'inventory_balances',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    onHand: real('on_hand').notNull().default(0),
    reserved: real('reserved').notNull().default(0),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_inventory_balances_tenant').on(table.tenantId),
    index('idx_inventory_balances_site').on(table.siteId),
    index('idx_inventory_balances_product').on(table.productId),
    uniqueIndex('idx_inventory_balances_scope').on(
      table.tenantId,
      table.siteId,
      table.productId
    ),
  ]
);

export const inventoryBalancesRelations = relations(inventoryBalances, ({ one }) => ({
  tenant: one(tenants, {
    fields: [inventoryBalances.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [inventoryBalances.siteId],
    references: [sites.id],
  }),
  product: one(products, {
    fields: [inventoryBalances.productId],
    references: [products.id],
  }),
}));

// ============================================================================
// TRANSFER ORDERS (Phase 2 DB-102 — immediate step, no ship/receive lifecycle)
// ============================================================================

export const transferOrderStatusEnum = ['completed', 'in_transit', 'void'] as const;

/**
 * A transfer order captures a cross-site stock movement. Phase 2 step 1
 * shipped the immediate `completed` transfer (create + ship + receive
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
    // Phase 2 API-102 step 3: receipt metadata for the in_transit → completed
    // transition. Null on immediate transfers that skip the deferred window.
    receivedAt: text('received_at'),
    receivedBy: text('received_by').references(() => users.id),
    // Phase 2 UI-103: optional note captured by the receiver when they record
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
    // Phase 2 UI-103: what the destination actually received. Null for legacy
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
