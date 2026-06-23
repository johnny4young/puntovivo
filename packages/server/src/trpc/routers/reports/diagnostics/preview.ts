import { and, count, eq, gte, lte, sql } from 'drizzle-orm';
import {
  fiscalOutbox,
  hardwareOutbox,
  operationEffects,
  operationEvents,
  syncOutbox,
} from '../../../../db/schema.js';
import { diagnosticsPreviewInput } from '../../../schemas/reports.js';
import { getActiveRuntimeConfig } from '../../../../config/runtime.js';
import { getAuthorityTopology } from '../../../../services/devices/authority.js';
import {
  EVENT_AVG_SIZE_BYTES,
  ROW_LIMIT,
  SCHEMA_VERSION,
  gatedAdmin,
  projectRuntimeForManifest,
} from './helpers.js';

export const previewProcedures = {
  /**
   * Returns the row counts per source for the requested date range.
   * Drives the panel's "Vista previa" button. Always evaluated
   * synchronously — the heaviest query is `SELECT COUNT(*)` per table
   * which is cheap on the kernel-stamped `created_at` index path.
   */
  preview: gatedAdmin.input(diagnosticsPreviewInput).query(async ({ ctx, input }) => {
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
      .innerJoin(operationEvents, eq(operationEffects.operationEventId, operationEvents.id))
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

    const runtime = getActiveRuntimeConfig();
    const authorityTopology = await getAuthorityTopology(ctx.db, ctx.tenantId, runtime);

    return {
      range: { fromDate, toDate },
      counts,
      estimatedSizeBytes,
      rowLimit: ROW_LIMIT,
      willHitLimit,
      schemaVersion: SCHEMA_VERSION,
      // ENG-072 — surface the Authority Node runtime metadata so an
      // admin can verify the boot mode without downloading the
      // bundle.
      runtime: projectRuntimeForManifest(runtime),
      authorityTopology,
    };
  }),
};
