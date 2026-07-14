/**
 * ENG-178 — inventory movements, opening stock, site balances, and stock rollups.
 *
 * @module db/schema/inventory/core
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
import { relations } from 'drizzle-orm';
import {
  initialInventoryModeEnum,
  moneyPositiveChecks,
  movementTypeEnum,
  nowIso,
  sqliteNow,
  syncStatusEnum,
} from '../base.js';
import { sites, tenants, users } from '../auth.js';
import { units } from '../catalogs.js';
import { products } from '../products.js';

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
