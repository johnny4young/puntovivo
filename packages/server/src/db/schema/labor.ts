/**
 * Drizzle schema — labor/attendance domain.
 *
 * ENG-106b deliberately starts with the smallest durable attendance record:
 * one employee, one site, immutable clock-in time, and an optional clock-out
 * time. Schedules, breaks, overtime, payroll, and manager corrections remain
 * in ENG-140.
 *
 * @module db/schema/labor
 */
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
