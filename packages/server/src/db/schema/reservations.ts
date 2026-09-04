/** Reservation scheduling and append-only evidence; no reservation represents a sale or payment. */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sites, tenants, users } from './auth.js';
import { sqliteNow } from './base.js';
import { restaurantServices } from './restaurant.js';
import { restaurantTables } from './salesAux.js';

export const reservationStatusEnum = [
  'booked',
  'arrived',
  'seated',
  'cancelled',
  'no_show',
] as const;
/** Only booked and arrived reservations can change; seating is owned by opening a real check. */
export type ReservationStatus = (typeof reservationStatusEnum)[number];
export const restaurantReservations = sqliteTable(
  'restaurant_reservations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    tableId: text('table_id').references(() => restaurantTables.id),
    serviceId: text('service_id').references(() => restaurantServices.id),
    guestName: text('guest_name').notNull(),
    phone: text('phone'),
    partySize: integer('party_size').notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    notes: text('notes'),
    status: text('status', { enum: reservationStatusEnum }).notNull().default('booked'),
    reason: text('reason'),
    arrivedAt: text('arrived_at'),
    seatedAt: text('seated_at'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull().default(sqliteNow),
    updatedAt: text('updated_at').notNull().default(sqliteNow),
  },
  table => [
    index('idx_reservations_site_time').on(table.tenantId, table.siteId, table.startsAt, table.id),
    index('idx_reservations_table_slot').on(
      table.tenantId,
      table.tableId,
      table.status,
      table.startsAt,
      table.endsAt
    ),
    uniqueIndex('idx_reservations_arrived_table')
      .on(table.tenantId, table.tableId)
      .where(sql`${table.status} = 'arrived'`),
    uniqueIndex('idx_reservations_service')
      .on(table.tenantId, table.serviceId)
      .where(sql`${table.serviceId} IS NOT NULL`),
    check('chk_reservation_version', sql`${table.version} >= 1`),
    check('chk_reservation_party', sql`${table.partySize} BETWEEN 1 AND 200`),
    check('chk_reservation_window', sql`${table.startsAt} < ${table.endsAt}`),
    check(
      'chk_reservation_status',
      sql`${table.status} IN ('booked','arrived','seated','cancelled','no_show')`
    ),
    check(
      'chk_reservation_seated',
      sql`(${table.status} = 'seated' AND ${table.serviceId} IS NOT NULL AND ${table.seatedAt} IS NOT NULL) OR (${table.status} != 'seated' AND ${table.serviceId} IS NULL AND ${table.seatedAt} IS NULL)`
    ),
    check(
      'chk_reservation_arrival',
      sql`${table.status} NOT IN ('arrived','seated') OR (${table.tableId} IS NOT NULL AND ${table.arrivedAt} IS NOT NULL)`
    ),
  ]
);
/** Immutable reservation transition/assignment trace; recipient PII is excluded. */
export const reservationEvents = sqliteTable(
  'reservation_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    reservationId: text('reservation_id')
      .notNull()
      .references(() => restaurantReservations.id),
    version: integer('version').notNull(),
    kind: text('kind', {
      enum: ['created', 'updated', 'arrived', 'cancelled', 'no_show', 'seated'],
    }).notNull(),
    fromStatus: text('from_status', { enum: reservationStatusEnum }),
    toStatus: text('to_status', { enum: reservationStatusEnum }).notNull(),
    tableId: text('table_id').references(() => restaurantTables.id),
    serviceId: text('service_id').references(() => restaurantServices.id),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    operationId: text('operation_id').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_reservation_events_version').on(
      table.tenantId,
      table.reservationId,
      table.version
    ),
    index('idx_reservation_events_site').on(table.tenantId, table.siteId, table.createdAt),
  ]
);
/** Authoritative stored reservation; missing table is an explicit unassigned booking. */
export type ReservationRow = typeof restaurantReservations.$inferSelect;
