/**
 * Drizzle schema — realtime domain.
 *
 * relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/realtime
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
import { nowIso, sqliteNow } from './base.js';
import { sites, tenants, users } from './auth.js';
import { sales } from './sales.js';
import { restaurantTables } from './salesAux.js';

// ============================================================================
// KDS ORDERS ()
// ============================================================================

export const kdsOrderStatusEnum = ['pending', 'ready'] as const;

/**
 * kitchen display queue.
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
    index('idx_kds_orders_tenant_site_status').on(table.tenantId, table.siteId, table.status),
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
// WEB VITALS RUM (real-user monitoring)
// ============================================================================

/** Core Web Vitals + supporting metrics captured once per page load. */
export const webVitalMetricEnum = ['LCP', 'CLS', 'INP', 'TTFB', 'FCP'] as const;
/** `web-vitals` library rating buckets, stored verbatim from the client. */
export const webVitalRatingEnum = ['good', 'needs-improvement', 'poor'] as const;
/** Coarse device tier derived client-side from `navigator.hardwareConcurrency`. */
export const webVitalDeviceClassEnum = ['low', 'mid', 'high', 'unknown'] as const;

/**
 * Web Vitals real-user monitoring (RUM) samples.
 *
 * One row per metric per sampled page load, written by the public
 * `observability.reportWebVital` mutation so login / first-paint vitals are
 * captured before authentication.
 *
 * Invariants:
 * - `tenantId` is nullable on purpose — anonymous (pre-login) page loads carry
 * no tenant. It is ALWAYS derived server-side from the session, never from
 * client input (a public mutation must not trust a client-supplied tenant).
 * - `tenantPlan` is a forward-looking placeholder fixed to `'unknown'` until a
 * billing tier concept lands (); the column exists now so the future
 * aggregation dashboard can slice by plan without a schema change.
 * - The table is write-optimised; the `(tenant_id, metric, created_at)` index
 * keeps the future per-tenant median / p95 queries cheap.
 */
export const webVitalSamples = sqliteTable(
  'web_vital_samples',
  {
    id: text('id').primaryKey(),
    // nullable: anonymous (pre-login) page loads have no tenant.
    tenantId: text('tenant_id').references(() => tenants.id),
    // /  — placeholder tier until billing ships.
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

// ============================================================================
// PRIVACY-SAFE TASK MEASUREMENT
// ============================================================================

/**
 * Fixed task vocabulary for aggregate usability measurement.
 *
 * The client cannot send arbitrary event names or business identifiers. A
 * versioned, allowlisted task keeps longitudinal measurements comparable while
 * preventing product, customer, payment, sale, site, or free-text content from
 * entering this table.
 */
export const taskMeasurementTaskEnum = [
  'complete_sale',
  'create_product',
  'close_day',
  'receive_stock',
  'recover_operation',
] as const;
export const taskMeasurementRouteEnum = [
  '/sales',
  '/products',
  '/day-close',
  '/purchases',
  '/operations',
] as const;
export const taskMeasurementOutcomeEnum = ['success', 'abandoned', 'failed'] as const;
export const taskMeasurementRecoveryOutcomeEnum = [
  'not_needed',
  'succeeded',
  'failed',
  'abandoned',
] as const;

/**
 * One aggregate row per sampled task attempt.
 *
 * Privacy invariants:
 * - tenant identity is derived from the authenticated server context;
 * - no user, site, product, customer, payment, sale, query, error, or notes
 *   column exists;
 * - task and route are fixed enums rather than client-authored strings;
 * - timings are integer milliseconds and hardware is a coarse device bucket.
 *
 * The count/timing checks are duplicated by the Zod input contract so direct
 * SQL writes cannot silently create impossible negative samples.
 */
export const taskMeasurementSamples = sqliteTable(
  'task_measurement_samples',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    task: text('task', { enum: taskMeasurementTaskEnum }).notNull(),
    route: text('route', { enum: taskMeasurementRouteEnum }).notNull(),
    taskVersion: integer('task_version').notNull().default(1),
    outcome: text('outcome', { enum: taskMeasurementOutcomeEnum }).notNull(),
    recoveryOutcome: text('recovery_outcome', {
      enum: taskMeasurementRecoveryOutcomeEnum,
    })
      .notNull()
      .default('not_needed'),
    deviceClass: text('device_class', { enum: webVitalDeviceClassEnum }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    timeToFirstUsableControlMs: integer('time_to_first_usable_control_ms'),
    timeToFirstProgressMs: integer('time_to_first_progress_ms'),
    interactionsToFirstProgress: integer('interactions_to_first_progress'),
    interactionCount: integer('interaction_count').notNull().default(0),
    backtrackCount: integer('backtrack_count').notNull().default(0),
    validationErrorCount: integer('validation_error_count').notNull().default(0),
    recoveryAttemptCount: integer('recovery_attempt_count').notNull().default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_task_measurement_samples_tenant_task_created').on(
      table.tenantId,
      table.task,
      table.createdAt
    ),
    index('idx_task_measurement_samples_tenant_route_created').on(
      table.tenantId,
      table.route,
      table.createdAt
    ),
    check(
      'chk_task_measurement_samples_task_version',
      sql`${table.taskVersion} >= 1 AND ${table.taskVersion} <= 1000`
    ),
    check(
      'chk_task_measurement_samples_task',
      sql`${table.task} IN ('complete_sale', 'create_product', 'close_day', 'receive_stock', 'recover_operation')`
    ),
    check(
      'chk_task_measurement_samples_route',
      sql`${table.route} IN ('/sales', '/products', '/day-close', '/purchases', '/operations')`
    ),
    check(
      'chk_task_measurement_samples_task_route',
      sql`(${table.task} = 'complete_sale' AND ${table.route} = '/sales')
        OR (${table.task} = 'create_product' AND ${table.route} = '/products')
        OR (${table.task} = 'close_day' AND ${table.route} = '/day-close')
        OR (${table.task} = 'receive_stock' AND ${table.route} = '/purchases')
        OR (${table.task} = 'recover_operation' AND ${table.route} = '/operations')`
    ),
    check(
      'chk_task_measurement_samples_outcome',
      sql`${table.outcome} IN ('success', 'abandoned', 'failed')`
    ),
    check(
      'chk_task_measurement_samples_recovery_outcome',
      sql`${table.recoveryOutcome} IN ('not_needed', 'succeeded', 'failed', 'abandoned')`
    ),
    check(
      'chk_task_measurement_samples_device_class',
      sql`${table.deviceClass} IN ('low', 'mid', 'high', 'unknown')`
    ),
    check(
      'chk_task_measurement_samples_recovery_consistency',
      sql`(${table.recoveryAttemptCount} = 0 AND ${table.recoveryOutcome} = 'not_needed')
        OR (${table.recoveryAttemptCount} > 0 AND ${table.recoveryOutcome} <> 'not_needed')`
    ),
    check(
      'chk_task_measurement_samples_duration',
      sql`${table.durationMs} >= 0 AND ${table.durationMs} <= 86400000`
    ),
    check(
      'chk_task_measurement_samples_usable_timing',
      sql`${table.timeToFirstUsableControlMs} IS NULL OR (${table.timeToFirstUsableControlMs} >= 0 AND ${table.timeToFirstUsableControlMs} <= ${table.durationMs})`
    ),
    check(
      'chk_task_measurement_samples_progress_timing',
      sql`${table.timeToFirstProgressMs} IS NULL OR (${table.timeToFirstProgressMs} >= 0 AND ${table.timeToFirstProgressMs} <= ${table.durationMs})`
    ),
    check(
      'chk_task_measurement_samples_first_progress_consistency',
      sql`(${table.timeToFirstProgressMs} IS NULL AND ${table.interactionsToFirstProgress} IS NULL)
        OR (${table.timeToFirstProgressMs} IS NOT NULL
          AND ${table.interactionsToFirstProgress} IS NOT NULL
          AND ${table.interactionsToFirstProgress} >= 0
          AND ${table.interactionsToFirstProgress} <= ${table.interactionCount})`
    ),
    check(
      'chk_task_measurement_samples_counts',
      sql`${table.interactionCount} >= 0 AND ${table.interactionCount} <= 100000
        AND ${table.backtrackCount} >= 0 AND ${table.backtrackCount} <= 100000
        AND ${table.validationErrorCount} >= 0 AND ${table.validationErrorCount} <= 100000
        AND ${table.recoveryAttemptCount} >= 0 AND ${table.recoveryAttemptCount} <= 100000`
    ),
  ]
);

export type TaskMeasurementTask = (typeof taskMeasurementTaskEnum)[number];
export type TaskMeasurementRoute = (typeof taskMeasurementRouteEnum)[number];
export type TaskMeasurementOutcome = (typeof taskMeasurementOutcomeEnum)[number];
export type TaskMeasurementRecoveryOutcome = (typeof taskMeasurementRecoveryOutcomeEnum)[number];
export type TaskMeasurementSampleRow = typeof taskMeasurementSamples.$inferSelect;
export type NewTaskMeasurementSampleRow = typeof taskMeasurementSamples.$inferInsert;
