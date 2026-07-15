/**
 * Drizzle schema — labor/attendance domain.
 *
 * ENG-106b deliberately starts with the smallest durable attendance record:
 * one employee, one site, immutable clock-in time, and an optional clock-out
 * time. ENG-140a adds manager-authored scheduled shifts; breaks, overtime,
 * payroll, and attendance corrections remain in later ENG-140 slices.
 *
 * @module db/schema/labor
 */
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { sites, tenants, users } from './auth.js';
import { nowIso, sqliteNow } from './base.js';

export const employeeShifts = sqliteTable(
  'employee_shifts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    clockedInAt: text('clocked_in_at').notNull(),
    clockedOutAt: text('clocked_out_at'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_employee_shifts_tenant_user_clocked_in').on(
      table.tenantId,
      table.userId,
      table.clockedInAt
    ),
    index('idx_employee_shifts_tenant_site_clocked_in').on(
      table.tenantId,
      table.siteId,
      table.clockedInAt
    ),
    // The application checks first for a friendly error; this partial index
    // is the race-safe invariant when two terminals clock the same user in.
    uniqueIndex('idx_employee_shifts_one_open_per_user')
      .on(table.tenantId, table.userId)
      .where(sql`${table.clockedOutAt} IS NULL`),
  ]
);

export const employeeShiftsRelations = relations(employeeShifts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [employeeShifts.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [employeeShifts.userId],
    references: [users.id],
  }),
  site: one(sites, {
    fields: [employeeShifts.siteId],
    references: [sites.id],
  }),
}));

export type EmployeeShift = typeof employeeShifts.$inferSelect;
export type NewEmployeeShift = typeof employeeShifts.$inferInsert;

export const scheduledShiftStatusEnum = ['scheduled', 'cancelled'] as const;
export type ScheduledShiftStatus = (typeof scheduledShiftStatusEnum)[number];

/**
 * ENG-140a — durable manager-authored schedule entry.
 *
 * UTC instants drive overlap checks while timeZone freezes the tenant wall
 * time context used when the schedule was authored. Cancellation is a state
 * transition rather than DELETE so published labor evidence remains auditable.
 */
export const scheduledShifts = sqliteTable(
  'scheduled_shifts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    timeZone: text('time_zone').notNull(),
    status: text('status', { enum: scheduledShiftStatusEnum }).notNull().default('scheduled'),
    notes: text('notes'),
    version: integer('version').notNull().default(1),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => users.id),
    cancelledAt: text('cancelled_at'),
    cancelledByUserId: text('cancelled_by_user_id').references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_scheduled_shifts_tenant_site_start').on(
      table.tenantId,
      table.siteId,
      table.startsAt
    ),
    index('idx_scheduled_shifts_tenant_user_start').on(
      table.tenantId,
      table.userId,
      table.startsAt
    ),
    index('idx_scheduled_shifts_tenant_status_start').on(
      table.tenantId,
      table.status,
      table.startsAt
    ),
    check('scheduled_shifts_positive_duration', sql`${table.endsAt} > ${table.startsAt}`),
    check('scheduled_shifts_version_positive', sql`${table.version} >= 1`),
    check(
      'scheduled_shifts_cancellation_consistent',
      sql`(${table.status} = 'scheduled' AND ${table.cancelledAt} IS NULL AND ${table.cancelledByUserId} IS NULL) OR (${table.status} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL AND ${table.cancelledByUserId} IS NOT NULL)`
    ),
  ]
);

export const scheduledShiftsRelations = relations(scheduledShifts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [scheduledShifts.tenantId],
    references: [tenants.id],
  }),
  employee: one(users, {
    fields: [scheduledShifts.userId],
    references: [users.id],
    relationName: 'scheduledShiftEmployee',
  }),
  site: one(sites, {
    fields: [scheduledShifts.siteId],
    references: [sites.id],
  }),
  creator: one(users, {
    fields: [scheduledShifts.createdByUserId],
    references: [users.id],
    relationName: 'scheduledShiftCreator',
  }),
  updater: one(users, {
    fields: [scheduledShifts.updatedByUserId],
    references: [users.id],
    relationName: 'scheduledShiftUpdater',
  }),
  canceller: one(users, {
    fields: [scheduledShifts.cancelledByUserId],
    references: [users.id],
    relationName: 'scheduledShiftCanceller',
  }),
}));

export type ScheduledShift = typeof scheduledShifts.$inferSelect;
export type NewScheduledShift = typeof scheduledShifts.$inferInsert;
