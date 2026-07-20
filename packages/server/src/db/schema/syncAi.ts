/**
 * Drizzle schema — syncAi domain.
 *
 * relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/syncAi
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { nowIso, sqliteNow } from './base.js';
import { sites, tenants, users } from './auth.js';
import { devices, operationEvents } from './devices.js';
import {
  fiscalCertificates,
  fiscalDocumentItems,
  fiscalDocuments,
  fiscalNumberingResolutions,
} from './fiscal.js';

// ============================================================================
// SYNC OUTBOX (Sync contract v1)
// ============================================================================
//
// Closes ADR-0003's promise of five purpose-specific outboxes. Mirrors the
// kernel projection used by `fiscal_outbox` () and `hardware_outbox`
// () PLUS adds the per-entity contract columns ADR-0002 + ADR-0004
// lock in: payload version, command-envelope correlation
// (idempotency_key + device_id + operation_event_id), conflict policy
// per ADR-0004, and a soft `depends_on_operation_id` for topological
// ordering on the consumer side.
//
// cutover history: 0016_sync_contract_v1 introduced this
// table and backfilled pending rows from the legacy `sync_queue`;
// 0017_drop_sync_queue dropped the legacy table once every writer
// (19 routers + 4 application services + dev seed) routed through
// `enqueueSync()` and the eight `sync.*` procedures cut over to read
// from `sync_outbox`. After 0017 there is a single canonical sync
// table.

/**
 * Closed list of sync outbox lifecycle states. Mirror of the fiscal
 * outbox enum but with `synced`/`conflict` instead of accepted/rejected
 * because sync rows do not get a provider verdict — they either land
 * on the consumer or hit a write conflict that needs resolution.
 */
export const syncOutboxStatusEnum = [
  'queued',
  'submitting',
  'synced',
  'conflict',
  'retrying',
  'dead_letter',
] as const;
export type SyncOutboxStatus = (typeof syncOutboxStatusEnum)[number];

/**
 * Per-entity conflict policy per ADR-0004. `manual` for high-risk
 * entities (sales, cash, fiscal, inventory, audit) where the
 * operator MUST resolve any divergence; `auto_lww` for catalog and
 * preferences where last-write-wins is safe.  v1 surfaces
 * the marker; the actual auto-resolution branch in `sync.push` is
 * parked for a follow-up.
 */
export const syncConflictPolicyEnum = ['manual', 'auto_lww'] as const;
export type SyncConflictPolicy = (typeof syncConflictPolicyEnum)[number];

/**
 * Operation kind on the sync row. Three-value enum: `create` /
 * `update` / `delete`. Future: `restore` / `replay` could land
 * here when  chaos suite needs them.
 */
export const syncOperationEnum = ['create', 'update', 'delete'] as const;
export type SyncOperation = (typeof syncOperationEnum)[number];

export const syncOutbox = sqliteTable(
  'sync_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    status: text('status', { enum: syncOutboxStatusEnum }).notNull().default('queued'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    operation: text('operation', { enum: syncOperationEnum }).notNull(),
    conflictPolicy: text('conflict_policy', { enum: syncConflictPolicyEnum })
      .notNull()
      .default('auto_lww'),
    /** Snapshot of the entity row at emit time. JSON-serialized. */
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    /**
     * Command-envelope key (). Nullable because catalog /
     * preferences writes are not envelope-wrapped. When present, the
     * partial unique index `idx_sync_outbox_idempotent` collapses
     * duplicate enqueues for retries.
     */
    idempotencyKey: text('idempotency_key'),
    deviceId: text('device_id').references(() => devices.id, { onDelete: 'set null' }),
    /**
     * Soft FK to `operation_events.operation_id`. Carried as a string
     * so the consumer can defer applying this row until the
     * referenced operation is acknowledged. Null when the writer
     * runs outside the command-envelope middleware.
     */
    dependsOnOperationId: text('depends_on_operation_id'),
    /** Hard FK to `operation_events.id` for the journal trail. */
    operationEventId: text('operation_event_id').references(() => operationEvents.id, {
      onDelete: 'set null',
    }),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    /** `NormalizedOutboxError` written by the kernel on `fail`. */
    lastError: text('last_error', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    priority: real('priority').notNull().default(0),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    // Primary path for the kernel's claimNext: filter by tenant +
    // status (queued or retrying) ordered by priority + createdAt.
    index('idx_sync_outbox_tenant_status_retry').on(
      table.tenantId,
      table.status,
      table.nextRetryAt
    ),
    // Per-entity drilldown for "what's pending for this customer
    // record" surfaces (Operations Center).  widened this from
    // (entity_type, entity_id) to include status so the Operations
    // Center peek query "pending syncs for entity X" can resolve via
    // the index without a status post-filter.
    index('idx_sync_outbox_entity').on(table.entityType, table.entityId, table.status),
    // Operations Center listing + peek.
    index('idx_sync_outbox_tenant_created').on(table.tenantId, table.createdAt),
    // Coalesce duplicate enqueues at the queue layer when an
    // idempotencyKey is present. Catalog writes without an
    // idempotency key are not deduped here because they're
    // idempotent on the consumer side anyway. The partial WHERE
    // clause is applied in the migration SQL with `IF NOT EXISTS`;
    // Drizzle's SQLite dialect cannot emit partial unique indexes
    // generically.
    uniqueIndex('idx_sync_outbox_idempotent')
      .on(table.tenantId, table.entityType, table.entityId, table.operation, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ]
);

export const syncOutboxRelations = relations(syncOutbox, ({ one }) => ({
  tenant: one(tenants, {
    fields: [syncOutbox.tenantId],
    references: [tenants.id],
  }),
  device: one(devices, {
    fields: [syncOutbox.deviceId],
    references: [devices.id],
  }),
  operationEvent: one(operationEvents, {
    fields: [syncOutbox.operationEventId],
    references: [operationEvents.id],
  }),
}));

export type SyncOutboxRow = typeof syncOutbox.$inferSelect;
export type NewSyncOutboxRow = typeof syncOutbox.$inferInsert;

export type FiscalNumberingResolution = typeof fiscalNumberingResolutions.$inferSelect;
export type NewFiscalNumberingResolution = typeof fiscalNumberingResolutions.$inferInsert;
export type FiscalCertificate = typeof fiscalCertificates.$inferSelect;
export type NewFiscalCertificate = typeof fiscalCertificates.$inferInsert;
export type FiscalDocument = typeof fiscalDocuments.$inferSelect;
export type NewFiscalDocument = typeof fiscalDocuments.$inferInsert;
export type FiscalDocumentItem = typeof fiscalDocumentItems.$inferSelect;
export type NewFiscalDocumentItem = typeof fiscalDocumentItems.$inferInsert;

// ============================================================================
// LOGIN RATE-LIMIT STATE ()
// ============================================================================
//
// Persistent counters backing `security/loginRateLimit.ts`.
// shipped the policy against an in-memory Map;  promotes the DB to
// source of truth so `auth.login` rate limits survive a server restart.
//
// **NOT tenant-scoped**: rate limiting applies per-IP and per-email across
// every tenant. An attacker hammering multiple tenants from the same origin
// should be globally throttled — adding `tenant_id` here would let them
// split attempts across tenants to evade the cap. Documented in
// docs/SECURITY.md §Rate limiting.

/**
 * Credential-throttle buckets. The original login buckets remain global;
 * adds tenant-qualified actor/target keys for staff PIN failures.
 */
export const loginAttemptKindEnum = [
  'ip',
  'username',
  'staff_pin_actor',
  'staff_pin_target',
] as const;
export type LoginAttemptKind = (typeof loginAttemptKindEnum)[number];

export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: loginAttemptKindEnum }).notNull(),
    /** IP/email, or a tenant-qualified opaque user id for staff PIN buckets. */
    key: text('key').notNull(),
    /** Monotonically increasing count inside the current window. */
    count: integer('count').notNull().default(0),
    /** Epoch millis when the bucket was first touched in the current window. */
    firstAt: integer('first_at').notNull(),
    /** Epoch millis when the bucket expires (firstAt + windowMs). */
    expiresAt: integer('expires_at').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    uniqueIndex('idx_login_attempts_kind_key').on(table.kind, table.key),
    index('idx_login_attempts_expires_at').on(table.expiresAt),
  ]
);

export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type NewLoginAttempt = typeof loginAttempts.$inferInsert;

// ============================================================================
// SYSTEM AUDIT LOG (global maintenance jobs)
// ============================================================================
//
// `audit_logs` is intentionally tenant-scoped: every row has a concrete
// tenant_id + actor_id so the admin UI can enforce tenant isolation by
// construction. Some housekeeping work is not tenant-scoped, though. The
// login_attempts cleanup worker sweeps a global table keyed by IP/email and
// runs without an actor. Recording those runs in `audit_logs` would require
// synthetic tenants/users and would risk leaking global security counters to a
// tenant-scoped surface. This table is the global counterpart for maintenance
// evidence only.

// `rate_limit.exceeded` records a tRPC bucket-rate-limit hit
// (the offending tenant / user / ip live in `metadata`, since this table
// has no tenant/actor columns). TS-level enum only; the column accepts
// any text, so appending a value needs no migration.
export const systemAuditLogActionEnum = [
  'login_attempts.cleanup',
  'rate_limit.exceeded',
  'data_retention.cleanup',
] as const;
export type SystemAuditLogAction = (typeof systemAuditLogActionEnum)[number];

export const systemAuditLogResourceTypeEnum = [
  'login_attempts',
  'rate_limit',
  'data_retention',
] as const;
export type SystemAuditLogResourceType = (typeof systemAuditLogResourceTypeEnum)[number];

export const systemAuditLogStatusEnum = ['ok', 'error'] as const;
export type SystemAuditLogStatus = (typeof systemAuditLogStatusEnum)[number];

export const systemAuditLogs = sqliteTable(
  'system_audit_logs',
  {
    id: text('id').primaryKey(),
    action: text('action', { enum: systemAuditLogActionEnum }).notNull(),
    resourceType: text('resource_type', {
      enum: systemAuditLogResourceTypeEnum,
    }).notNull(),
    resourceId: text('resource_id').notNull(),
    status: text('status', { enum: systemAuditLogStatusEnum }).notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_system_audit_logs_action_created').on(table.action, table.createdAt),
    index('idx_system_audit_logs_resource_created').on(
      table.resourceType,
      table.resourceId,
      table.createdAt
    ),
    index('idx_system_audit_logs_status_created').on(table.status, table.createdAt),
  ]
);

export type SystemAuditLog = typeof systemAuditLogs.$inferSelect;
export type NewSystemAuditLog = typeof systemAuditLogs.$inferInsert;

// ============================================================================
// AI AUDIT LOG (provider-agnostic call recording + budget control)
// ============================================================================
//
// One row per AI provider call (success and failure) so the admin can see
// total tenant spend, per-site breakdown, per-feature breakdown, and
// per-provider breakdown without crossing tenant boundaries. Budget
// enforcement (`services/ai/client.ts::completeAI`) reads
// `currentMonthSpend` from this table.
//
// `site_id` and `provider_id` are populated from day 1 so future per-site
// reporting / per-site BUDGET enforcement does not require a follow-up
// migration.  ships per-tenant single-budget enforcement; the data
// is already wide enough for finer-grained controls later.
//
// Failed calls are persisted with `error_code` set + `cost_usd = 0` so the
// `byBreakdown` reports include error counts (e.g. provider-down minutes
// per site) without joining a separate observability table.

export const aiAuditLog = sqliteTable(
  'ai_audit_log',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id').references(() => sites.id),
    userId: text('user_id').references(() => users.id),
    /** AI feature label (`completeTest`, `copilot`, `autoCategorize`, `embeddings`). */
    feature: text('feature').notNull(),
    /** Provider id (`anthropic`, `openai`, `ollama`). */
    providerId: text('provider_id').notNull(),
    /** Provider-specific model id (e.g. `claude-haiku-4-5`). */
    modelId: text('model_id').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    /** USD cost of this call, computed from the provider's pricing table. */
    costUsd: real('cost_usd').notNull(),
    durationMs: integer('duration_ms').notNull(),
    /** Server errorCode when the call failed; null on success. */
    errorCode: text('error_code'),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
  },
  table => [
    index('idx_ai_audit_log_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_ai_audit_log_tenant_site_created').on(table.tenantId, table.siteId, table.createdAt),
    index('idx_ai_audit_log_tenant_feature').on(table.tenantId, table.feature),
    index('idx_ai_audit_log_tenant_provider').on(table.tenantId, table.providerId),
  ]
);

export const aiAuditLogRelations = relations(aiAuditLog, ({ one }) => ({
  tenant: one(tenants, {
    fields: [aiAuditLog.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [aiAuditLog.siteId],
    references: [sites.id],
  }),
  user: one(users, {
    fields: [aiAuditLog.userId],
    references: [users.id],
  }),
}));

export type AIAuditLogRow = typeof aiAuditLog.$inferSelect;
export type NewAIAuditLogRow = typeof aiAuditLog.$inferInsert;

// ============================================================================
// AI ANOMALY SNOOZES ()
// ============================================================================

/**
 * Snoozes an alert from `ai.anomalies.list` until `snoozedUntil`. Keyed
 * by (tenant, kind, cashierId, evidenceRef) — a $5000 refund silenced
 * today does not also silence a different high-ticket refund next week
 * because their `evidenceRef` (the saleId) differs.
 *
 * `evidenceRef` is nullable because aggregate detectors (`voidRate`,
 * `noSaleSessions`) flag a cashier rather than a specific event; their
 * snooze rows carry `evidence_ref = NULL` and apply across all alerts of
 * that kind for that cashier.
 */
export const aiAnomalySnoozes = sqliteTable(
  'ai_anomaly_snoozes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    kind: text('kind').notNull(),
    cashierId: text('cashier_id').references(() => users.id),
    evidenceRef: text('evidence_ref'),
    snoozedUntil: text('snoozed_until').notNull(),
    snoozedBy: text('snoozed_by')
      .notNull()
      .references(() => users.id),
    reason: text('reason'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    index('idx_ai_anomaly_snoozes_tenant_until').on(table.tenantId, table.snoozedUntil),
    index('idx_ai_anomaly_snoozes_lookup').on(
      table.tenantId,
      table.kind,
      table.cashierId,
      table.evidenceRef,
      table.snoozedUntil
    ),
  ]
);

export const aiAnomalySnoozesRelations = relations(aiAnomalySnoozes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [aiAnomalySnoozes.tenantId],
    references: [tenants.id],
  }),
  cashier: one(users, {
    fields: [aiAnomalySnoozes.cashierId],
    references: [users.id],
  }),
  snoozedByUser: one(users, {
    fields: [aiAnomalySnoozes.snoozedBy],
    references: [users.id],
  }),
}));

export type AIAnomalySnoozeRow = typeof aiAnomalySnoozes.$inferSelect;
export type NewAIAnomalySnoozeRow = typeof aiAnomalySnoozes.$inferInsert;
