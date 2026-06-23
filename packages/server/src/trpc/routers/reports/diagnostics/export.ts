import { and, count, eq, gte, lte } from 'drizzle-orm';
import {
  fiscalOutbox,
  hardwareOutbox,
  operationEffects,
  operationEvents,
  syncOutbox,
  tenants,
} from '../../../../db/schema.js';
import { diagnosticsExportInput } from '../../../schemas/reports.js';
import { sanitizeRows } from '../../../../services/diagnostics/sanitize.js';
import { getActiveRuntimeConfig } from '../../../../config/runtime.js';
import { getAuthorityTopology } from '../../../../services/devices/authority.js';
import { buildDiagnosticZipFilename } from '../../../../services/exports/envelope.js';
import {
  ROW_LIMIT,
  SCHEMA_VERSION,
  gatedAdmin,
  isDefaultIncludeAll,
  projectRuntimeForManifest,
} from './helpers.js';

export const exportProcedures = {
  /**
   * Returns the actual bundle. The web client zips it with jszip
   * before triggering the download. Each table is capped at
   * ROW_LIMIT; the manifest carries `warnings` for any source that
   * hit the cap so the operator knows to narrow the range.
   */
  export: gatedAdmin.input(diagnosticsExportInput).query(async ({ ctx, input }) => {
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
      .innerJoin(operationEvents, eq(operationEffects.operationEventId, operationEvents.id))
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
      .innerJoin(operationEvents, eq(operationEffects.operationEventId, operationEvents.id))
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

    // ENG-066 — sanitize JSON-shaped fields before serialization.
    // The sanitizer recurses into each row's JSON column and
    // replaces sensitive keys (password / token / jwt / apiKey /
    // pan / cvv / certificate / ...) with [REDACTED]. The bundle's
    // manifest tells the operator which keys were redacted per
    // source so the bundle is auditable AND auto-sanitized.
    const sanitizedEvents = sanitizeRows(events, ['summary']);
    const sanitizedEffects = sanitizeRows(effects, ['effectData']);
    const sanitizedSync = sanitizeRows(sync, ['payload', 'lastError']);
    const sanitizedFiscal = sanitizeRows(fiscal, ['payload', 'lastError']);
    const sanitizedHardware = sanitizeRows(hardware, ['payload', 'lastError']);

    const redactedKeysByTable: Record<string, string[]> = {
      operation_events: [...sanitizedEvents.redactedKeys].sort(),
      operation_effects: [...sanitizedEffects.redactedKeys].sort(),
      sync_outbox: [...sanitizedSync.redactedKeys].sort(),
      fiscal_outbox: [...sanitizedFiscal.redactedKeys].sort(),
      hardware_outbox: [...sanitizedHardware.redactedKeys].sort(),
    };

    const runtime = getActiveRuntimeConfig();
    const authorityTopology = await getAuthorityTopology(ctx.db, ctx.tenantId, runtime);

    // ENG-103 — Suggested filename for the client-side ZIP. The
    // tenant slug is the marketing identifier persisted in
    // `tenants.slug` (lowercase, ASCII, kebab); it falls back to
    // the tenant id when the row is missing or has an empty slug.
    const tenantRow = await ctx.db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .get();
    const tenantSlug = tenantRow?.slug?.trim() ?? ctx.tenantId;
    const suggestedFilename = buildDiagnosticZipFilename({
      tenantSlug,
    });

    return {
      suggestedFilename,
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
        // ENG-066 — redaction surface so the bundle is self-auditable.
        // `sanitized: true` is a stable flag; `redactedKeysByTable`
        // is per-source so a reviewer can quickly answer
        // "did this bundle leak something?".
        sanitized: true as const,
        redactedKeysByTable,
        // ENG-072 — Authority Node runtime metadata captured at the
        // time of export. Additive to the manifest; the existing
        // schemaVersion=1 stays valid because consumers tolerate
        // unknown top-level keys per ADR-0003 evolution discipline.
        runtime: projectRuntimeForManifest(runtime),
        authorityTopology,
      },
      tables: {
        operation_events: sanitizedEvents.rows,
        operation_effects: sanitizedEffects.rows,
        sync_outbox: sanitizedSync.rows,
        fiscal_outbox: sanitizedFiscal.rows,
        hardware_outbox: sanitizedHardware.rows,
      },
    };
  }),
};
