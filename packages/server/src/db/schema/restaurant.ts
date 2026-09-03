/**
 * Drizzle schema for the normalized restaurant service model.
 *
 * `sales` remains the fiscal/inventory/payment aggregate. These tables add the
 * operational structure a dining-room workflow needs without overloading a
 * sale row: one open service per physical table, one or more independent
 * checks, optional diners, submitted rounds, courses and frozen modifiers.
 *
 * @module db/schema/restaurant
 */
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
import { moneyTwoDecimalCheck, nowIso, sqliteNow } from './base.js';
import { sites, tenants, users } from './auth.js';
import { sales } from './sales.js';
import { restaurantTables, saleItems } from './salesAux.js';

/** Lifecycle state for one table visit; terminal states carry closure metadata. */
export const restaurantServiceStatusEnum = ['open', 'closed', 'cancelled'] as const;
/** Union derived from {@link restaurantServiceStatusEnum}. */
export type RestaurantServiceStatus = (typeof restaurantServiceStatusEnum)[number];

/** Lifecycle state for one independently payable check. */
export const restaurantCheckStatusEnum = ['open', 'settled', 'cancelled'] as const;
/** Union derived from {@link restaurantCheckStatusEnum}. */
export type RestaurantCheckStatus = (typeof restaurantCheckStatusEnum)[number];

/** Preparation state for an immutable submitted batch of check lines. */
export const restaurantRoundStatusEnum = ['open', 'submitted', 'voided'] as const;
/** Union derived from {@link restaurantRoundStatusEnum}. */
export type RestaurantRoundStatus = (typeof restaurantRoundStatusEnum)[number];

/** Stable course identifiers shared by persistence, API contracts and UI copy. */
export const restaurantCourseKeyEnum = ['starter', 'main', 'dessert', 'drink', 'other'] as const;
/** Union derived from {@link restaurantCourseKeyEnum}. */
export type RestaurantCourseKey = (typeof restaurantCourseKeyEnum)[number];

/** One contiguous visit at a physical table. */
export const restaurantServices = sqliteTable(
  'restaurant_services',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    tableId: text('table_id')
      .notNull()
      .references(() => restaurantTables.id, { onDelete: 'restrict' }),
    status: text('status', { enum: restaurantServiceStatusEnum }).notNull().default('open'),
    /** Null only on migration-backfilled legacy drafts whose party size is unknowable. */
    guestCount: integer('guest_count'),
    openedBy: text('opened_by')
      .notNull()
      .references(() => users.id),
    openedAt: text('opened_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    closedBy: text('closed_by').references(() => users.id),
    closedAt: text('closed_at'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_restaurant_services_tenant_site_status').on(
      table.tenantId,
      table.siteId,
      table.status
    ),
    index('idx_restaurant_services_tenant_table').on(table.tenantId, table.tableId),
    uniqueIndex('idx_restaurant_services_one_open_per_table')
      .on(table.tenantId, table.tableId)
      .where(sql`${table.status} = 'open'`),
    check(
      'chk_restaurant_services_guest_count',
      sql`${table.guestCount} IS NULL OR (${table.guestCount} BETWEEN 1 AND 200)`
    ),
    check(
      'chk_restaurant_services_status',
      sql`${table.status} IN ('open', 'closed', 'cancelled')`
    ),
    check('chk_restaurant_services_version', sql`${table.version} >= 1`),
    check(
      'chk_restaurant_services_close_shape',
      sql`(${table.status} = 'open' AND ${table.closedAt} IS NULL AND ${table.closedBy} IS NULL) OR (${table.status} != 'open' AND ${table.closedAt} IS NOT NULL AND ${table.closedBy} IS NOT NULL)`
    ),
  ]
);

/** One payable account within a service; a table may expose many simultaneously. */
export const restaurantChecks = sqliteTable(
  'restaurant_checks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    serviceId: text('service_id')
      .notNull()
      .references(() => restaurantServices.id, { onDelete: 'restrict' }),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'restrict' }),
    label: text('label'),
    status: text('status', { enum: restaurantCheckStatusEnum }).notNull().default('open'),
    openedBy: text('opened_by')
      .notNull()
      .references(() => users.id),
    openedAt: text('opened_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    closedBy: text('closed_by').references(() => users.id),
    closedAt: text('closed_at'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_restaurant_checks_tenant_sale').on(table.tenantId, table.saleId),
    index('idx_restaurant_checks_tenant_service_status').on(
      table.tenantId,
      table.serviceId,
      table.status
    ),
    check('chk_restaurant_checks_status', sql`${table.status} IN ('open', 'settled', 'cancelled')`),
    check('chk_restaurant_checks_version', sql`${table.version} >= 1`),
    check(
      'chk_restaurant_checks_close_shape',
      sql`(${table.status} = 'open' AND ${table.closedAt} IS NULL AND ${table.closedBy} IS NULL) OR (${table.status} != 'open' AND ${table.closedAt} IS NOT NULL AND ${table.closedBy} IS NOT NULL)`
    ),
  ]
);

/** Optional named/numbered diner within a service. */
export const restaurantDiners = sqliteTable(
  'restaurant_diners',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    serviceId: text('service_id')
      .notNull()
      .references(() => restaurantServices.id, { onDelete: 'cascade' }),
    label: text('label'),
    seatNumber: integer('seat_number'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_restaurant_diners_tenant_service').on(table.tenantId, table.serviceId),
    uniqueIndex('idx_restaurant_diners_service_seat')
      .on(table.serviceId, table.seatNumber)
      .where(sql`${table.seatNumber} IS NOT NULL`),
    check(
      'chk_restaurant_diners_seat',
      sql`${table.seatNumber} IS NULL OR (${table.seatNumber} BETWEEN 1 AND 200)`
    ),
  ]
);

/** Ordered preparation course frozen on a check. */
export const restaurantCourses = sqliteTable(
  'restaurant_courses',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    checkId: text('check_id')
      .notNull()
      .references(() => restaurantChecks.id, { onDelete: 'cascade' }),
    courseKey: text('course_key', { enum: restaurantCourseKeyEnum }).notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_restaurant_courses_tenant_check').on(table.tenantId, table.checkId),
    uniqueIndex('idx_restaurant_courses_check_key').on(table.checkId, table.courseKey),
    uniqueIndex('idx_restaurant_courses_check_position').on(table.checkId, table.position),
    check(
      'chk_restaurant_courses_key',
      sql`${table.courseKey} IN ('starter', 'main', 'dessert', 'drink', 'other')`
    ),
    check('chk_restaurant_courses_position', sql`${table.position} BETWEEN 0 AND 20`),
  ]
);

/** Immutable batch of lines submitted together. */
export const restaurantRounds = sqliteTable(
  'restaurant_rounds',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    checkId: text('check_id')
      .notNull()
      .references(() => restaurantChecks.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    label: text('label'),
    status: text('status', { enum: restaurantRoundStatusEnum }).notNull().default('submitted'),
    submittedBy: text('submitted_by')
      .notNull()
      .references(() => users.id),
    submittedAt: text('submitted_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_restaurant_rounds_tenant_check').on(table.tenantId, table.checkId),
    uniqueIndex('idx_restaurant_rounds_check_sequence').on(table.checkId, table.sequence),
    check('chk_restaurant_rounds_status', sql`${table.status} IN ('open', 'submitted', 'voided')`),
    check('chk_restaurant_rounds_sequence', sql`${table.sequence} >= 1`),
  ]
);

/** Operational metadata for one frozen sale line. */
export const restaurantCheckLines = sqliteTable(
  'restaurant_check_lines',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    checkId: text('check_id')
      .notNull()
      .references(() => restaurantChecks.id, { onDelete: 'cascade' }),
    saleItemId: text('sale_item_id')
      .notNull()
      .references(() => saleItems.id, { onDelete: 'restrict' }),
    roundId: text('round_id').references(() => restaurantRounds.id, { onDelete: 'set null' }),
    courseId: text('course_id').references(() => restaurantCourses.id, { onDelete: 'set null' }),
    dinerId: text('diner_id').references(() => restaurantDiners.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_restaurant_check_lines_tenant_sale_item').on(table.tenantId, table.saleItemId),
    index('idx_restaurant_check_lines_tenant_check').on(table.tenantId, table.checkId),
    index('idx_restaurant_check_lines_round').on(table.roundId),
  ]
);

/** Frozen, non-negative line modifier; pricing is already included in sale_items.unit_price. */
export const restaurantLineModifiers = sqliteTable(
  'restaurant_line_modifiers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    checkLineId: text('check_line_id')
      .notNull()
      .references(() => restaurantCheckLines.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPriceDelta: real('unit_price_delta').notNull().default(0),
    position: integer('position').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_restaurant_modifiers_tenant_line').on(table.tenantId, table.checkLineId),
    uniqueIndex('idx_restaurant_modifiers_line_position').on(table.checkLineId, table.position),
    check('chk_restaurant_modifiers_quantity', sql`${table.quantity} BETWEEN 1 AND 20`),
    check('chk_restaurant_modifiers_price', sql`${table.unitPriceDelta} >= 0`),
    moneyTwoDecimalCheck('restaurant_modifiers_price', table.unitPriceDelta),
    check('chk_restaurant_modifiers_position', sql`${table.position} BETWEEN 0 AND 19`),
  ]
);

export const restaurantServicesRelations = relations(restaurantServices, ({ one, many }) => ({
  tenant: one(tenants, { fields: [restaurantServices.tenantId], references: [tenants.id] }),
  site: one(sites, { fields: [restaurantServices.siteId], references: [sites.id] }),
  table: one(restaurantTables, {
    fields: [restaurantServices.tableId],
    references: [restaurantTables.id],
  }),
  checks: many(restaurantChecks),
  diners: many(restaurantDiners),
}));

export const restaurantChecksRelations = relations(restaurantChecks, ({ one, many }) => ({
  service: one(restaurantServices, {
    fields: [restaurantChecks.serviceId],
    references: [restaurantServices.id],
  }),
  sale: one(sales, { fields: [restaurantChecks.saleId], references: [sales.id] }),
  rounds: many(restaurantRounds),
  courses: many(restaurantCourses),
  lines: many(restaurantCheckLines),
}));

/** Persisted row for one tenant- and site-scoped table visit. */
export type RestaurantServiceRow = typeof restaurantServices.$inferSelect;
/** Persisted row linking one payable sale draft to a restaurant service. */
export type RestaurantCheckRow = typeof restaurantChecks.$inferSelect;
/** Persisted optional guest identity scoped to one service. */
export type RestaurantDinerRow = typeof restaurantDiners.$inferSelect;
/** Persisted preparation course scoped to one check. */
export type RestaurantCourseRow = typeof restaurantCourses.$inferSelect;
/** Persisted immutable submission batch scoped to one check. */
export type RestaurantRoundRow = typeof restaurantRounds.$inferSelect;
/** Persisted relationship between a sale item and its operational restaurant metadata. */
export type RestaurantCheckLineRow = typeof restaurantCheckLines.$inferSelect;
/** Persisted frozen modifier whose delta is already included in the sale-item price. */
export type RestaurantLineModifierRow = typeof restaurantLineModifiers.$inferSelect;
