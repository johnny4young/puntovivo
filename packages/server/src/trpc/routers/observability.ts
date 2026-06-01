/**
 * ENG-173 — `observability.*` tRPC namespace (Web Vitals RUM).
 *
 *   - `reportWebVital` (public) — ingest one Web Vitals sample per call.
 *     Deliberately public so login / first-paint vitals are captured before
 *     authentication. `tenant_id` is derived from `ctx` (null for anonymous
 *     page loads), NEVER from client input. When a tenant is present the
 *     sample is gated by that tenant's telemetry opt-in (ENG-135). The
 *     unauthenticated write surface is bounded by the global per-IP rate
 *     limit + the strict input bounds in `schemas/observability.ts`;
 *     ENG-165 will add per-tenant buckets.
 *   - `recentWebVitals` (managerOrAdmin) — tenant-scoped tail for the AC
 *     "rows visible / retrievable" and the future aggregation dashboard.
 *
 * @module trpc/routers/observability
 */

import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { publicProcedure, router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { tenants, webVitalSamples } from '../../db/schema.js';
import type { DatabaseInstance } from '../../db/index.js';
import { createModuleLogger } from '../../logging/logger.js';
import { recentWebVitalsInput, reportWebVitalInput } from '../schemas/observability.js';

const log = createModuleLogger('web-vitals');

/**
 * Resolve a tenant's `tenants.settings.telemetryOptIn` flag (defaults off).
 * Self-contained mirror of the canonical resolver in
 * `trpc/routers/companies.ts::resolveTelemetryOptIn` — kept local so the
 * public ingest path carries no cross-router coupling. Single primary-key read.
 *
 * Mirrors `observability/capture.ts::isTenantOptedIn`: any DB failure during
 * resolution defaults to opt-out (false) rather than throwing, so a transient
 * outage never turns a best-effort telemetry ingest into a 500.
 */
async function isTelemetryEnabled(
  db: DatabaseInstance,
  tenantId: string
): Promise<boolean> {
  try {
    const row = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    const settings = (row?.settings ?? {}) as Record<string, unknown>;
    return settings.telemetryOptIn === true;
  } catch (err) {
    log.warn({ tenantId, err }, 'telemetry opt-in lookup failed; defaulting to opt-out');
    return false;
  }
}

export const observabilityRouter = router({
  reportWebVital: publicProcedure
    .input(reportWebVitalInput)
    .mutation(async ({ ctx, input }) => {
      // ENG-173 — tenant is server-trusted: derive from the session, never
      // from client input. Null on anonymous (pre-login) page loads.
      const tenantId = ctx.tenantId;

      // Respect the per-tenant telemetry opt-in (ENG-135) when the tenant is
      // known; anonymous samples carry no tenant to opt out and are accepted.
      if (tenantId !== null) {
        const enabled = await isTelemetryEnabled(ctx.db, tenantId);
        if (!enabled) {
          return { accepted: false };
        }
      }

      await ctx.db.insert(webVitalSamples).values({
        id: nanoid(),
        tenantId,
        // ENG-173 / ENG-138 — placeholder tier until billing ships.
        tenantPlan: 'unknown',
        route: input.route,
        metric: input.metric,
        value: input.value,
        rating: input.rating,
        deviceClass: input.deviceClass,
      });

      log.info(
        {
          metric: input.metric,
          value: input.value,
          rating: input.rating,
          route: input.route,
          deviceClass: input.deviceClass,
          tenantId,
        },
        'web vital reported'
      );

      return { accepted: true };
    }),

  recentWebVitals: managerOrAdminProcedure
    .input(recentWebVitalsInput)
    .query(async ({ ctx, input }) => {
      // Multi-tenant invariant: scope by ctx.tenantId (tenantProcedure
      // guarantees it is non-null here).
      const rows = await ctx.db
        .select({
          id: webVitalSamples.id,
          route: webVitalSamples.route,
          metric: webVitalSamples.metric,
          value: webVitalSamples.value,
          rating: webVitalSamples.rating,
          deviceClass: webVitalSamples.deviceClass,
          tenantPlan: webVitalSamples.tenantPlan,
          createdAt: webVitalSamples.createdAt,
        })
        .from(webVitalSamples)
        .where(eq(webVitalSamples.tenantId, ctx.tenantId))
        .orderBy(desc(webVitalSamples.createdAt))
        .limit(input.limit)
        .all();
      return rows;
    }),
});

export type ObservabilityRouter = typeof observabilityRouter;
