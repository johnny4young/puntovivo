/** Recurring intent is separate from operative shifts; historical schedules need no backfill. */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sites, tenants, users } from './auth.js';
import { scheduledShifts } from './labor.js';
import { sqliteNow } from './base.js';
import type { ScheduleRecurrence } from '../../services/labor/schedule-recurrence.js';

export const employeeSchedulePlans = sqliteTable(
  'employee_schedule_plans',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    title: text('title').notNull(),
    fromDate: text('from_date').notNull(),
    untilDate: text('until_date').notNull(),
    anchorWeekStart: text('anchor_week_start').notNull(),
    timeZone: text('time_zone').notNull(),
    rules: text('rules_json', { mode: 'json' }).$type<ScheduleRecurrence['rules']>().notNull(),
    status: text('status', { enum: ['draft', 'published', 'discarded'] })
      .notNull()
      .default('draft'),
    version: integer('version').notNull().default(1),
    occurrenceCount: integer('occurrence_count').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => users.id),
    decidedAt: text('decided_at'),
    createdAt: text('created_at').notNull().default(sqliteNow),
    updatedAt: text('updated_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_schedule_plans_tenant_id').on(table.tenantId, table.id),
    index('idx_schedule_plans_site_created').on(
      table.tenantId,
      table.siteId,
      table.createdAt,
      table.id
    ),
    check(
      'chk_schedule_plan_state',
      sql`(${table.status}='draft' AND ${table.decidedAt} IS NULL) OR (${table.status} IN ('published','discarded') AND ${table.decidedAt} IS NOT NULL)`
    ),
    check(
      'chk_schedule_plan_version',
      sql`typeof(${table.version})='integer' AND ${table.version}>=1`
    ),
    check(
      'chk_schedule_plan_count',
      sql`typeof(${table.occurrenceCount})='integer' AND ${table.occurrenceCount} BETWEEN 1 AND 1000`
    ),
    check('chk_schedule_plan_title', sql`length(trim(${table.title})) BETWEEN 1 AND 100`),
    check('chk_schedule_plan_zone', sql`length(trim(${table.timeZone})) BETWEEN 1 AND 100`),
    check(
      'chk_schedule_plan_dates',
      sql`length(${table.fromDate})=10 AND substr(${table.fromDate},1,4)!='0000' AND date(${table.fromDate},'+0 days') IS NOT NULL AND date(${table.fromDate},'+0 days')=${table.fromDate} AND length(${table.untilDate})=10 AND date(${table.untilDate},'+0 days') IS NOT NULL AND date(${table.untilDate},'+0 days')=${table.untilDate} AND julianday(${table.untilDate})-julianday(${table.fromDate}) BETWEEN 1 AND 31 AND length(${table.anchorWeekStart})=10 AND substr(${table.anchorWeekStart},1,4)!='0000' AND date(${table.anchorWeekStart},'+0 days') IS NOT NULL AND date(${table.anchorWeekStart},'+0 days')=${table.anchorWeekStart} AND strftime('%w',${table.anchorWeekStart})='1' AND ${table.anchorWeekStart}<=${table.fromDate}`
    ),
    check(
      'chk_schedule_plan_rules',
      sql`CASE WHEN json_valid(${table.rules}) THEN json_type(${table.rules})='array' AND json_array_length(${table.rules}) BETWEEN 1 AND 100 ELSE 0 END`
    ),
  ]
);

export const employeeScheduleOccurrences = sqliteTable(
  'employee_schedule_occurrences',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    planId: text('plan_id').notNull(),
    ruleId: text('rule_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    startDate: text('start_date').notNull(),
    startTime: text('start_time').notNull(),
    endDate: text('end_date').notNull(),
    endTime: text('end_time').notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    notes: text('notes'),
    publishedShiftId: text('published_shift_id').references(() => scheduledShifts.id),
  },
  table => [
    foreignKey({
      columns: [table.tenantId, table.planId],
      foreignColumns: [employeeSchedulePlans.tenantId, employeeSchedulePlans.id],
    }),
    uniqueIndex('idx_schedule_occurrences_rule_date').on(
      table.tenantId,
      table.planId,
      table.ruleId,
      table.startDate
    ),
    index('idx_schedule_occurrences_plan_id').on(table.tenantId, table.planId, table.id),
    index('idx_schedule_occurrences_user').on(table.tenantId, table.userId, table.planId),
    uniqueIndex('idx_schedule_occurrences_shift')
      .on(table.publishedShiftId)
      .where(sql`${table.publishedShiftId} IS NOT NULL`),
    check(
      'chk_schedule_occurrence_instants',
      sql`strftime('%Y-%m-%dT%H:%M:%fZ',${table.startsAt}) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',${table.startsAt})=${table.startsAt} AND strftime('%Y-%m-%dT%H:%M:%fZ',${table.endsAt}) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',${table.endsAt})=${table.endsAt} AND ${table.endsAt}>${table.startsAt} AND unixepoch(${table.endsAt})-unixepoch(${table.startsAt})<=86400`
    ),
    check(
      'chk_schedule_occurrence_notes',
      sql`${table.notes} IS NULL OR length(${table.notes})<=500`
    ),
  ]
);

/** Immutable plan transition metadata; content remains in normalized rows and private rules snapshot. */
export const employeeSchedulePlanEvents = sqliteTable(
  'employee_schedule_plan_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    planId: text('plan_id').notNull(),
    version: integer('version').notNull(),
    kind: text('kind', { enum: ['created', 'regenerated', 'published', 'discarded'] }).notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    operationId: text('operation_id').notNull(),
    reason: text('reason'),
    snapshot: text('snapshot_json', { mode: 'json' }).$type<SchedulePlanSnapshot>().notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    foreignKey({
      columns: [table.tenantId, table.planId],
      foreignColumns: [employeeSchedulePlans.tenantId, employeeSchedulePlans.id],
    }),
    uniqueIndex('idx_schedule_plan_events_version').on(table.tenantId, table.planId, table.version),
    index('idx_schedule_plan_events_operation').on(table.tenantId, table.operationId),
    check(
      'chk_schedule_plan_event_version',
      sql`typeof(${table.version})='integer' AND ${table.version}>=1`
    ),
    check(
      'chk_schedule_plan_event_kind',
      sql`${table.kind} IN ('created','regenerated','published','discarded')`
    ),
    check(
      'chk_schedule_plan_event_reason',
      sql`(${table.kind} IN ('created','published') AND ${table.reason} IS NULL) OR (${table.kind} IN ('regenerated','discarded') AND ${table.reason} IS NOT NULL AND length(trim(${table.reason})) BETWEEN 10 AND 500)`
    ),
    check('chk_schedule_plan_event_snapshot', sql`json_valid(${table.snapshot})`),
  ]
);

/** Current plan projection; final decisions never edit this frozen intent again. */
export type EmployeeSchedulePlan = typeof employeeSchedulePlans.$inferSelect;
/** Frozen occurrence, later linked exactly once to its operative shift. */
export type EmployeeScheduleOccurrence = typeof employeeScheduleOccurrences.$inferSelect;
/** Private full intent evidence allows exact reconstruction after explicit draft regeneration. */
export interface SchedulePlanSnapshot {
  plan: EmployeeSchedulePlan;
  occurrences: EmployeeScheduleOccurrence[];
}
