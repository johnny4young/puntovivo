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
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import {
  initialInventoryModeEnum,
  lotStatusEnum,
  moneyPositiveChecks,
  movementTypeEnum,
  nowIso,
  sqliteNow,
  syncStatusEnum,
} from './base.js';
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
    uniqueIndex('idx_inventory_balances_scope').on(table.tenantId, table.siteId, table.productId),
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
// PRODUCT STOCK TOTALS (ENG-197 — materialized tenant-wide rollup)
// ============================================================================

/**
 * ENG-197 — materialized `Σ(inventory_balances.on_hand)` per (tenant, product).
 *
 * Maintained EXCLUSIVELY by the SQLite triggers shipped in migration
 * `0008_product_stock_totals` (`trg_pst_balance_insert` / `_update` /
 * `_delete` on `inventory_balances`) — application code must NEVER write this
 * table. The storage layer owns the invariant `total ≡ Σ(on_hand)` so every
 * writer (apply-delta, transfers, seeds, test fixtures, future code) is
 * covered without app-side hooks; `inventory-stock-rollup.test.ts` pins the
 * parity under a storm of real operations. Readers go through
 * `services/inventory-balances/derive.ts`, whose API predates this table.
 *
 * Note: drizzle-kit does not manage triggers — they live only in the 0008
 * migration (hand-appended, idempotent). Migrations are append-only, so a
 * future `db:generate` cannot drop them.
 */
export const productStockTotals = sqliteTable(
  'product_stock_totals',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Tenant-wide on-hand total in base units (3-decimal quantity, not money). */
    total: real('total').notNull().default(0),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    primaryKey({ columns: [table.tenantId, table.productId] }),
    index('idx_product_stock_totals_tenant').on(table.tenantId),
  ]
);

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

// ============================================================================
// INVENTORY LOTS (Auditoría 2026-07 — lots, expiry & costing)
// ============================================================================

/**
 * A lot is a received batch of a product held at a site, carrying its own
 * expiry date and unit cost. Lots are the substrate for FEFO
 * (first-expired-first-out) consumption, expiry alerts, recalls, and
 * auditable COGS (each lot is a cost layer). Opt-in per product via
 * `products.tracks_lots`; products that do not track lots keep the existing
 * single-number stock path untouched.
 *
 * Quantities and cost are per BASE unit, matching `inventory_balances` and
 * `sale_items.normalizedQuantity`, so a lot's `on_hand` is directly
 * comparable to a balance's `on_hand`.
 */
export const inventoryLots = sqliteTable(
  'inventory_lots',
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
    /** Operator/supplier batch code. Unique per (tenant, site, product). */
    lotNumber: text('lot_number').notNull(),
    /** ISO date; null for a non-perishable lot (never FEFO-prioritised by date). */
    expiresAt: text('expires_at'),
    /** Remaining quantity in base units. */
    onHand: real('on_hand').notNull().default(0),
    /** Cost per base unit for this lot — the COGS layer. */
    unitCost: real('unit_cost').notNull().default(0),
    status: text('status', { enum: lotStatusEnum }).notNull().default('active'),
    receivedAt: text('received_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    notes: text('notes'),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_inventory_lots_tenant').on(table.tenantId),
    index('idx_inventory_lots_site').on(table.siteId),
    index('idx_inventory_lots_product').on(table.productId),
    // FEFO scan: within a (tenant, site, product) pick active lots ordered
    // by expiry then receipt.
    index('idx_inventory_lots_fefo').on(
      table.tenantId,
      table.siteId,
      table.productId,
      table.expiresAt
    ),
    // Expiry-alert scan across the tenant.
    index('idx_inventory_lots_expires').on(table.tenantId, table.expiresAt),
    // One row per physical batch at a site.
    uniqueIndex('idx_inventory_lots_scope').on(
      table.tenantId,
      table.siteId,
      table.productId,
      table.lotNumber
    ),
    ...moneyPositiveChecks('inventory_lots_unit_cost', table.unitCost),
  ]
);

export const inventoryLotsRelations = relations(inventoryLots, ({ one }) => ({
  tenant: one(tenants, {
    fields: [inventoryLots.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [inventoryLots.siteId],
    references: [sites.id],
  }),
  product: one(products, {
    fields: [inventoryLots.productId],
    references: [products.id],
  }),
}));

// ============================================================================
// PRICE SUGGESTIONS (ENG-199 — expiry radar)
// ============================================================================

/** Why a suggestion exists. v1 only emits `expiry` (radar de vencimientos);
 * the enum leaves room for future sources (overstock, slow movers). */
export const priceSuggestionReasonEnum = ['expiry'] as const;

/** Lifecycle: `active` suggestions surface in the POS badge and the radar;
 * `dismissed` keeps the row for audit but hides it everywhere. There is no
 * `expired` state on purpose — read-side filtering hides a suggestion once
 * its lot depletes or passes its expiry date, so no sweeper is needed. */
export const priceSuggestionStatusEnum = ['active', 'dismissed'] as const;

/**
 * A discount suggestion recorded from the expiry radar (ENG-199 / WC-C3).
 * One row per accepted CTA: the manager saw a lot expiring soon and accepted
 * the deterministic tier discount (see EXPIRY_DISCOUNT_TIERS in
 * services/price-suggestions.ts). The POS reads active rows to badge the
 * product ("sugerido -20%"); v2 (WC-D1 price lists) will consume this same
 * table to turn suggestions into real promos.
 */
export const priceSuggestions = sqliteTable(
  'price_suggestions',
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
    lotId: text('lot_id')
      .notNull()
      .references(() => inventoryLots.id, { onDelete: 'cascade' }),
    /** Whole-percent discount (e.g. 30 for -30%), from the expiry tiers. */
    discountPct: integer('discount_pct').notNull(),
    reason: text('reason', { enum: priceSuggestionReasonEnum }).notNull().default('expiry'),
    /** Snapshot of the lot's expiry at suggestion time (display + filtering
     * survive later lot edits). */
    lotExpiresAt: text('lot_expires_at'),
    status: text('status', { enum: priceSuggestionStatusEnum }).notNull().default('active'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_price_suggestions_tenant_status').on(table.tenantId, table.status),
    index('idx_price_suggestions_tenant_product').on(table.tenantId, table.productId),
    // One ACTIVE suggestion per lot — the race-safe duplicate guard behind
    // the radar CTA (dismissed rows do not block a re-suggest).
    uniqueIndex('idx_price_suggestions_active_lot')
      .on(table.tenantId, table.lotId)
      .where(sql`${table.status} = 'active'`),
  ]
);

export const priceSuggestionsRelations = relations(priceSuggestions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [priceSuggestions.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [priceSuggestions.siteId],
    references: [sites.id],
  }),
  product: one(products, {
    fields: [priceSuggestions.productId],
    references: [products.id],
  }),
  lot: one(inventoryLots, {
    fields: [priceSuggestions.lotId],
    references: [inventoryLots.id],
  }),
}));
