/** Durable signed inbox. Receipt and nonce identity never grant permission to create a sale. */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants, sites, users } from './auth.js';
import { sales } from './sales.js';
import { sqliteNow } from './base.js';
import type { ExternalOrderSnapshot } from '../../services/external-orders/contract.js';

export const externalOrderConnectors = sqliteTable(
  'external_order_connectors',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    name: text('name').notNull(),
    adapter: text('adapter', { enum: ['sandbox_v1'] }).notNull(),
    sealedSecret: text('sealed_secret').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull().default(sqliteNow),
    updatedAt: text('updated_at').notNull().default(sqliteNow),
  },
  table => [
    index('idx_external_connectors_site').on(table.tenantId, table.siteId, table.id),
    check('chk_external_connector_version', sql`${table.version} >= 1`),
    check('chk_external_connector_adapter', sql`${table.adapter} = 'sandbox_v1'`),
  ]
);
export const externalOrderStatusEnum = [
  'received',
  'accepted',
  'cancel_requested',
  'cancelled',
  'rejected',
] as const;
/** A cancellation request after acceptance never refunds or releases inventory by itself. */
export type ExternalOrderStatus = (typeof externalOrderStatusEnum)[number];
export const externalOrders = sqliteTable(
  'external_orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    connectorId: text('connector_id')
      .notNull()
      .references(() => externalOrderConnectors.id),
    externalId: text('external_id').notNull(),
    status: text('status', { enum: externalOrderStatusEnum }).notNull(),
    snapshot: text('snapshot', { mode: 'json' }).$type<ExternalOrderSnapshot>(),
    createHash: text('create_hash'),
    saleId: text('sale_id').references(() => sales.id),
    reason: text('reason'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull().default(sqliteNow),
    updatedAt: text('updated_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_external_orders_identity').on(
      table.tenantId,
      table.connectorId,
      table.externalId
    ),
    uniqueIndex('idx_external_orders_sale')
      .on(table.tenantId, table.saleId)
      .where(sql`${table.saleId} IS NOT NULL`),
    index('idx_external_orders_queue').on(
      table.tenantId,
      table.siteId,
      table.status,
      table.createdAt,
      table.id
    ),
    check('chk_external_order_version', sql`${table.version} >= 1`),
    check(
      'chk_external_order_status',
      sql`${table.status} IN ('received','accepted','cancel_requested','cancelled','rejected')`
    ),
    check(
      'chk_external_order_binding',
      sql`${table.status} NOT IN ('accepted','cancel_requested') OR ${table.saleId} IS NOT NULL`
    ),
    check(
      'chk_external_order_snapshot',
      sql`${table.status} != 'received' OR (${table.snapshot} IS NOT NULL AND ${table.createHash} IS NOT NULL)`
    ),
  ]
);
export const externalOrderReceipts = sqliteTable(
  'external_order_receipts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    connectorId: text('connector_id')
      .notNull()
      .references(() => externalOrderConnectors.id),
    orderId: text('order_id')
      .notNull()
      .references(() => externalOrders.id),
    eventId: text('event_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    kind: text('kind', { enum: ['order.created', 'order.cancelled'] }).notNull(),
    resultStatus: text('result_status', { enum: externalOrderStatusEnum }).notNull(),
    resultVersion: integer('result_version').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_external_receipts_identity').on(
      table.tenantId,
      table.connectorId,
      table.eventId
    ),
  ]
);
export const externalOrderNonces = sqliteTable(
  'external_order_nonces',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    connectorId: text('connector_id')
      .notNull()
      .references(() => externalOrderConnectors.id),
    nonce: text('nonce').notNull(),
    envelopeHash: text('envelope_hash').notNull(),
    receiptId: text('receipt_id')
      .notNull()
      .references(() => externalOrderReceipts.id),
    expiresAt: integer('expires_at').notNull(),
  },
  table => [
    uniqueIndex('idx_external_nonces_identity').on(table.tenantId, table.connectorId, table.nonce),
    index('idx_external_nonces_expiry').on(table.tenantId, table.connectorId, table.expiresAt),
  ]
);
/** Immutable state transitions; null actor denotes an authenticated connector, never an operator. */
export const externalOrderEvents = sqliteTable(
  'external_order_events',
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
      .references(() => externalOrders.id),
    version: integer('version').notNull(),
    fromStatus: text('from_status', { enum: externalOrderStatusEnum }),
    toStatus: text('to_status', { enum: externalOrderStatusEnum }).notNull(),
    source: text('source', { enum: ['connector', 'operator'] }).notNull(),
    actorId: text('actor_id').references(() => users.id),
    sourceEventId: text('source_event_id'),
    operationId: text('operation_id'),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_external_events_version').on(table.tenantId, table.orderId, table.version),
    index('idx_external_events_site').on(table.tenantId, table.siteId, table.createdAt),
    check(
      'chk_external_event_actor',
      sql`(${table.source} = 'connector' AND ${table.actorId} IS NULL AND ${table.sourceEventId} IS NOT NULL) OR (${table.source} = 'operator' AND ${table.actorId} IS NOT NULL AND ${table.operationId} IS NOT NULL)`
    ),
  ]
);
/** Authoritative inbox row; null snapshot is a cancel-before-create tombstone. */
export type ExternalOrderRow = typeof externalOrders.$inferSelect;
/** Private persisted connector; never return sealedSecret through an API projection. */
export type ExternalConnectorRow = typeof externalOrderConnectors.$inferSelect;
