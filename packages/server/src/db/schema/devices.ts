/**
 * Drizzle schema — devices domain.
 *
 * relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/devices
 */
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import {
  deviceAuthorityRoleEnum,
  devicePairingCodeStatusEnum,
  idempotencyKeyStatusEnum,
} from './base.js';
import { sites, tenants, users } from './auth.js';

// ============================================================================
// DEVICES + IDEMPOTENCY (Command Envelope foundation, ADR-0002)
// ============================================================================

/**
 * `devices` is the formal record of every cashier machine that mutates
 * the local store. The Electron desktop binary or the web client
 * registers itself once via `auth.registerDevice` and persists the
 * server-issued id locally (Electron userData file or browser
 * localStorage). Subsequent critical mutations carry `x-device-id` so
 * the server can verify (`tenant_id`, `device_id`) ownership server
 * side and refuse renderer-supplied ids that no row backs.
 *
 * `kind` discriminates `desktop` (Electron) from `web` (browser-only,
 * dev or self-hosted). `is_active=false` revokes the device without
 * deleting the row so future audits can still join via
 * `audit_logs.operation_id` → operation journal () → device.
 */
export const devices = sqliteTable(
  'devices',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    // `hub_client` discriminates a cashier terminal whose
    // renderer points at a remote Store Hub instead of an embedded
    // backend. Per ADR-0008, hub clients are NOT Authority Nodes —
    // they only originate commands. The kind flows from the renderer
    // via auth.registerDevice; the column is plain text so adding the
    // value needs no migration. Removing a value later would require a
    // data migration.
    kind: text('kind', { enum: ['desktop', 'web', 'hub_client'] as const }).notNull(),
    name: text('name').notNull(),
    registeredByUserId: text('registered_by_user_id')
      .notNull()
      .references(() => users.id),
    lastSeenAt: text('last_seen_at'),
    // explicit Authority Node topology metadata. Existing
    // rows may be null; projection code derives a fallback from `kind`.
    authorityRole: text('authority_role', { enum: deviceAuthorityRoleEnum }),
    pairedSiteId: text('paired_site_id').references(() => sites.id, {
      onDelete: 'set null',
    }),
    appVersion: text('app_version'),
    dbSchemaVersion: integer('db_schema_version'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    index('idx_devices_tenant_active').on(table.tenantId, table.isActive),
    index('idx_devices_tenant_last_seen').on(table.tenantId, table.lastSeenAt),
    index('idx_devices_tenant_authority_role').on(table.tenantId, table.authorityRole),
    index('idx_devices_tenant_paired_site').on(table.tenantId, table.pairedSiteId),
  ]
);

export const devicesRelations = relations(devices, ({ one }) => ({
  tenant: one(tenants, {
    fields: [devices.tenantId],
    references: [tenants.id],
  }),
  registeredBy: one(users, {
    fields: [devices.registeredByUserId],
    references: [users.id],
  }),
  pairedSite: one(sites, {
    fields: [devices.pairedSiteId],
    references: [sites.id],
  }),
}));

export const devicePairingCodes = sqliteTable(
  'device_pairing_codes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    deviceName: text('device_name'),
    status: text('status', { enum: devicePairingCodeStatusEnum }).notNull().default('pending'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    claimedByDeviceId: text('claimed_by_device_id').references(() => devices.id, {
      onDelete: 'set null',
    }),
    expiresAt: text('expires_at').notNull(),
    claimedAt: text('claimed_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    uniqueIndex('idx_device_pairing_codes_hash').on(table.codeHash),
    index('idx_device_pairing_codes_tenant_status').on(table.tenantId, table.status),
    index('idx_device_pairing_codes_tenant_site').on(table.tenantId, table.siteId),
    index('idx_device_pairing_codes_claimed_device').on(table.claimedByDeviceId),
  ]
);

export const devicePairingCodesRelations = relations(devicePairingCodes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [devicePairingCodes.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [devicePairingCodes.siteId],
    references: [sites.id],
  }),
  createdBy: one(users, {
    fields: [devicePairingCodes.createdByUserId],
    references: [users.id],
  }),
  claimedByDevice: one(devices, {
    fields: [devicePairingCodes.claimedByDeviceId],
    references: [devices.id],
  }),
}));

/**
 * `idempotency_keys` reserves a critical command before the procedure
 * runs, then caches the result after success. A replay with a matching
 * `request_hash` returns either the cached `result_ref` or
 * COMMAND_IN_PROGRESS while the first call is still executing; a
 * mismatched hash raises IDEMPOTENCY_KEY_CONFLICT.
 *
 * Default TTL is 24 hours (cleaned by background sweep). The unique
 * index covers the lookup hot path.
 */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    idempotencyKey: text('idempotency_key').notNull(),
    operationKind: text('operation_kind').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status', { enum: idempotencyKeyStatusEnum }).notNull().default('processing'),
    resultRef: text('result_ref', { mode: 'json' }).$type<unknown | null>(),
    lockedAt: text('locked_at').notNull().default('1970-01-01T00:00:00.000Z'),
    completedAt: text('completed_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    expiresAt: text('expires_at').notNull(),
  },
  table => [
    uniqueIndex('idx_idempotency_keys_unique').on(
      table.tenantId,
      table.deviceId,
      table.idempotencyKey,
      table.operationKind
    ),
    index('idx_idempotency_keys_expires_at').on(table.expiresAt),
    index('idx_idempotency_keys_status_expires_at').on(table.status, table.expiresAt),
  ]
);

export const idempotencyKeysRelations = relations(idempotencyKeys, ({ one }) => ({
  tenant: one(tenants, {
    fields: [idempotencyKeys.tenantId],
    references: [tenants.id],
  }),
  device: one(devices, {
    fields: [idempotencyKeys.deviceId],
    references: [devices.id],
  }),
}));

// ============================================================================
// OPERATION JOURNAL + OUTBOX METADATA (ADR-0001/0002/0003)
// ============================================================================

/**
 * `operation_events` is the append-only intent log that closes the loop
 * opened by  — every critical mutation that flows through
 * `commandEnvelope` reserves a row here keyed by `(tenant_id,
 * operation_id)`. The envelope's `operationId` becomes the join key
 * across logs, audit rows, outbox effects, and (eventually) the
 * central server publish stream.
 *
 * `status` lifecycle:
 *
 * started → succeeded | failed | partial
 *
 * `partial` exists for the future case where the procedure committed
 * the primary work but a post-commit fan-out (e.g. fiscal emission
 * via the future `fiscal_outbox`) failed; the original sale stays
 * intact and the journal records the partial completion so operators
 * can retry the missing fan-out without re-running the primary.
 *
 * `summary` is a small JSON blob the procedure can write at completion
 * time (e.g. `{saleId, total, paymentMethod}`) so forensics queries
 * don't need to re-join 10 tables to reconstruct what happened.
 */
export const operationEventStatusEnum = ['started', 'succeeded', 'failed', 'partial'] as const;

export type OperationEventStatus = (typeof operationEventStatusEnum)[number];

export const operationEvents = sqliteTable(
  'operation_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    operationId: text('operation_id').notNull(),
    operationKind: text('operation_kind').notNull(),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: operationEventStatusEnum }).notNull().default('started'),
    requestHash: text('request_hash').notNull(),
    summary: text('summary', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    startedAt: text('started_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    completedAt: text('completed_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    uniqueIndex('idx_operation_events_tenant_operation').on(table.tenantId, table.operationId),
    index('idx_operation_events_status').on(table.status),
    index('idx_operation_events_kind_status').on(table.operationKind, table.status),
    index('idx_operation_events_device').on(table.deviceId),
    index('idx_operation_events_user').on(table.userId),
    // kernel worker polls WHERE status IN ('started','failed','partial')
    // ORDER BY created_at. The existing status index supports the filter but
    // not the sort; this composite covers both.
    index('idx_operation_events_status_created').on(table.status, table.createdAt),
  ]
);

/**
 * `operation_effects` records what side effects a single operation
 * produced. One row per significant effect (an audit_logs row, a
 * sync_outbox enqueue, a fiscal_outbox enqueue, an inventory
 * movement, etc.). Row-level details live in their dedicated tables;
 * the effect row carries `kind` + `resource_type` + `resource_id` so
 * the trail can join back without forcing every consumer to read the
 * destination table.
 *
 * Cascade-delete with the parent event row keeps the trail tidy
 * during the eventual journal-rotation policy (operations older than
 * 90 days move to cold storage in a future change).
 */
export const operationEffects = sqliteTable(
  'operation_effects',
  {
    id: text('id').primaryKey(),
    operationEventId: text('operation_event_id')
      .notNull()
      .references(() => operationEvents.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    effectData: text('effect_data', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    index('idx_operation_effects_event').on(table.operationEventId),
    index('idx_operation_effects_event_kind').on(table.operationEventId, table.kind),
    index('idx_operation_effects_resource').on(table.resourceType, table.resourceId),
  ]
);

/**
 * `operation_errors` records POST-commit failures attributed to an
 * operation without rolling back the primary work. Example: the sale
 * committed cleanly, but the DIAN adapter rejected the emission with
 * a transient error. The sale row stays intact, the operation event
 * transitions to `partial`, and a row lands here so the operator can
 * retry from the Operations Center ().
 *
 * `recoverable` distinguishes retryable failures (provider 5xx,
 * network timeout) from permanent ones (validation rejection at the
 * provider, malformed input). Workers consult this flag when
 * deciding whether to schedule a retry or move straight to the
 * dead-letter terminal.
 */
export const operationErrors = sqliteTable(
  'operation_errors',
  {
    id: text('id').primaryKey(),
    operationEventId: text('operation_event_id')
      .notNull()
      .references(() => operationEvents.id, { onDelete: 'cascade' }),
    errorCode: text('error_code').notNull(),
    message: text('message').notNull(),
    recoverable: integer('recoverable', { mode: 'boolean' }).notNull().default(false),
    errorData: text('error_data', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    index('idx_operation_errors_event').on(table.operationEventId),
    index('idx_operation_errors_code').on(table.errorCode),
  ]
);

export const operationEventsRelations = relations(operationEvents, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [operationEvents.tenantId],
    references: [tenants.id],
  }),
  device: one(devices, {
    fields: [operationEvents.deviceId],
    references: [devices.id],
  }),
  user: one(users, {
    fields: [operationEvents.userId],
    references: [users.id],
  }),
  effects: many(operationEffects),
  errors: many(operationErrors),
}));

export const operationEffectsRelations = relations(operationEffects, ({ one }) => ({
  event: one(operationEvents, {
    fields: [operationEffects.operationEventId],
    references: [operationEvents.id],
  }),
}));

export const operationErrorsRelations = relations(operationErrors, ({ one }) => ({
  event: one(operationEvents, {
    fields: [operationErrors.operationEventId],
    references: [operationEvents.id],
  }),
}));

/**
 * `outbox_metadata` is the cross-outbox health table — one row per
 * `(tenant_id, outbox_kind)`. The five concrete outboxes (sync,
 * fiscal, payment, webhook, hardware — ADR-0003) each refresh their
 * row periodically with `pending_count`, `oldest_pending_at`, and the
 * last success/failure timestamps.  (Operations Center) reads
 * this single table to render its status panels without scanning the
 * outbox tables themselves.
 *
 * The kernel at `lib/outbox/metadata.ts` owns the read/write helpers;
 * concrete outboxes never write here directly.
 */
export const outboxKindEnum = ['sync', 'fiscal', 'payment', 'webhook', 'hardware'] as const;

export type OutboxKind = (typeof outboxKindEnum)[number];

export const outboxMetadata = sqliteTable(
  'outbox_metadata',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    outboxKind: text('outbox_kind', { enum: outboxKindEnum }).notNull(),
    pendingCount: integer('pending_count').notNull().default(0),
    lastSuccessAt: text('last_success_at'),
    lastFailureAt: text('last_failure_at'),
    oldestPendingAt: text('oldest_pending_at'),
    refreshedAt: text('refreshed_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    uniqueIndex('idx_outbox_metadata_tenant_kind').on(table.tenantId, table.outboxKind),
    index('idx_outbox_metadata_kind_pending').on(table.outboxKind, table.pendingCount),
  ]
);

export const outboxMetadataRelations = relations(outboxMetadata, ({ one }) => ({
  tenant: one(tenants, {
    fields: [outboxMetadata.tenantId],
    references: [tenants.id],
  }),
}));
