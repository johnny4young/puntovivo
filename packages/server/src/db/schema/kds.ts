/** Durable kitchen configuration, immutable submissions and operational projections. */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sites, tenants, users } from './auth.js';
import { nowIso, sqliteNow } from './base.js';
import { kdsOrders } from './realtime.js';

/** A site-local preparation destination, not proof of connected kitchen hardware. */
export const kdsStations = sqliteTable(
  'kds_stations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    position: integer('position').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_kds_stations_scope_code').on(table.tenantId, table.siteId, table.code),
    index('idx_kds_stations_scope_active').on(table.tenantId, table.siteId, table.isActive),
    check('chk_kds_stations_version', sql`${table.version} >= 1`),
  ]
);

/** Product rules override category rules; absence means the explicit main fallback. */
export const kdsRoutingRules = sqliteTable(
  'kds_routing_rules',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    targetKind: text('target_kind', { enum: ['product', 'category'] }).notNull(),
    // A tagged reference: the application resolves it against the matching tenant catalog.
    targetId: text('target_id').notNull(),
    route: text('route', { enum: ['station', 'exclude'] }).notNull(),
    stationId: text('station_id').references(() => kdsStations.id),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_kds_routing_target').on(
      table.tenantId,
      table.siteId,
      table.targetKind,
      table.targetId
    ),
    index('idx_kds_routing_station').on(table.tenantId, table.siteId, table.stationId),
    check('chk_kds_routing_kind', sql`${table.targetKind} IN ('product', 'category')`),
    check(
      'chk_kds_routing_destination',
      sql`(${table.route} = 'station' AND ${table.stationId} IS NOT NULL) OR (${table.route} = 'exclude' AND ${table.stationId} IS NULL)`
    ),
    check('chk_kds_routing_version', sql`${table.version} >= 1`),
  ]
);

/** Preparation states are independent of payment and never alter stock or money. */
export const kdsLineStatusEnum = ['pending', 'preparing', 'ready', 'voided'] as const;
/** Modifier information needed by cooks; deliberately excludes prices. */
export interface KdsModifierSnapshot {
  name: string;
  quantity: number;
}

/**
 * One immutable submitted line with a separate mutable state/location projection.
 * Stable sourceSaleItemId, rather than a cloned check/round, prevents financial
 * splits and checkout from submitting the same preparation twice. Snapshot ids
 * deliberately have no catalog FK: retiring a product cannot erase what was sent.
 */
export const kdsOrderLines = sqliteTable(
  'kds_order_lines',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    orderId: text('order_id')
      .notNull()
      .references(() => kdsOrders.id),
    sourceSaleItemId: text('source_sale_item_id').notNull(),
    productId: text('product_id').notNull(),
    productName: text('product_name').notNull(),
    quantity: real('quantity').notNull(),
    unitLabel: text('unit_label'),
    notes: text('notes'),
    roundId: text('round_id'),
    roundLabel: text('round_label'),
    courseKey: text('course_key'),
    dinerLabel: text('diner_label'),
    modifiers: text('modifiers', { mode: 'json' }).$type<KdsModifierSnapshot[]>().notNull(),
    // Current ownership/location may move; the order header and submitted fields above never do.
    currentSaleId: text('current_sale_id').notNull(),
    currentTableId: text('current_table_id'),
    currentTableLabel: text('current_table_label'),
    status: text('status', { enum: kdsLineStatusEnum }).notNull().default('pending'),
    version: integer('version').notNull().default(1),
    readyAt: text('ready_at'),
    readyByUserId: text('ready_by_user_id').references(() => users.id),
    voidedAt: text('voided_at'),
    voidReason: text('void_reason'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_kds_lines_source_item').on(table.tenantId, table.sourceSaleItemId),
    index('idx_kds_lines_order').on(table.tenantId, table.orderId),
    index('idx_kds_lines_current_sale').on(table.tenantId, table.currentSaleId),
    check('chk_kds_lines_quantity', sql`${table.quantity} > 0 AND ${table.quantity} <= 1000000000`),
    check(
      'chk_kds_lines_status',
      sql`${table.status} IN ('pending', 'preparing', 'ready', 'voided')`
    ),
    check('chk_kds_lines_version', sql`${table.version} >= 1`),
  ]
);

/** Append-only events distinguish adoption of legacy evidence from a new submission. */
export const kdsEventKindEnum = [
  'adopted',
  'submitted',
  'preparing',
  'ready',
  'recalled',
  'voided',
  'relocated',
  'resent',
] as const;
/** Kitchen-only durable event facts; no customer, tender or fiscal payload. */
export const kdsOrderEvents = sqliteTable(
  'kds_order_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    orderId: text('order_id')
      .notNull()
      .references(() => kdsOrders.id),
    sequence: integer('sequence').notNull(),
    kind: text('kind', { enum: kdsEventKindEnum }).notNull(),
    actorId: text('actor_id').references(() => users.id),
    facts: text('facts', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_kds_events_sequence').on(table.tenantId, table.orderId, table.sequence),
    index('idx_kds_events_site_created').on(table.tenantId, table.siteId, table.createdAt),
    check('chk_kds_events_sequence', sql`${table.sequence} >= 1`),
  ]
);

/** The SSE transport carries invalidation only; persisted tickets remain authoritative. */
export interface KdsInvalidationPayload {
  eventId: string;
  orderId: string;
  siteId: string;
}
/** Concrete shared-kernel lifecycle for durable kitchen invalidations. */
export const kdsOutboxStatusEnum = [
  'queued',
  'submitting',
  'delivered',
  'retrying',
  'dead_letter',
] as const;
/** Event and notification intent are inserted in the same business transaction. */
export const kdsOutbox = sqliteTable(
  'kds_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    eventId: text('event_id')
      .notNull()
      .references(() => kdsOrderEvents.id),
    status: text('status', { enum: kdsOutboxStatusEnum }).notNull().default('queued'),
    payload: text('payload', { mode: 'json' }).$type<KdsInvalidationPayload>().notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    lastError: text('last_error', { mode: 'json' }).$type<{
      errorCode: string;
      providerMessage: string;
      recoverable: boolean;
    }>(),
    priority: integer('priority').notNull().default(0),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_kds_outbox_event').on(table.tenantId, table.eventId),
    index('idx_kds_outbox_due').on(table.tenantId, table.status, table.nextRetryAt),
    index('idx_kds_outbox_global_due').on(table.status, table.nextRetryAt, table.tenantId),
    index('idx_kds_outbox_stale_claim').on(table.status, table.lockedAt, table.tenantId),
    check(
      'chk_kds_outbox_status',
      sql`${table.status} IN ('queued', 'submitting', 'delivered', 'retrying', 'dead_letter')`
    ),
  ]
);

/** Fully typed current database projections used by the kitchen application layer. */
export type KdsStationRow = typeof kdsStations.$inferSelect;
/** A frozen preparation line plus mutable, versioned progress/location. */
export type KdsOrderLineRow = typeof kdsOrderLines.$inferSelect;
/** Kitchen event vocabulary consumed by projections and durable invalidation. */
export type KdsEventKind = (typeof kdsEventKindEnum)[number];
/** Shared outbox lifecycle discriminator for the kitchen worker. */
export type KdsOutboxStatus = (typeof kdsOutboxStatusEnum)[number];

/**
 * Freeze routing even for explicitly excluded products. Without this decision
 * ledger, a routing edit between suspend and checkout could unexpectedly send
 * an already accepted line to a kitchen that was not part of its submission.
 */
export const kdsLineDispatches = sqliteTable(
  'kds_line_dispatches',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    sourceSaleItemId: text('source_sale_item_id').notNull(),
    route: text('route', { enum: ['station', 'exclude'] }).notNull(),
    stationCode: text('station_code'),
    orderLineId: text('order_line_id').references(() => kdsOrderLines.id),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_kds_dispatch_source').on(table.tenantId, table.sourceSaleItemId),
    check(
      'chk_kds_dispatch_target',
      sql`(${table.route} = 'station' AND ${table.orderLineId} IS NOT NULL AND ${table.stationCode} IS NOT NULL) OR (${table.route} = 'exclude' AND ${table.orderLineId} IS NULL AND ${table.stationCode} IS NULL)`
    ),
  ]
);
