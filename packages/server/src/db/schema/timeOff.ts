/** Private, explicit employee absences. No seed/backfill invents leave or approval. */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { tenants, sites, users } from './auth.js';
import { sqliteNow } from './base.js';
import {
  TIME_OFF_KINDS,
  TIME_OFF_STATUSES,
  type TimeOffWindow,
} from '../../services/labor/time-off.js';

const calendarDate = (column: AnySQLiteColumn) => sql`
  length(${column}) = 10 AND ${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr(${column}, 1, 4) != '0000' AND date(${column}, '+0 days') IS NOT NULL
  AND date(${column}, '+0 days') = ${column}`;
const utcInstant = (column: AnySQLiteColumn) => sql`
  strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) IS NOT NULL
  AND strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) = ${column}`;

/** Frozen private evidence; generic transports carry only minimal lifecycle identity, status and version. */
export interface TimeOffSnapshot extends TimeOffWindow {
  userId: string;
  siteId: string;
  kind: (typeof TIME_OFF_KINDS)[number];
  status: (typeof TIME_OFF_STATUSES)[number];
  version: number;
  approvedByUserId: string | null;
  approvedAt: string | null;
}

export const employeeTimeOff = sqliteTable(
  'employee_time_off',
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
    kind: text('kind', { enum: TIME_OFF_KINDS }).notNull(),
    status: text('status', { enum: TIME_OFF_STATUSES }).notNull().default('pending'),
    fromDate: text('from_date').notNull(),
    untilDate: text('until_date').notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    timeZone: text('time_zone').notNull(),
    version: integer('version').notNull().default(1),
    approvedByUserId: text('approved_by_user_id').references(() => users.id),
    approvedAt: text('approved_at'),
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
    index('idx_time_off_user_window').on(
      table.tenantId,
      table.userId,
      table.status,
      table.startsAt,
      table.endsAt
    ),
    index('idx_time_off_created').on(table.tenantId, table.createdAt, table.id),
    index('idx_time_off_site_created').on(table.tenantId, table.siteId, table.createdAt, table.id),
    check('chk_time_off_kind', sql`${table.kind} IN ('vacation','leave','absence')`),
    check(
      'chk_time_off_status',
      sql`${table.status} IN ('pending','approved','rejected','cancelled')`
    ),
    check(
      'chk_time_off_dates',
      sql`${calendarDate(table.fromDate)} AND ${calendarDate(table.untilDate)} AND julianday(${table.untilDate}) - julianday(${table.fromDate}) BETWEEN 1 AND 366`
    ),
    check(
      'chk_time_off_instants',
      sql`${utcInstant(table.startsAt)} AND ${utcInstant(table.endsAt)} AND ${table.endsAt} > ${table.startsAt}`
    ),
    check('chk_time_off_zone', sql`length(trim(${table.timeZone})) BETWEEN 1 AND 100`),
    check(
      'chk_time_off_version',
      sql`typeof(${table.version}) = 'integer' AND ${table.version} >= 1`
    ),
    check(
      'chk_time_off_approval_pair',
      sql`(${table.approvedByUserId} IS NULL AND ${table.approvedAt} IS NULL) OR (${table.approvedByUserId} IS NOT NULL AND ${table.approvedAt} IS NOT NULL AND ${utcInstant(table.approvedAt)})`
    ),
    check(
      'chk_time_off_approval_status',
      sql`(${table.status} != 'approved' OR ${table.approvedByUserId} IS NOT NULL) AND (${table.status} NOT IN ('pending','rejected') OR ${table.approvedByUserId} IS NULL)`
    ),
    check(
      'chk_time_off_no_self_approval',
      sql`${table.approvedByUserId} IS NULL OR ${table.approvedByUserId} != ${table.userId}`
    ),
  ]
);

export const employeeTimeOffEvents = sqliteTable(
  'employee_time_off_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    requestId: text('request_id')
      .notNull()
      .references(() => employeeTimeOff.id),
    version: integer('version').notNull(),
    kind: text('kind', { enum: ['requested', 'approved', 'rejected', 'cancelled'] }).notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    operationId: text('operation_id').notNull(),
    reason: text('reason').notNull(),
    before: text('before_json', { mode: 'json' }).$type<TimeOffSnapshot>(),
    after: text('after_json', { mode: 'json' }).$type<TimeOffSnapshot>().notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_time_off_events_version').on(table.tenantId, table.requestId, table.version),
    index('idx_time_off_events_operation').on(table.tenantId, table.operationId),
    check(
      'chk_time_off_events_version',
      sql`typeof(${table.version}) = 'integer' AND ${table.version} >= 1`
    ),
    check(
      'chk_time_off_events_kind',
      sql`${table.kind} IN ('requested','approved','rejected','cancelled')`
    ),
    check('chk_time_off_events_reason', sql`length(trim(${table.reason})) BETWEEN 10 AND 500`),
    check(
      'chk_time_off_events_json',
      sql`(${table.before} IS NULL OR json_valid(${table.before})) AND json_valid(${table.after})`
    ),
    check(
      'chk_time_off_events_creation',
      sql`(${table.kind} = 'requested' AND ${table.version} = 1 AND ${table.before} IS NULL) OR (${table.kind} != 'requested' AND ${table.version} > 1 AND ${table.before} IS NOT NULL)`
    ),
  ]
);

/** Current request projection; immutable events retain all prior approval decisions. */
export type EmployeeTimeOffRow = typeof employeeTimeOff.$inferSelect;
