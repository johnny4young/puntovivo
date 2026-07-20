/**
 * AI usage quotas (first slice of website claim alignment).
 *
 * The website draft promises "800 Co-pilot questions + 200 OCR invoices
 * per site per month". This module is the enforcement layer that backs
 * those numbers with real product behavior:
 *
 * - `AI_QUOTAS` carries the v1 hardcoded limits per feature.
 * - `countMonthlyAiCalls` counts SUCCESSFUL calls (`errorCode IS NULL`)
 * in the current calendar month for a given (tenant, site, feature)
 * using the `idx_ai_audit_log_tenant_site_created` composite index.
 * Failed calls (provider 5xx, AI_DISABLED short-circuits, quota
 * rejections themselves) do NOT consume quota — a flaky upstream
 * cannot cook the tenant.
 * - `requireAiQuotaAvailable` runs the count + throws
 * `AI_QUOTA_EXCEEDED` when the limit is reached. Call sites wire
 * this BEFORE invoking the provider so a rejected request never
 * produces an audit row.
 *
 * Calendar-month reset is implicit: queries use
 * `startOfMonth ≤ createdAt < startOfNextMonth`, so the counter "rolls
 * over" the moment a new month begins. No background job needed.
 * Mirrors the pattern that `currentMonthSpend` already uses for the
 * monthly USD budget readout.
 *
 * The quotas live as code constants instead of a tenant settings field
 * so the v1 enforcement matches the website copy exactly — when the
 * operator wants to tune them, they edit `AI_QUOTAS` and ship a new
 * build. A runtime-tunable panel is captured as a follow-up.
 *
 * @module services/ai/quotas
 */
import { and, count, eq, gte, isNull, lt } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { aiAuditLog } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

/**
 * Per-site monthly quota for each AI feature that the public website
 * makes a numeric promise about. Hardcoded by design: the values are
 * the source of truth that the marketing copy mirrors. To change a
 * limit, edit this object and ship a new build.
 *
 * Adding a new feature here is NOT enough to enforce it — the call
 * site must invoke `requireAiQuotaAvailable({ ..., feature })` before
 * the provider call.
 */
export const AI_QUOTAS = {
  copilot: 800,
  invoiceOcr: 200,
} as const;

export type QuotaFeature = keyof typeof AI_QUOTAS;

export interface CountMonthlyAiCallsArgs {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  feature: QuotaFeature;
  /** Defaults to `new Date()`; injectable for deterministic tests. */
  now?: Date;
}

/**
 * Calendar-month boundary helper. Returns `[startOfMonth, startOfNextMonth]`
 * ISO strings in local time, matching the convention `currentMonthSpend`
 * uses so both readouts agree on what "this month" means.
 */
function monthBounds(now: Date): { start: string; end: string } {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
  };
}

/**
 * Count successful calls of a feature within the current calendar
 * month for (tenant, site). Errored rows are excluded so a flaky
 * provider does not consume quota.
 */
export async function countMonthlyAiCalls(args: CountMonthlyAiCallsArgs): Promise<number> {
  const { db, tenantId, siteId, feature, now = new Date() } = args;
  const { start, end } = monthBounds(now);
  const row = await db
    .select({ total: count(aiAuditLog.id) })
    .from(aiAuditLog)
    .where(
      and(
        eq(aiAuditLog.tenantId, tenantId),
        eq(aiAuditLog.siteId, siteId),
        eq(aiAuditLog.feature, feature),
        isNull(aiAuditLog.errorCode),
        gte(aiAuditLog.createdAt, start),
        lt(aiAuditLog.createdAt, end)
      )
    )
    .get();
  const raw = row?.total;
  if (raw === null || raw === undefined) return 0;
  return typeof raw === 'number' ? raw : Number(raw) || 0;
}

export interface QuotaProjection {
  feature: QuotaFeature;
  used: number;
  limit: number;
  /** ISO timestamp of the first second of next calendar month. */
  resetsAt: string;
}

export type RequireAiQuotaAvailableArgs = CountMonthlyAiCallsArgs;

function quotaFeatures(): QuotaFeature[] {
  return Object.keys(AI_QUOTAS) as QuotaFeature[];
}

/**
 * Return the quota payload shape without charging a concrete site.
 * Used when an admin has no active site context, so the settings UI
 * can still render limits and the next reset date from the same
 * source of truth as the enforced path.
 */
export function projectEmptyAiQuotas(
  now: Date = new Date()
): Record<QuotaFeature, QuotaProjection> {
  const resetsAt = monthBounds(now).end;
  return Object.fromEntries(
    quotaFeatures().map(feature => [
      feature,
      { feature, used: 0, limit: AI_QUOTAS[feature], resetsAt },
    ])
  ) as Record<QuotaFeature, QuotaProjection>;
}

/**
 * Throw `AI_QUOTA_EXCEEDED` when the site has already consumed the
 * monthly limit for `feature`. Returns the post-check projection so
 * the call site can log the residual capacity if it wants.
 *
 * The error details carry `{ feature, used, limit, resetsAt }` so the
 * client toast can render "750/800 — renews on 2026-06-01" without an
 * extra round trip.
 *
 * Site-less calls are bypassed by the router because the quota is
 * explicitly per site; `projectEmptyAiQuotas` handles the read-side
 * payload for that admin context.
 */
export async function requireAiQuotaAvailable(
  args: RequireAiQuotaAvailableArgs
): Promise<QuotaProjection> {
  const { feature, now = new Date() } = args;
  const limit = AI_QUOTAS[feature];
  const used = await countMonthlyAiCalls(args);
  const resetsAt = monthBounds(now).end;
  if (used >= limit) {
    throwServerError({
      trpcCode: 'TOO_MANY_REQUESTS',
      errorCode: 'AI_QUOTA_EXCEEDED',
      message: `Monthly ${feature} quota exhausted for this site`,
      details: { feature, used, limit, resetsAt },
    });
  }
  return { feature, used, limit, resetsAt };
}

/**
 * Project the current quota state for both features for an admin
 * settings panel. Used by `ai.settings.get` so the UI can render one
 * coherent payload with the residual capacity per feature.
 *
 * Returns a stable shape regardless of whether the site currently has
 * audit rows or not — a fresh tenant on day 1 reads `{ used: 0,
 * limit: 800 | 200, resetsAt: <next month> }`.
 */
export async function projectAiQuotas(args: {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  now?: Date;
}): Promise<Record<QuotaFeature, QuotaProjection>> {
  // Snapshot `now` once before the parallel queries so both features
  // resolve against the same calendar month + `resetsAt`. Without
  // this, two concurrent Promise.all branches calling `new Date()`
  // independently could land on opposite sides of a month boundary
  // and report inconsistent windows.
  const resolvedNow = args.now ?? new Date();
  const resetsAt = monthBounds(resolvedNow).end;
  const projections = await Promise.all(
    quotaFeatures().map(async feature => {
      const used = await countMonthlyAiCalls({
        ...args,
        feature,
        now: resolvedNow,
      });
      return {
        feature,
        used,
        limit: AI_QUOTAS[feature],
        resetsAt,
      };
    })
  );
  return Object.fromEntries(projections.map(p => [p.feature, p])) as Record<
    QuotaFeature,
    QuotaProjection
  >;
}
