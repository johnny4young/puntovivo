/**
 * lot costing, expiry, and price-suggestion schema.
 *
 * @module db/schema/inventory/lots
 */

import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { lotStatusEnum, moneyPositiveChecks, nowIso, sqliteNow, syncStatusEnum } from '../base.js';
import { sites, tenants, users } from '../auth.js';
import { products } from '../products.js';

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
// PRICE SUGGESTIONS (expiry radar)
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
 * A discount suggestion recorded from the expiry radar ( / ).
 * One row per accepted CTA: the manager saw a lot expiring soon and accepted
 * the deterministic tier discount (see EXPIRY_DISCOUNT_TIERS in
 * services/price-suggestions.ts). The POS reads active rows to badge the
 * product ("sugerido -20%"); v2 ( price lists) will consume this same
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
