/** Versioned promotion rules and immutable sale-line application snapshots. */
import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { nowIso, sqliteNow } from './base.js';
import { tenants, sites, users } from './auth.js';
import { categories } from './catalogs.js';
import { customers } from './customers.js';
import { products } from './products.js';
import { saleItems } from './salesAux.js';

export const promotionStatusEnum = ['draft', 'active', 'paused', 'archived'] as const;
export const promotionSourceEnum = ['manual', 'expiry'] as const;

/**
 * Nullable targets combine with AND semantics. Product and category are
 * mutually exclusive; null for both means every product. A null site/customer
 * is tenant-wide. Rules never mutate a cart merely by existing: only `active`
 * rows participate in the authoritative checkout quote.
 */
export const promotions = sqliteTable(
  'promotions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    status: text('status', { enum: promotionStatusEnum }).notNull().default('draft'),
    discountPct: real('discount_pct').notNull(),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'restrict' }),
    productId: text('product_id').references(() => products.id, { onDelete: 'restrict' }),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    customerId: text('customer_id').references(() => customers.id, { onDelete: 'restrict' }),
    minQuantity: real('min_quantity').notNull().default(1),
    startsAt: text('starts_at'),
    endsAt: text('ends_at'),
    priority: integer('priority').notNull().default(0),
    combinable: integer('combinable', { mode: 'boolean' }).notNull().default(false),
    source: text('source', { enum: promotionSourceEnum }).notNull().default('manual'),
    sourcePriceSuggestionId: text('source_price_suggestion_id'),
    sourceLotId: text('source_lot_id'),
    version: integer('version').notNull().default(1),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_promotions_tenant_status_window').on(
      table.tenantId,
      table.status,
      table.startsAt,
      table.endsAt
    ),
    index('idx_promotions_tenant_product').on(table.tenantId, table.productId),
    index('idx_promotions_tenant_category').on(table.tenantId, table.categoryId),
    index('idx_promotions_tenant_customer').on(table.tenantId, table.customerId),
    uniqueIndex('idx_promotions_expiry_suggestion')
      .on(table.tenantId, table.sourcePriceSuggestionId)
      .where(sql`${table.source} = 'expiry' and ${table.sourcePriceSuggestionId} is not null`),
    check('chk_promotions_discount', sql`${table.discountPct} > 0 AND ${table.discountPct} <= 100`),
    check('chk_promotions_min_quantity', sql`${table.minQuantity} > 0`),
    check(
      'chk_promotions_target_kind',
      sql`${table.productId} IS NULL OR ${table.categoryId} IS NULL`
    ),
    check(
      'chk_promotions_window',
      sql`${table.startsAt} IS NULL OR ${table.endsAt} IS NULL OR ${table.startsAt} < ${table.endsAt}`
    ),
    check('chk_promotions_version', sql`${table.version} > 0`),
    check(
      'chk_promotions_expiry_source',
      sql`${table.source} <> 'expiry' OR (${table.sourcePriceSuggestionId} IS NOT NULL AND ${table.sourceLotId} IS NOT NULL AND ${table.productId} IS NOT NULL AND ${table.siteId} IS NOT NULL)`
    ),
  ]
);

/** Exact promotion evidence frozen on a completed sale line. */
export const saleItemPromotions = sqliteTable(
  'sale_item_promotions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleItemId: text('sale_item_id')
      .notNull()
      .references(() => saleItems.id, { onDelete: 'cascade' }),
    promotionId: text('promotion_id')
      .notNull()
      .references(() => promotions.id, { onDelete: 'restrict' }),
    promotionVersion: integer('promotion_version').notNull(),
    nameSnapshot: text('name_snapshot').notNull(),
    discountPct: real('discount_pct').notNull(),
    discountAmount: real('discount_amount').notNull(),
    priority: integer('priority').notNull(),
    combinable: integer('combinable', { mode: 'boolean' }).notNull(),
    position: integer('position').notNull(),
    source: text('source', { enum: promotionSourceEnum }).notNull(),
    sourceLotId: text('source_lot_id'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_sale_item_promotions_tenant_line').on(table.tenantId, table.saleItemId),
    uniqueIndex('idx_sale_item_promotions_line_position').on(table.saleItemId, table.position),
    uniqueIndex('idx_sale_item_promotions_line_rule').on(table.saleItemId, table.promotionId),
    check(
      'chk_sale_item_promotions_discount_pct',
      sql`${table.discountPct} > 0 AND ${table.discountPct} <= 100`
    ),
    check(
      'chk_sale_item_promotions_discount_amount',
      sql`${table.discountAmount} >= 0 AND round(${table.discountAmount}, 2) = ${table.discountAmount}`
    ),
    check('chk_sale_item_promotions_position', sql`${table.position} >= 0`),
    check('chk_sale_item_promotions_version', sql`${table.promotionVersion} > 0`),
  ]
);

export const promotionsRelations = relations(promotions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [promotions.tenantId], references: [tenants.id] }),
  site: one(sites, { fields: [promotions.siteId], references: [sites.id] }),
  product: one(products, { fields: [promotions.productId], references: [products.id] }),
  category: one(categories, { fields: [promotions.categoryId], references: [categories.id] }),
  customer: one(customers, { fields: [promotions.customerId], references: [customers.id] }),
  applications: many(saleItemPromotions),
}));

export const saleItemPromotionsRelations = relations(saleItemPromotions, ({ one }) => ({
  promotion: one(promotions, {
    fields: [saleItemPromotions.promotionId],
    references: [promotions.id],
  }),
  saleItem: one(saleItems, {
    fields: [saleItemPromotions.saleItemId],
    references: [saleItems.id],
  }),
}));

export type Promotion = typeof promotions.$inferSelect;
export type SaleItemPromotion = typeof saleItemPromotions.$inferSelect;
