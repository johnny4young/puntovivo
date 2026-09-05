import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sqliteNow } from './base.js';
import { tenants, users } from './auth.js';
import { scheduledShifts } from './labor.js';

/** Employee-visible intent omits private schedule notes; the digest also binds those notes. */
export interface SwapShiftIntent {
  id: string;
  userId: string;
  siteId: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  version: number;
  fingerprint: string;
}
/** Frozen pair agreed to by the two employees, never regenerated during approval. */
export interface ShiftSwapIntent {
  offered: SwapShiftIntent;
  requested: SwapShiftIntent;
}
export const SHIFT_SWAP_STATUSES = [
  'requested',
  'accepted',
  'approved',
  'rejected',
  'cancelled',
] as const;
/** Consent precedes independent approval; terminal decisions cannot be edited. */
export const employeeShiftSwaps = sqliteTable(
  'employee_shift_swaps',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    requesterId: text('requester_id')
      .notNull()
      .references(() => users.id),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => users.id),
    offeredShiftId: text('offered_shift_id')
      .notNull()
      .references(() => scheduledShifts.id),
    requestedShiftId: text('requested_shift_id')
      .notNull()
      .references(() => scheduledShifts.id),
    intent: text('intent_json', { mode: 'json' }).$type<ShiftSwapIntent>().notNull(),
    status: text('status', { enum: SHIFT_SWAP_STATUSES }).notNull().default('requested'),
    version: integer('version').notNull().default(1),
    offeredReplacementId: text('offered_replacement_id').references(() => scheduledShifts.id),
    requestedReplacementId: text('requested_replacement_id').references(() => scheduledShifts.id),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default(sqliteNow),
    updatedAt: text('updated_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_shift_swaps_tenant_id').on(table.tenantId, table.id),
    index('idx_shift_swaps_requester_created').on(
      table.tenantId,
      table.requesterId,
      table.createdAt,
      table.id
    ),
    index('idx_shift_swaps_recipient_created').on(
      table.tenantId,
      table.recipientId,
      table.createdAt,
      table.id
    ),
    index('idx_shift_swaps_status_created').on(
      table.tenantId,
      table.status,
      table.createdAt,
      table.id
    ),
    index('idx_shift_swaps_offered').on(table.tenantId, table.offeredShiftId),
    index('idx_shift_swaps_requested').on(table.tenantId, table.requestedShiftId),
    check(
      'chk_shift_swap_distinct',
      sql`${table.requesterId}!=${table.recipientId} AND ${table.offeredShiftId}!=${table.requestedShiftId}`
    ),
    check(
      'chk_shift_swap_version',
      sql`typeof(${table.version})='integer' AND ${table.version} BETWEEN 1 AND 9007199254740990`
    ),
    check(
      'chk_shift_swap_status',
      sql`${table.status} IN ('requested','accepted','approved','rejected','cancelled')`
    ),
    check(
      'chk_shift_swap_intent',
      sql`json_valid(${table.intent}) AND length(${table.intent})<=10000`
    ),
    check(
      'chk_shift_swap_replacements',
      sql`(${table.status}='approved' AND ${table.offeredReplacementId} IS NOT NULL AND ${table.requestedReplacementId} IS NOT NULL AND ${table.offeredReplacementId}!=${table.requestedReplacementId}) OR (${table.status}!='approved' AND ${table.offeredReplacementId} IS NULL AND ${table.requestedReplacementId} IS NULL)`
    ),
  ]
);
/** One active request may claim a shift, regardless of which side offered it. Terminal decisions release claims. */
export const employeeShiftSwapClaims = sqliteTable(
  'employee_shift_swap_claims',
  {
    tenantId: text('tenant_id').notNull(),
    shiftId: text('shift_id')
      .notNull()
      .references(() => scheduledShifts.id),
    requestId: text('request_id').notNull(),
  },
  table => [
    primaryKey({ columns: [table.tenantId, table.shiftId] }),
    foreignKey({
      columns: [table.tenantId, table.requestId],
      foreignColumns: [employeeShiftSwaps.tenantId, employeeShiftSwaps.id],
    }),
    index('idx_shift_swap_claims_request').on(table.tenantId, table.requestId),
  ]
);
/** Immutable private transition evidence; neither reasons nor intents enter generic audit/outbox payloads. */
export const employeeShiftSwapEvents = sqliteTable(
  'employee_shift_swap_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    requestId: text('request_id').notNull(),
    version: integer('version').notNull(),
    status: text('status', { enum: SHIFT_SWAP_STATUSES }).notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    operationId: text('operation_id').notNull(),
    reason: text('reason'),
    snapshot: text('snapshot_json', { mode: 'json' }).$type<EmployeeShiftSwap>().notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    foreignKey({
      columns: [table.tenantId, table.requestId],
      foreignColumns: [employeeShiftSwaps.tenantId, employeeShiftSwaps.id],
    }),
    uniqueIndex('idx_shift_swap_events_version').on(table.tenantId, table.requestId, table.version),
    index('idx_shift_swap_events_operation').on(table.tenantId, table.operationId),
    check('chk_shift_swap_event_snapshot', sql`json_valid(${table.snapshot})`),
    check(
      'chk_shift_swap_event_reason',
      sql`(${table.status} IN ('accepted','approved') AND ${table.reason} IS NULL) OR (${table.status} IN ('requested','rejected','cancelled') AND ${table.reason} IS NOT NULL AND length(trim(${table.reason})) BETWEEN 10 AND 500)`
    ),
  ]
);
/** Stored consent state including frozen source intent and the eventual replacement lineage. */
export type EmployeeShiftSwap = typeof employeeShiftSwaps.$inferSelect;
