/**
 * Drizzle schema — operational alerts.
 *
 * Alerts preserve the in-product incident lifecycle independently from the
 * external adapter. Deliveries target explicitly provisioned signed-webhook
 * subscriptions and retain a bounded, immutable attempt ledger without raw
 * request bodies, credentials, or business records.
 *
 * @module db/schema/operations
 */
import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { tenants, users } from './auth.js';
import { webhookSubscriptions } from './types.js';

export const operationalAlertAreaEnum = ['sync', 'fiscal', 'device', 'payments'] as const;
export type OperationalAlertArea = (typeof operationalAlertAreaEnum)[number];

export const operationalAlertSeverityEnum = ['warning', 'danger'] as const;
export type OperationalAlertSeverity = (typeof operationalAlertSeverityEnum)[number];

export const operationalAlertStatusEnum = ['open', 'acknowledged', 'resolved'] as const;
export type OperationalAlertStatus = (typeof operationalAlertStatusEnum)[number];

export const operationalAlertTransitionEnum = [
  'opened',
  'escalated',
  'acknowledged',
  'resolved',
] as const;
export type OperationalAlertTransition = (typeof operationalAlertTransitionEnum)[number];

export const operationalAlerts = sqliteTable(
  'operational_alerts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    area: text('area', { enum: operationalAlertAreaEnum }).notNull(),
    severity: text('severity', { enum: operationalAlertSeverityEnum }).notNull(),
    status: text('status', { enum: operationalAlertStatusEnum }).notNull().default('open'),
    sequence: integer('sequence').notNull().default(1),
    count: integer('count').notNull(),
    firstObservedAt: text('first_observed_at').notNull(),
    lastObservedAt: text('last_observed_at').notNull(),
    acknowledgedAt: text('acknowledged_at'),
    acknowledgedByUserId: text('acknowledged_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    resolvedAt: text('resolved_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  table => [
    uniqueIndex('idx_operational_alerts_tenant_area_active')
      .on(table.tenantId, table.area)
      .where(sql`${table.resolvedAt} IS NULL`),
    index('idx_operational_alerts_tenant_status_updated').on(
      table.tenantId,
      table.status,
      table.updatedAt
    ),
  ]
);

export const operationalAlertDeliveryStatusEnum = [
  'queued',
  'submitting',
  'delivered',
  'retrying',
  'dead_letter',
] as const;
export type OperationalAlertDeliveryStatus = (typeof operationalAlertDeliveryStatusEnum)[number];

export interface OperationalAlertDeliveryPayload {
  alertId: string;
  area: OperationalAlertArea;
  severity: OperationalAlertSeverity;
  status: OperationalAlertStatus;
  count: number;
  recoveryPath: string;
  occurredAt: string;
}

export const operationalAlertDeliveries = sqliteTable(
  'operational_alert_deliveries',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    alertId: text('alert_id')
      .notNull()
      .references(() => operationalAlerts.id, { onDelete: 'cascade' }),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
    transition: text('transition', { enum: operationalAlertTransitionEnum }).notNull(),
    alertSequence: integer('alert_sequence').notNull(),
    status: text('status', { enum: operationalAlertDeliveryStatusEnum })
      .notNull()
      .default('queued'),
    payload: text('payload', { mode: 'json' }).$type<OperationalAlertDeliveryPayload>().notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    lastError: text('last_error', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    responseStatus: integer('response_status'),
    priority: integer('priority').notNull().default(100),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    deliveredAt: text('delivered_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  table => [
    uniqueIndex('idx_operational_alert_deliveries_transition').on(
      table.alertId,
      table.subscriptionId,
      table.alertSequence,
      table.transition
    ),
    index('idx_operational_alert_deliveries_tenant_status_retry').on(
      table.tenantId,
      table.status,
      table.nextRetryAt
    ),
    index('idx_operational_alert_deliveries_tenant_updated').on(table.tenantId, table.updatedAt),
  ]
);

export const operationalAlertAttemptOutcomeEnum = [
  'attempting',
  'delivered',
  'retrying',
  'dead_letter',
] as const;
export type OperationalAlertAttemptOutcome = (typeof operationalAlertAttemptOutcomeEnum)[number];

export const operationalAlertDeliveryAttempts = sqliteTable(
  'operational_alert_delivery_attempts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    deliveryId: text('delivery_id')
      .notNull()
      .references(() => operationalAlertDeliveries.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    outcome: text('outcome', { enum: operationalAlertAttemptOutcomeEnum })
      .notNull()
      .default('attempting'),
    responseStatus: integer('response_status'),
    errorCode: text('error_code'),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
  },
  table => [
    uniqueIndex('idx_operational_alert_attempts_delivery_number').on(
      table.deliveryId,
      table.attemptNumber
    ),
    index('idx_operational_alert_attempts_tenant_started').on(table.tenantId, table.startedAt),
  ]
);

export const operationalAlertsRelations = relations(operationalAlerts, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [operationalAlerts.tenantId],
    references: [tenants.id],
  }),
  acknowledgedBy: one(users, {
    fields: [operationalAlerts.acknowledgedByUserId],
    references: [users.id],
  }),
  deliveries: many(operationalAlertDeliveries),
}));

export const operationalAlertDeliveriesRelations = relations(
  operationalAlertDeliveries,
  ({ one, many }) => ({
    alert: one(operationalAlerts, {
      fields: [operationalAlertDeliveries.alertId],
      references: [operationalAlerts.id],
    }),
    subscription: one(webhookSubscriptions, {
      fields: [operationalAlertDeliveries.subscriptionId],
      references: [webhookSubscriptions.id],
    }),
    attempts: many(operationalAlertDeliveryAttempts),
  })
);

export const operationalAlertDeliveryAttemptsRelations = relations(
  operationalAlertDeliveryAttempts,
  ({ one }) => ({
    delivery: one(operationalAlertDeliveries, {
      fields: [operationalAlertDeliveryAttempts.deliveryId],
      references: [operationalAlertDeliveries.id],
    }),
  })
);

export type OperationalAlertRow = typeof operationalAlerts.$inferSelect;
export type NewOperationalAlertRow = typeof operationalAlerts.$inferInsert;
export type OperationalAlertDeliveryRow = typeof operationalAlertDeliveries.$inferSelect;
export type NewOperationalAlertDeliveryRow = typeof operationalAlertDeliveries.$inferInsert;
export type OperationalAlertDeliveryAttemptRow =
  typeof operationalAlertDeliveryAttempts.$inferSelect;
export type NewOperationalAlertDeliveryAttemptRow =
  typeof operationalAlertDeliveryAttempts.$inferInsert;
