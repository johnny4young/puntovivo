/**
 * Drizzle schema — realtime domain.
 *
 * ENG-178 — relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/realtime
 */
import { index, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { nowIso, sqliteNow } from './base.js';
import { sites, tenants, users } from './auth.js';
import { sales } from './sales.js';
import { restaurantTables } from './salesAux.js';

// ============================================================================
// KDS ORDERS (ENG-098)
// ============================================================================

export const kdsOrderStatusEnum = ['pending', 'ready'] as const;

/**
 * ENG-098 — kitchen display queue.
 *
 * One row per (sale, station) pair, materialised from `sales` +
 * `sale_items` whenever a tabled draft is suspended or completed.
 * `items_json` is a frozen snapshot so the kitchen sees what the
 * waiter saved even after a split or table change rewrites it.
 *
 * UNIQUE(tenant_id, sale_id, station) makes enqueue idempotent
 * across the suspend → complete progression and against double
 * post-tx hook fires. The compound index on (tenant_id, site_id,
 * status) keeps the board read fast under hundreds of orders.
 */
export const kdsOrders = sqliteTable(
  'kds_orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    tableId: text('table_id').references(() => restaurantTables.id),
    tableLabel: text('table_label'),
    saleNumber: text('sale_number').notNull(),
    station: text('station').notNull().default('main'),
    itemsJson: text('items_json').notNull(),
    notes: text('notes'),
    status: text('status', { enum: kdsOrderStatusEnum }).notNull().default('pending'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    readyAt: text('ready_at'),
    readyByUserId: text('ready_by_user_id').references(() => users.id),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_kds_orders_unique_sale_station').on(
      table.tenantId,
      table.saleId,
      table.station
    ),
    index('idx_kds_orders_tenant_site_status').on(
      table.tenantId,
      table.siteId,
      table.status
    ),
  ]
);

export const kdsOrdersRelations = relations(kdsOrders, ({ one }) => ({
  tenant: one(tenants, {
    fields: [kdsOrders.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [kdsOrders.siteId],
    references: [sites.id],
  }),
  sale: one(sales, {
    fields: [kdsOrders.saleId],
    references: [sales.id],
  }),
  table: one(restaurantTables, {
    fields: [kdsOrders.tableId],
    references: [restaurantTables.id],
  }),
  readyBy: one(users, {
    fields: [kdsOrders.readyByUserId],
    references: [users.id],
  }),
}));

export type KdsOrderStatus = (typeof kdsOrderStatusEnum)[number];
export type KdsOrderRow = typeof kdsOrders.$inferSelect;
export type NewKdsOrderRow = typeof kdsOrders.$inferInsert;

// ============================================================================
// WEB VITALS RUM (ENG-173 — real-user monitoring)
// ============================================================================

/** Core Web Vitals + supporting metrics captured once per page load. */
export const webVitalMetricEnum = ['LCP', 'CLS', 'INP', 'TTFB', 'FCP'] as const;
/** `web-vitals` library rating buckets, stored verbatim from the client. */
export const webVitalRatingEnum = ['good', 'needs-improvement', 'poor'] as const;
/** Coarse device tier derived client-side from `navigator.hardwareConcurrency`. */
export const webVitalDeviceClassEnum = ['low', 'mid', 'high', 'unknown'] as const;

/**
 * ENG-173 — Web Vitals real-user monitoring (RUM) samples.
 *
 * One row per metric per sampled page load, written by the public
 * `observability.reportWebVital` mutation so login / first-paint vitals are
 * captured before authentication.
 *
 * Invariants:
 * - `tenantId` is nullable on purpose — anonymous (pre-login) page loads carry
 *   no tenant. It is ALWAYS derived server-side from the session, never from
 *   client input (a public mutation must not trust a client-supplied tenant).
 * - `tenantPlan` is a forward-looking placeholder fixed to `'unknown'` until a
 *   billing tier concept lands (ENG-138); the column exists now so the future
 *   aggregation dashboard can slice by plan without a schema change.
 * - The table is write-optimised; the `(tenant_id, metric, created_at)` index
 *   keeps the future per-tenant median / p95 queries cheap.
 */
export const webVitalSamples = sqliteTable(
  'web_vital_samples',
  {
    id: text('id').primaryKey(),
    // ENG-173 — nullable: anonymous (pre-login) page loads have no tenant.
    tenantId: text('tenant_id').references(() => tenants.id),
    // ENG-173 / ENG-138 — placeholder tier until billing ships.
    tenantPlan: text('tenant_plan').notNull().default('unknown'),
    route: text('route').notNull(),
    metric: text('metric', { enum: webVitalMetricEnum }).notNull(),
    value: real('value').notNull(),
    rating: text('rating', { enum: webVitalRatingEnum }).notNull(),
    deviceClass: text('device_class', { enum: webVitalDeviceClassEnum }).notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    // Future per-tenant median / p95 by metric over a time range.
    index('idx_web_vital_samples_tenant_metric_created').on(
      table.tenantId,
      table.metric,
      table.createdAt
    ),
    index('idx_web_vital_samples_metric_created').on(table.metric, table.createdAt),
    index('idx_web_vital_samples_route').on(table.route),
  ]
);

export type WebVitalMetric = (typeof webVitalMetricEnum)[number];
export type WebVitalRating = (typeof webVitalRatingEnum)[number];
export type WebVitalDeviceClass = (typeof webVitalDeviceClassEnum)[number];
export type WebVitalSampleRow = typeof webVitalSamples.$inferSelect;
export type NewWebVitalSampleRow = typeof webVitalSamples.$inferInsert;
