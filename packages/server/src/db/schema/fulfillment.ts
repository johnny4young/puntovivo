/** Local fulfillment evidence. No row in this ledger represents a payment or stock movement. */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sites, tenants, users } from './auth.js';
import { sqliteNow } from './base.js';
import { deliveryOrders, deliveryOrderStatusEnum } from './types.js';

/** Append-only transition evidence; historical deliveries start recording at their current version. */
export const deliveryOrderEvents = sqliteTable(
  'delivery_order_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    deliveryOrderId: text('delivery_order_id')
      .notNull()
      .references(() => deliveryOrders.id),
    version: integer('version').notNull(),
    fromStatus: text('from_status', { enum: deliveryOrderStatusEnum }),
    toStatus: text('to_status', { enum: deliveryOrderStatusEnum }).notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    operationId: text('operation_id').notNull(),
    reason: text('reason'),
    createdAt: text('created_at').notNull().default(sqliteNow),
  },
  table => [
    uniqueIndex('idx_delivery_events_version').on(
      table.tenantId,
      table.deliveryOrderId,
      table.version
    ),
    index('idx_delivery_events_site').on(table.tenantId, table.siteId, table.createdAt),
    check('chk_delivery_events_version', sql`${table.version} >= 1`),
  ]
);
