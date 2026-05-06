/**
 * ENG-065c — Diagnostic reports sub-router (`reports.diagnostics.*`).
 *
 * Operator-facing bulk export for support tickets. Two procedures:
 *
 *   - `preview({fromDate, toDate})` — counts per source so the admin
 *     can size the bundle before downloading. Surfaces `willHitLimit`
 *     when any source crosses the per-table hard cap.
 *   - `export({fromDate, toDate, includeOutboxes?})` — the actual
 *     bundle. Returns a flat manifest + JSON-typed arrays per
 *     included table. The web client wraps the result in a zip via
 *     jszip and triggers a Blob download.
 *
 * Both are admin-only per ADR-0004 — the payloads echo enough of the
 * tenant's runtime state (sale items, customer names, fiscal CUFEs,
 * device identifiers) that we keep the surface to the same role that
 * already sees those rows directly in the existing UI tabs.
 *
 * **Bundle extensibility.** ADR-0003 lists 5 outboxes
 * (sync/fiscal/hardware/payment/webhook). Only the first three exist
 * today; payment_outbox is gated on ENG-063, webhook_outbox on
 * ENG-070. The `manifest.counts` keyset is intentionally locked to
 * the 5-name shape (with 0 for the missing two) so `schemaVersion: 1`
 * can be consumed by future tooling without forking. When the gated
 * outboxes ship, append their arrays to `tables.*` and bump the
 * schemaVersion.
 *
 * @module trpc/routers/reports/diagnostics
 */

import { and, count, eq, gte, lte, sql } from 'drizzle-orm';
import { router } from '../../init.js';
import { adminProcedure } from '../../middleware/roles.js';
import {
  fiscalOutbox,
  hardwareOutbox,
  operationEffects,
  operationEvents,
  syncOutbox,
} from '../../../db/schema.js';
import {
  diagnosticsExportInput,
  diagnosticsPreviewInput,
  type DiagnosticIncludeOutbox,
} from '../../schemas/reports.js';

/**
 * Hard cap per table at export time. Empirically a 7-day window for a
 * busy tenant lands ~1-2k rows per source; 30 days lands ~5-15k. The
 * 10k ceiling keeps the bundle below ~10MB serialised and surfaces a
 * narrowing hint to the operator instead of silently truncating. If a
 * tenant operationally needs more, this turns into a config knob in a
 * follow-up — not in scope for v1.
 */
const ROW_LIMIT = 10_000;

/**
 * Best-effort estimate for `operation_events` + `operation_effects`
 * row sizes in bytes. Both tables carry a small JSON `summary` /
 * `effect_data` blob; 200 bytes is the median observed during dev.
 */
const EVENT_AVG_SIZE_BYTES = 200;

const SCHEMA_VERSION = 1;

/**
 * Names locked by ADR-0003. Returned in `manifest.counts` with `0`
 * for the gated outboxes so consumers can target a stable keyset.
 */
const ALL_OUTBOX_NAMES = [
  'sync_outbox',
  'fiscal_outbox',
  'hardware_outbox',
  'payment_outbox',
  'webhook_outbox',
] as const;

type DiagnosticOutboxName = (typeof ALL_OUTBOX_NAMES)[number];

const INCLUDE_TO_TABLE: Record<DiagnosticIncludeOutbox, DiagnosticOutboxName> = {
  sync: 'sync_outbox',
  fiscal: 'fiscal_outbox',
  hardware: 'hardware_outbox',
};

function isDefaultIncludeAll(
  include: readonly DiagnosticIncludeOutbox[] | undefined
): boolean {
  return include === undefined;
}

export const diagnosticsReportsRouter = router({
  /**
   * Returns the row counts per source for the requested date range.
   * Drives the panel's "Vista previa" button. Always evaluated
   * synchronously — the heaviest query is `SELECT COUNT(*)` per table
   * which is cheap on the kernel-stamped `created_at` index path.
   */
  preview: adminProcedure
    .input(diagnosticsPreviewInput)
    .query(async ({ ctx, input }) => {
      const { fromDate, toDate } = input;

      const eventsCountRow = await ctx.db
        .select({ value: count() })
        .from(operationEvents)
        .where(
          and(
            eq(operationEvents.tenantId, ctx.tenantId),
            gte(operationEvents.createdAt, fromDate),
            lte(operationEvents.createdAt, toDate)
          )
        )
        .get();

      // operation_effects has no tenant_id; scope via parent event.
      const effectsCountRow = await ctx.db
        .select({ value: count() })
        .from(operationEffects)
        .innerJoin(
          operationEvents,
          eq(operationEffects.operationEventId, operationEvents.id)
        )
        .where(
          and(
            eq(operationEvents.tenantId, ctx.tenantId),
            gte(operationEffects.createdAt, fromDate),
            lte(operationEffects.createdAt, toDate)
          )
        )
        .get();

      const syncCountRow = await ctx.db
        .select({ value: count() })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, ctx.tenantId),
            gte(syncOutbox.createdAt, fromDate),
            lte(syncOutbox.createdAt, toDate)
          )
        )
        .get();

      const fiscalCountRow = await ctx.db
        .select({ value: count() })
        .from(fiscalOutbox)
        .where(
          and(
            eq(fiscalOutbox.tenantId, ctx.tenantId),
            gte(fiscalOutbox.createdAt, fromDate),
            lte(fiscalOutbox.createdAt, toDate)
          )
        )
        .get();

      const hardwareCountRow = await ctx.db
        .select({ value: count() })
        .from(hardwareOutbox)
        .where(
          and(
            eq(hardwareOutbox.tenantId, ctx.tenantId),
            gte(hardwareOutbox.createdAt, fromDate),
            lte(hardwareOutbox.createdAt, toDate)
          )
        )
        .get();

      // Best-effort payload size — SUM(LENGTH(payload)) for outboxes,
      // fixed estimate for events/effects.
      const syncSizeRow = await ctx.db
        .select({ value: sql<number>`COALESCE(SUM(LENGTH(${syncOutbox.payload})), 0)` })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, ctx.tenantId),
            gte(syncOutbox.createdAt, fromDate),
            lte(syncOutbox.createdAt, toDate)
          )
        )
        .get();

      const fiscalSizeRow = await ctx.db
        .select({ value: sql<number>`COALESCE(SUM(LENGTH(${fiscalOutbox.payload})), 0)` })
        .from(fiscalOutbox)
        .where(
          and(
            eq(fiscalOutbox.tenantId, ctx.tenantId),
            gte(fiscalOutbox.createdAt, fromDate),
            lte(fiscalOutbox.createdAt, toDate)
          )
        )
        .get();

      const hardwareSizeRow = await ctx.db
        .select({ value: sql<number>`COALESCE(SUM(LENGTH(${hardwareOutbox.payload})), 0)` })
        .from(hardwareOutbox)
        .where(
          and(
            eq(hardwareOutbox.tenantId, ctx.tenantId),
            gte(hardwareOutbox.createdAt, fromDate),
            lte(hardwareOutbox.createdAt, toDate)
          )
        )
        .get();

      const counts = {
        operation_events: Number(eventsCountRow?.value ?? 0),
        operation_effects: Number(effectsCountRow?.value ?? 0),
        sync_outbox: Number(syncCountRow?.value ?? 0),
        fiscal_outbox: Number(fiscalCountRow?.value ?? 0),
        hardware_outbox: Number(hardwareCountRow?.value ?? 0),
        // Locked by ADR-0003 — always 0 today; non-zero once gated
        // outboxes ship. Keeps consumers on a stable keyset.
        payment_outbox: 0,
        webhook_outbox: 0,
      };

      const willHitLimit =
        counts.operation_events > ROW_LIMIT ||
        counts.operation_effects > ROW_LIMIT ||
        counts.sync_outbox > ROW_LIMIT ||
        counts.fiscal_outbox > ROW_LIMIT ||
        counts.hardware_outbox > ROW_LIMIT;

      const estimatedSizeBytes =
        Number(syncSizeRow?.value ?? 0) +
        Number(fiscalSizeRow?.value ?? 0) +
        Number(hardwareSizeRow?.value ?? 0) +
        (counts.operation_events + counts.operation_effects) * EVENT_AVG_SIZE_BYTES;

      return {
        range: { fromDate, toDate },
        counts,
        estimatedSizeBytes,
        rowLimit: ROW_LIMIT,
        willHitLimit,
        schemaVersion: SCHEMA_VERSION,
      };
    }),

  /**
   * Returns the actual bundle. The web client zips it with jszip
   * before triggering the download. Each table is capped at
   * ROW_LIMIT; the manifest carries `warnings` for any source that
   * hit the cap so the operator knows to narrow the range.
   */
  export: adminProcedure
    .input(diagnosticsExportInput)
    .query(async ({ ctx, input }) => {
      const { fromDate, toDate, includeOutboxes } = input;
      const includeAll = isDefaultIncludeAll(includeOutboxes);
      const includeSync = includeAll || includeOutboxes!.includes('sync');
      const includeFiscal = includeAll || includeOutboxes!.includes('fiscal');
      const includeHardware = includeAll || includeOutboxes!.includes('hardware');

      const events = await ctx.db
        .select()
        .from(operationEvents)
        .where(
          and(
            eq(operationEvents.tenantId, ctx.tenantId),
            gte(operationEvents.createdAt, fromDate),
            lte(operationEvents.createdAt, toDate)
          )
        )
        .limit(ROW_LIMIT)
        .all();

      const effects = await ctx.db
        .select({
          id: operationEffects.id,
          operationEventId: operationEffects.operationEventId,
          kind: operationEffects.kind,
          resourceType: operationEffects.resourceType,
          resourceId: operationEffects.resourceId,
          effectData: operationEffects.effectData,
          createdAt: operationEffects.createdAt,
        })
        .from(operationEffects)
        .innerJoin(
          operationEvents,
          eq(operationEffects.operationEventId, operationEvents.id)
        )
        .where(
          and(
            eq(operationEvents.tenantId, ctx.tenantId),
            gte(operationEffects.createdAt, fromDate),
            lte(operationEffects.createdAt, toDate)
          )
        )
        .limit(ROW_LIMIT)
        .all();

      const sync = includeSync
        ? await ctx.db
            .select()
            .from(syncOutbox)
            .where(
              and(
                eq(syncOutbox.tenantId, ctx.tenantId),
                gte(syncOutbox.createdAt, fromDate),
                lte(syncOutbox.createdAt, toDate)
              )
            )
            .limit(ROW_LIMIT)
            .all()
        : [];

      const fiscal = includeFiscal
        ? await ctx.db
            .select()
            .from(fiscalOutbox)
            .where(
              and(
                eq(fiscalOutbox.tenantId, ctx.tenantId),
                gte(fiscalOutbox.createdAt, fromDate),
                lte(fiscalOutbox.createdAt, toDate)
              )
            )
            .limit(ROW_LIMIT)
            .all()
        : [];

      const hardware = includeHardware
        ? await ctx.db
            .select()
            .from(hardwareOutbox)
            .where(
              and(
                eq(hardwareOutbox.tenantId, ctx.tenantId),
                gte(hardwareOutbox.createdAt, fromDate),
                lte(hardwareOutbox.createdAt, toDate)
              )
            )
            .limit(ROW_LIMIT)
            .all()
        : [];

      // Re-run a counting pass for the full counts so the manifest
      // reflects what's in scope for the range, regardless of the
      // include filter. This mirrors the preview shape and lets the
      // operator see "I excluded fiscal but there were 412 fiscal
      // rows in this window".
      const eventsTotalRow = await ctx.db
        .select({ value: count() })
        .from(operationEvents)
        .where(
          and(
            eq(operationEvents.tenantId, ctx.tenantId),
            gte(operationEvents.createdAt, fromDate),
            lte(operationEvents.createdAt, toDate)
          )
        )
        .get();

      const effectsTotalRow = await ctx.db
        .select({ value: count() })
        .from(operationEffects)
        .innerJoin(
          operationEvents,
          eq(operationEffects.operationEventId, operationEvents.id)
        )
        .where(
          and(
            eq(operationEvents.tenantId, ctx.tenantId),
            gte(operationEffects.createdAt, fromDate),
            lte(operationEffects.createdAt, toDate)
          )
        )
        .get();

      const syncTotalRow = await ctx.db
        .select({ value: count() })
        .from(syncOutbox)
        .where(
          and(
            eq(syncOutbox.tenantId, ctx.tenantId),
            gte(syncOutbox.createdAt, fromDate),
            lte(syncOutbox.createdAt, toDate)
          )
        )
        .get();

      const fiscalTotalRow = await ctx.db
        .select({ value: count() })
        .from(fiscalOutbox)
        .where(
          and(
            eq(fiscalOutbox.tenantId, ctx.tenantId),
            gte(fiscalOutbox.createdAt, fromDate),
            lte(fiscalOutbox.createdAt, toDate)
          )
        )
        .get();

      const hardwareTotalRow = await ctx.db
        .select({ value: count() })
        .from(hardwareOutbox)
        .where(
          and(
            eq(hardwareOutbox.tenantId, ctx.tenantId),
            gte(hardwareOutbox.createdAt, fromDate),
            lte(hardwareOutbox.createdAt, toDate)
          )
        )
        .get();

      const counts = {
        operation_events: Number(eventsTotalRow?.value ?? 0),
        operation_effects: Number(effectsTotalRow?.value ?? 0),
        sync_outbox: Number(syncTotalRow?.value ?? 0),
        fiscal_outbox: Number(fiscalTotalRow?.value ?? 0),
        hardware_outbox: Number(hardwareTotalRow?.value ?? 0),
        payment_outbox: 0,
        webhook_outbox: 0,
      };

      const warnings: string[] = [];
      if (counts.operation_events > ROW_LIMIT) warnings.push('rowLimitHit:operation_events');
      if (counts.operation_effects > ROW_LIMIT) warnings.push('rowLimitHit:operation_effects');
      if (includeSync && counts.sync_outbox > ROW_LIMIT) warnings.push('rowLimitHit:sync_outbox');
      if (includeFiscal && counts.fiscal_outbox > ROW_LIMIT)
        warnings.push('rowLimitHit:fiscal_outbox');
      if (includeHardware && counts.hardware_outbox > ROW_LIMIT)
        warnings.push('rowLimitHit:hardware_outbox');

      return {
        manifest: {
          schemaVersion: SCHEMA_VERSION,
          generatedAt: new Date().toISOString(),
          tenantId: ctx.tenantId,
          range: { fromDate, toDate },
          rowLimit: ROW_LIMIT,
          counts,
          warnings,
          includedOutboxes: includeAll
            ? (['sync', 'fiscal', 'hardware'] as const)
            : (includeOutboxes ?? []),
        },
        tables: {
          operation_events: events,
          operation_effects: effects,
          sync_outbox: sync,
          fiscal_outbox: fiscal,
          hardware_outbox: hardware,
        },
      };
    }),
});

export type DiagnosticsReportsRouter = typeof diagnosticsReportsRouter;

// Re-exported for tests so the assertion threshold tracks the source.
export const __TEST_ROW_LIMIT = ROW_LIMIT;
export const __TEST_SCHEMA_VERSION = SCHEMA_VERSION;
// Re-exported so future ENG-063 / ENG-070 tickets can update the
// keyset in lockstep with the bundle schema version bump.
export { ALL_OUTBOX_NAMES };
// Touch INCLUDE_TO_TABLE so it isn't tree-shaken into a lint warning.
void INCLUDE_TO_TABLE;
