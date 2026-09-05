/** Explicit effective availability and immutable decisions; no inferred backfill. */
import { sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants, users } from './auth.js';
import { sqliteNow } from './base.js';
import type { AvailabilityPolicy, AvailabilitySlot } from '../../services/labor/availability.js';

/** Private frozen policy evidence; generic audit/outbox contain only identity and version. */
export interface AvailabilitySnapshot extends AvailabilityPolicy {
  userId: string;
  status: 'active' | 'voided';
  version: number;
  replacesId: string | null;
}
export const employeeAvailability = sqliteTable(
  'employee_availability',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ['active', 'voided'] })
      .notNull()
      .default('active'),
    fromDate: text('from_date').notNull(),
    untilDate: text('until_date'),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at'),
    timeZone: text('time_zone').notNull(),
    slots: text('slots_json', { mode: 'json' }).$type<AvailabilitySlot[]>().notNull(),
    replacesId: text('replaces_id').references((): AnySQLiteColumn => employeeAvailability.id),
    version: integer('version').notNull().default(1),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow),
    updatedAt: text('updated_at').notNull().default(sqliteNow),
  },
  table => [
    index('idx_availability_user_window').on(
      table.tenantId,
      table.userId,
      table.status,
      table.startsAt,
      table.endsAt
    ),
    index('idx_availability_created').on(table.tenantId, table.createdAt, table.id),
    check('chk_availability_status', sql`${table.status} IN ('active','voided')`),
    check(
      'chk_availability_version',
      sql`typeof(${table.version})='integer' AND ${table.version}>=1`
    ),
    check(
      'chk_availability_dates',
      sql`length(${table.fromDate})=10 AND substr(${table.fromDate},1,4)!='0000' AND date(${table.fromDate},'+0 days') IS NOT NULL AND date(${table.fromDate},'+0 days')=${table.fromDate} AND (${table.untilDate} IS NULL OR (length(${table.untilDate})=10 AND date(${table.untilDate},'+0 days') IS NOT NULL AND date(${table.untilDate},'+0 days')=${table.untilDate} AND ${table.untilDate}>${table.fromDate}))`
    ),
    check(
      'chk_availability_instants',
      sql`strftime('%Y-%m-%dT%H:%M:%fZ',${table.startsAt}) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',${table.startsAt})=${table.startsAt} AND ((${table.endsAt} IS NULL AND ${table.untilDate} IS NULL) OR (${table.endsAt} IS NOT NULL AND ${table.untilDate} IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',${table.endsAt}) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',${table.endsAt})=${table.endsAt} AND ${table.endsAt}>${table.startsAt}))`
    ),
    check('chk_availability_zone', sql`length(trim(${table.timeZone})) BETWEEN 1 AND 100`),
    check(
      'chk_availability_slots',
      sql`CASE WHEN json_valid(${table.slots}) THEN json_type(${table.slots})='array' AND json_array_length(${table.slots})<=56 ELSE 0 END`
    ),
  ]
);
export const employeeAvailabilityEvents = sqliteTable(
  'employee_availability_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    availabilityId: text('availability_id')
      .notNull()
      .references(() => employeeAvailability.id),
    version: integer('version').notNull(),
    kind: text('kind', { enum: ['created', 'ended', 'voided'] }).notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    operationId: text('operation_id').notNull(),
    reason: text('reason').notNull(),
    before: text('before_json', { mode: 'json' }).$type<AvailabilitySnapshot>(),
    after: text('after_json', { mode: 'json' }).$type<AvailabilitySnapshot>().notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_availability_event_version').on(
      table.tenantId,
      table.availabilityId,
      table.version
    ),
    index('idx_availability_event_operation').on(table.tenantId, table.operationId),
    check(
      'chk_availability_event_version',
      sql`typeof(${table.version})='integer' AND ${table.version}>=1`
    ),
    check('chk_availability_event_kind', sql`${table.kind} IN ('created','ended','voided')`),
    check('chk_availability_event_reason', sql`length(trim(${table.reason})) BETWEEN 10 AND 500`),
    check(
      'chk_availability_event_json',
      sql`(${table.before} IS NULL OR json_valid(${table.before})) AND json_valid(${table.after})`
    ),
    check(
      'chk_availability_event_creation',
      sql`(${table.kind}='created' AND ${table.version}=1 AND ${table.before} IS NULL) OR (${table.kind}!='created' AND ${table.version}>1 AND ${table.before} IS NOT NULL)`
    ),
  ]
);
/** Current projection; replacement retains the old period and creates a linked successor. */
export type EmployeeAvailabilityRow = typeof employeeAvailability.$inferSelect;
