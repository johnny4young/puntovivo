/**
 * Drizzle schema — hardware domain.
 *
 * ENG-178 — relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/hardware
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { sites, tenants } from './auth.js';

// ============================================================================
// SITE PERIPHERALS (ENG-060 — peripheral registry + hardware ports)
// ============================================================================

/**
 * Closed list of peripheral kinds a site can configure. The contracts +
 * default drivers for `printer` (system) and `payment_terminal` (manual)
 * ship with ENG-060; ENG-061 (scanner pipeline), ENG-062 (ESC/POS + cash
 * drawer), and ENG-063 (Bold/Wompi/MercadoPago) extend the driver matrix
 * without touching this enum.
 *
 * `customer_display` is reserved for a future ticket; ENG-060 surfaces
 * the enum value but no driver registration is permitted.
 */
export const peripheralKindEnum = [
  'printer',
  'cash_drawer',
  'scanner',
  'payment_terminal',
  'customer_display',
] as const;
export type PeripheralKind = (typeof peripheralKindEnum)[number];

/**
 * Last test result captured on the most recent `peripherals.test`
 * invocation. Null when never tested. The admin UI maps this to a
 * status chip (`ok` → green, `failed` → red, null → neutral).
 */
export const peripheralTestResultEnum = ['ok', 'failed'] as const;
export type PeripheralTestResult = (typeof peripheralTestResultEnum)[number];

/**
 * Per-site configuration of physical and virtual peripherals.
 *
 * Lookup pattern (per ADR docs/HARDWARE-POS.md): the registry resolves
 * the active row by `(tenant_id, site_id, kind)` and dispatches to the
 * appropriate adapter via `driver`. The partial unique index enforces
 * "at most one active peripheral per kind per site" — toggling
 * `is_active=0` on the previous row is the migration path when an
 * operator swaps drivers (e.g. system → escpos).
 */
export const sitePeripherals = sqliteTable(
  'site_peripherals',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    kind: text('kind', { enum: peripheralKindEnum }).notNull(),
    /**
     * Driver discriminator — `'system'` / `'escpos'` for printers,
     * `'manual'` / `'bold'` / `'wompi'` / `'mercadopago'` for payment
     * terminals, etc. Each driver self-validates `config_json` via a
     * Zod schema exported alongside its adapter class.
     */
    driver: text('driver').notNull(),
    /** Driver-specific JSON config (e.g. `{channel:'tcp',host:'192.168.1.50',port:9100}` for escpos). */
    config: text('config_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Optional human-friendly label shown on the admin list ("Caja principal", "Cocina"). */
    displayName: text('display_name'),
    /** Soft activation flag; the partial unique only fires on `is_active=1`. */
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    /** ISO timestamp of the most recent `peripherals.test` invocation. */
    lastTestedAt: text('last_tested_at'),
    /** Result of the most recent test; null until first run. */
    lastTestResult: text('last_test_result', { enum: peripheralTestResultEnum }),
    /** Free-form forensics blob for the last test (errors, latency, etc.). */
    lastTestDetails: text('last_test_details', { mode: 'json' }).$type<
      Record<string, unknown> | null
    >(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    // Primary lookup path for the registry resolver.
    index('idx_site_peripherals_tenant_site_kind').on(
      table.tenantId,
      table.siteId,
      table.kind
    ),
    // Cross-site listing for the admin index page.
    index('idx_site_peripherals_tenant_kind').on(table.tenantId, table.kind),
    // Partial unique: at most one ACTIVE peripheral per kind per site.
    uniqueIndex('idx_site_peripherals_active_per_kind')
      .on(table.tenantId, table.siteId, table.kind)
      .where(sql`${table.isActive} = 1`),
  ]
);

export const sitePeripheralsRelations = relations(sitePeripherals, ({ one }) => ({
  tenant: one(tenants, {
    fields: [sitePeripherals.tenantId],
    references: [tenants.id],
  }),
  site: one(sites, {
    fields: [sitePeripherals.siteId],
    references: [sites.id],
  }),
}));

export type SitePeripheralRow = typeof sitePeripherals.$inferSelect;
export type NewSitePeripheralRow = typeof sitePeripherals.$inferInsert;

// ============================================================================
// HARDWARE OUTBOX (ENG-062 — ESC/POS printer + cash drawer queue)
// ============================================================================
//
// Mirror of `fiscal_outbox` (ENG-057) for peripheral I/O. ENG-060 deferred
// this table to here because the two default drivers (`system` printer +
// `manual` payment terminal) had no async fan-out. With ENG-062's `escpos`
// driver landing real device I/O — which can fail recoverably on USB
// unplug, paper out, or TCP-host unreachable — the queue lets the cashier
// keep moving while the worker retries in the background.
//
// Status machine + retry policy + claim_token concurrency are inherited
// from `lib/outbox/createOutboxKernel`. The hardware worker
// (`services/peripherals/hardware-worker.ts`) drives state transitions;
// failed receipt prints are recoverable through the standard outbox
// flow without re-triggering the original sale completion.

/**
 * Closed list of hardware outbox lifecycle states. Mirror of the fiscal
 * outbox enum but with `printed` / `failed` instead of accepted / rejected
 * because the printer doesn't issue a verdict — it either flushed bytes
 * to the device or it didn't.
 */
export const hardwareOutboxStatusEnum = [
  'queued',
  'submitting',
  'printed',
  'failed',
  'retrying',
  'dead_letter',
] as const;
export type HardwareOutboxStatus = (typeof hardwareOutboxStatusEnum)[number];

/**
 * Closed list of hardware outbox kinds keyed to the `PrintJobKind` union
 * (`services/peripherals/contracts/receipt-printer.ts`) plus the cash
 * drawer kick. Adding a kind requires updating the worker dispatcher.
 */
export const hardwareOutboxKindEnum = [
  'print-receipt',
  'print-fiscal-dee',
  'print-quotation',
  'print-kitchen-ticket',
  'kick-drawer',
] as const;
export type HardwareOutboxKind = (typeof hardwareOutboxKindEnum)[number];

export const hardwareOutbox = sqliteTable(
  'hardware_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    status: text('status', { enum: hardwareOutboxStatusEnum }).notNull().default('queued'),
    kind: text('kind', { enum: hardwareOutboxKindEnum }).notNull(),
    /**
     * The peripheral row that owned this attempt. Nullable + ON DELETE
     * SET NULL so we don't lose history when an admin removes a
     * peripheral row mid-flight; the worker treats null as
     * "peripheral was unregistered" and dead-letters.
     */
    peripheralId: text('peripheral_id').references(() => sitePeripherals.id, {
      onDelete: 'set null',
    }),
    /** Snapshot of the print job + transport opts so the worker can retry without re-resolving. */
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    /** `NormalizedHardwareError` + transport-level details written by the kernel on `fail`. */
    lastError: text('last_error', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    priority: real('priority').notNull().default(0),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    /**
     * ENG-067b — envelope-derived dedup key. Nullable so legacy
     * callers without an envelope keep producing independent rows.
     * The partial unique index in 0018 only guards rows where this
     * is non-null. Set by `enqueueHardware` from the input
     * `idempotencyKey`; left null when the caller doesn't pass one.
     */
    idempotencyKey: text('idempotency_key'),
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
    index('idx_hardware_outbox_tenant_status_retry').on(
      table.tenantId,
      table.status,
      table.nextRetryAt
    ),
    // Drilldown for "show retry history of this peripheral" + admin
    // peripheral-detail surfaces planned for ENG-065.
    index('idx_hardware_outbox_peripheral').on(table.peripheralId),
    // Operations Center listing + peek.
    index('idx_hardware_outbox_tenant_created').on(table.tenantId, table.createdAt),
    // ENG-067b — partial unique idempotency guard: at most one outbox row
    // per (tenant, kind, idempotency_key) among rows that CARRY a key;
    // null-keyed rows are unlimited. Previously hand-appended SQL (the old
    // 0018_hardware_outbox_idempotency.sql); declared here since the
    // 2026-06 baseline squash. Mirror of the sync_outbox pattern.
    uniqueIndex('idx_hardware_outbox_idempotent')
      .on(table.tenantId, table.kind, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ]
);

export const hardwareOutboxRelations = relations(hardwareOutbox, ({ one }) => ({
  tenant: one(tenants, {
    fields: [hardwareOutbox.tenantId],
    references: [tenants.id],
  }),
  peripheral: one(sitePeripherals, {
    fields: [hardwareOutbox.peripheralId],
    references: [sitePeripherals.id],
  }),
}));

export type HardwareOutboxRow = typeof hardwareOutbox.$inferSelect;
export type NewHardwareOutboxRow = typeof hardwareOutbox.$inferInsert;
