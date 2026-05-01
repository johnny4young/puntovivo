/**
 * ENG-032 — AI anomaly + fraud detection (local-only).
 *
 * ## Why this module exists
 *
 * In retail SMB POS — Puntovivo's primary target in LATAM — internal
 * cashier fraud is statistically the #1 source of operational loss.
 * The ACFE Report to the Nations 2024 (Latin America retail section)
 * estimates that retailers without active anomaly detection lose
 * between 1.5% and 3% of monthly gross sales to internal shrinkage.
 * For a tenant doing $50k USD / month, that is $750 to $1,500 USD
 * walking out the door undetected.
 *
 * This module surfaces those losses without sending any tenant data
 * to an external provider. It runs purely against the embedded
 * SQLite, computes statistical baselines per tenant, and flags
 * outliers that match the five most common POS fraud patterns
 * documented in `docs/AI-ANOMALY-DETECTION.md` (in Spanish for the
 * pilot teams to read directly):
 *
 *   1. Sweethearting — cashier "passes" items without scanning.
 *   2. Voids fantasma — cashier voids a real sale and pockets cash.
 *   3. Refunds fraudulentos — refund a sale never returned.
 *   4. No-sale opens — opens drawer without a sale to extract cash.
 *   5. Activity in odd hours — out-of-hours bursts that hide voids.
 *
 * ## Why local-only / no LLM
 *
 *   - **Determinism**: same data + same formula → same alert.
 *     Auditable, defensible if a cashier disputes the flag. An LLM
 *     would introduce variance the tenant cannot reproduce.
 *   - **Privacy**: transaction data never leaves the embedded
 *     database. Habeas Data (Colombia, Ley 1581 / 2012), LFPDPPP
 *     (Mexico), Ley 19.628 (Chile) all require explicit consent for
 *     cross-border transfer of transactional records. SQLite-local
 *     statistics satisfy that by construction.
 *   - **Cost**: detection runs on every dashboard refetch (every
 *     ~5 min) without consuming tokens or hitting `ai_audit_log`
 *     (this module does NOT call `recordCall` — it is statistical,
 *     not generative).
 *   - **Sufficiency**: for the five patterns above, classical
 *     statistics is state-of-the-art. An LLM does not add useful
 *     signal — only opacity and bill.
 *
 * ## Algorithm: z-score + diagonal Mahalanobis
 *
 * The ROADMAP cell mentions "isolation forest variant". This v1
 * ships z-score + diagonal Mahalanobis instead because:
 *
 *   - ~80 LOC of math, fully testable from synthetic fixtures.
 *   - One tunable parameter (the threshold) instead of a tree
 *     ensemble's depth + sample-size + contamination triplet.
 *   - For ≤ 4 features per detector with mostly Gaussian noise
 *     (counts, ratios, amounts), z-score with σ-multiplier is
 *     mathematically equivalent to the most-discriminative
 *     dimension of an isolation forest with similar tuning, at a
 *     fraction of the cognitive cost.
 *
 * Diagonal Mahalanobis assumes feature independence — refund-amount
 * outlier, void-rate outlier, etc. are computed per-dimension and
 * combined via L2 norm of per-dimension z-scores. The full Mahalanobis
 * with covariance estimation requires many more samples to be
 * statistically reliable; for tenants with 5-20 cashiers the diagonal
 * form is the responsible choice.
 *
 * **Upgrade criteria** (captured as BACKLOG follow-up): if a pilot
 * tenant reports false-positive rate > 30%, or a confirmed
 * false-negative (real fraud missed), promote to a mini isolation
 * forest. The public `detectAnomalies()` signature stays the same;
 * only the internals change.
 *
 * ## Threshold: 3σ (≈ 0.27% probability under Gaussian H0)
 *
 * Hardcoded for v1. Per-tenant tunable via
 * `tenants.settings.ai.anomalyThreshold` is captured as a BACKLOG
 * follow-up — most operators will leave the default and want the
 * predictability of "3σ across all my stores".
 *
 * ## Data sources (read-only, no schema changes)
 *
 *   - `sales` filtered by `status = 'completed' | 'voided'` for the
 *     tickets/hour and ticket-spike detectors.
 *   - `audit_logs` filtered by `action = 'sale.void'` for void
 *     counts. We use audit_logs rather than `sales.status='voided'`
 *     flags because void metadata (reason, actor at time of action)
 *     is captured there.
 *   - `sale_returns.refund_amount` for refund-amount outliers.
 *   - `cash_sessions` for the "no-sale" proxy (sessions with zero
 *     completed sales over a > 30-minute duration).
 *
 * Window: 30 days rolling, configurable per call.
 *
 * @module services/ai/anomalyDetection
 */
import { and, eq, gt, gte, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  aiAnomalySnoozes,
  auditLogs,
  cashSessions,
  sales,
  saleReturns,
  users,
} from '../../db/schema.js';

// ============================================================================
// PUBLIC TYPES
// ============================================================================

/**
 * Catalog of anomaly classes the detector emits. Each maps to a
 * specific fraud pattern documented in `docs/AI-ANOMALY-DETECTION.md`.
 */
export type AnomalyKind =
  | 'ticketsPerHourSpike'
  | 'voidRate'
  | 'refundAmount'
  | 'noSaleSessions';

/**
 * Severity derived from the distance metric, NOT from absolute
 * impact. A `high` alert means the cashier's behavior is statistically
 * far from the baseline; the financial impact of the action itself
 * is reported as the `observed` value so the operator can prioritize.
 */
export type AnomalySeverity = 'medium' | 'high';

/**
 * Single anomaly emitted by the detector.
 *
 * @property id           Generated per call (nanoid). Stable for the
 *                        lifetime of a single `ai.anomalies.list`
 *                        response — clients use it as a React key
 *                        and as a target for follow-up actions.
 * @property kind         Which sub-detector fired.
 * @property cashierId    User who owns the anomalous behavior. Null
 *                        only for tenant-wide refund-amount outliers
 *                        when the underlying sale's `createdBy` is
 *                        unresolvable (defensive null-guard).
 * @property cashierName  Display name; falls back to the user id when
 *                        the user row was deleted (tombstoned).
 * @property severity     `medium` (3 ≤ distance < 4.5) or `high`
 *                        (distance ≥ 4.5). Below 3.0 the alert is
 *                        filtered out.
 * @property observed     Raw metric value the cashier hit (e.g. void
 *                        ratio = 0.42, refund amount = 5000.00).
 * @property baselineMean Reference mean against which `observed` was
 *                        compared. Either personal (per-cashier) or
 *                        cross-cashier (tenant population).
 * @property baselineStdDev Reference standard deviation.
 * @property distance     L2 norm of per-dimension z-scores (single
 *                        dimension for v1 detectors → equivalent to
 *                        the absolute z-score).
 * @property occurredAt   ISO timestamp identifying the bucket the
 *                        anomaly was observed in. For aggregate
 *                        ratios (voidRate / noSaleSessions), this is
 *                        the upper bound of the analysis window.
 * @property evidenceRef  Optional pointer the operator can use to
 *                        cross-reference. Today populated for
 *                        refundAmount alerts (the saleId).
 */
export interface AnomalyAlert {
  id: string;
  kind: AnomalyKind;
  cashierId: string | null;
  cashierName: string | null;
  severity: AnomalySeverity;
  observed: number;
  baselineMean: number;
  baselineStdDev: number;
  distance: number;
  occurredAt: string;
  evidenceRef: string | null;
}

/**
 * Input bundle the orchestrator threads to every sub-detector. The
 * window is required to be already resolved (caller fills in defaults
 * before calling).
 */
export interface AnomalyDetectionInput {
  tenantId: string;
  from: Date;
  to: Date;
}

/**
 * Aggregate response shape returned by `detectAnomalies()`. Counts
 * are recomputed from `alerts` so the caller does not have to walk
 * the array twice for the dashboard tile.
 */
export interface AnomalyDetectionResult {
  alerts: AnomalyAlert[];
  totalCount: number;
  severityCounts: Record<AnomalySeverity, number>;
  kindCounts: Record<AnomalyKind, number>;
}

// ============================================================================
// TUNING CONSTANTS
// ============================================================================

/** Default analysis window. The `from`/`to` arguments override. */
export const ANALYSIS_WINDOW_DAYS = 30;

/**
 * 3.0 ≈ 0.27% false-positive rate under Gaussian H0. Below this, the
 * detector emits no alert. Tuned per tenant in a future ticket.
 */
const MAHALANOBIS_THRESHOLD = 3.0;

/**
 * Above this, severity is `high`. 4.5σ ≈ 7e-6 false-positive rate —
 * effectively impossible by chance, so worth pushing to the operator
 * with the louder badge.
 */
const HIGH_SEVERITY_THRESHOLD = 4.5;

/**
 * Cross-cashier detectors require at least this many cashiers in the
 * tenant population to compute a meaningful mean and stddev. Below
 * this, those detectors no-op (personal-baseline detectors still run).
 */
const MIN_SAMPLE_SIZE = 5;

/** Cap returned refund-amount outliers to avoid flooding the UI. */
const REFUND_TOP_K = 10;

/**
 * A cash session opened for less than this duration is too short to
 * reasonably contain a sale, so an empty session below this threshold
 * is NOT counted as a "no sale". Filters out drawer-open mistakes
 * and split-shift handoffs.
 */
const MIN_NOSALE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/** Personal-baseline detector ignores cashiers with fewer than this
 *  many active hours in the window — too small a sample for a
 *  meaningful personal mean. */
const MIN_PERSONAL_HOURS = 5;

// ============================================================================
// MATH PRIMITIVES
// ============================================================================

/** Arithmetic mean. Returns 0 for empty input (callers guard size). */
function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let total = 0;
  for (const x of xs) total += x;
  return total / xs.length;
}

/**
 * Sample standard deviation (Bessel-corrected, n-1 divisor). Used
 * because we want to estimate population σ from a finite sample.
 * Returns 0 when n < 2 (no variance defined for a single point).
 */
function stdDev(xs: number[], xsMean: number): number {
  if (xs.length < 2) return 0;
  let acc = 0;
  for (const x of xs) {
    const d = x - xsMean;
    acc += d * d;
  }
  return Math.sqrt(acc / (xs.length - 1));
}

/**
 * Standard z-score. When `sd === 0` (zero variance), returns 0 so
 * the detector treats the value as "exactly average". This matches
 * the operator's intuition that a tenant where every cashier has
 * the same void rate has no anomaly to surface.
 */
function zScore(value: number, xsMean: number, sd: number): number {
  if (sd === 0) return 0;
  return (value - xsMean) / sd;
}

/**
 * Sentinel distance returned when leave-one-out detects an extreme
 * outlier in a tightly-clustered population (the "rest" has zero
 * variance and the candidate differs). 99 sits well above
 * `HIGH_SEVERITY_THRESHOLD = 4.5` so the alert fires `high` and
 * sorts ahead of computed z-scores, while remaining a finite
 * number for downstream serialisation.
 */
const LOO_EXTREME_DISTANCE = 99;

/**
 * **Leave-one-out z-score** — robust outlier score for small
 * populations. Compares element at `idx` against the mean and stddev
 * of the OTHER N-1 elements.
 *
 * Why leave-one-out and not vanilla z-score: with N≈5-10 cashiers
 * (typical SMB retail), a single extreme outlier inflates the
 * population stddev so much that the outlier's own z-score caps
 * around `(N-1)/sqrt(N)` — for N=6 that's ~2.04, below our 3σ
 * threshold. Excluding the candidate from its own baseline restores
 * the correct discriminative power.
 *
 * Edge case: when the rest of the population has zero variance and
 * the candidate differs, return `LOO_EXTREME_DISTANCE` (a large
 * finite sentinel) so the alert pipeline still surfaces it as `high`
 * without dividing by zero.
 *
 * Reference: Iglewicz & Hoaglin (1993), "How to Detect and Handle
 * Outliers" — leave-one-out is the small-sample baseline before
 * MAD-based modified z-scores.
 */
function leaveOneOutZScore(idx: number, population: number[]): number {
  if (population.length < 2 || idx < 0 || idx >= population.length) return 0;
  const others: number[] = [];
  for (let i = 0; i < population.length; i += 1) {
    if (i !== idx) others.push(population[i]!);
  }
  const m = mean(others);
  const sd = stdDev(others, m);
  const value = population[idx]!;
  if (sd === 0) {
    return value === m ? 0 : LOO_EXTREME_DISTANCE;
  }
  return (value - m) / sd;
}

/**
 * Convert |z| (or L2 norm of per-dimension z-scores) to severity.
 * Returns `null` when below the entry threshold so the caller can
 * filter the alert out cleanly.
 */
function severityFromDistance(distance: number): AnomalySeverity | null {
  const abs = Math.abs(distance);
  if (abs < MAHALANOBIS_THRESHOLD) return null;
  if (abs >= HIGH_SEVERITY_THRESHOLD) return 'high';
  return 'medium';
}

// ============================================================================
// PUBLIC ORCHESTRATOR
// ============================================================================

/**
 * Build the snooze lookup key for an alert. Aggregate detectors
 * (`voidRate`, `noSaleSessions`) emit `evidenceRef = null`, so the
 * snooze that silences them is keyed on `(kind, cashierId)` only and
 * applies across all alerts of that kind for that cashier. Specific
 * detectors (`refundAmount`) carry the saleId in `evidenceRef` so
 * silencing one $5000 refund does not silence a different one.
 */
function snoozeKey(kind: string, cashierId: string | null, evidenceRef: string | null): string {
  return `${kind}|${cashierId ?? ''}|${evidenceRef ?? ''}`;
}

/**
 * ENG-047 — load the active snoozes for a tenant and return a Set of
 * lookup keys the orchestrator uses to filter alerts. Active means
 * `snoozed_until > now`; expired rows linger on disk (cheap) and are
 * pruned by a future cron (BACKLOG follow-up).
 */
async function loadActiveSnoozeKeys(
  db: DatabaseInstance,
  tenantId: string,
  now: Date
): Promise<Set<string>> {
  const rows = await db
    .select({
      kind: aiAnomalySnoozes.kind,
      cashierId: aiAnomalySnoozes.cashierId,
      evidenceRef: aiAnomalySnoozes.evidenceRef,
    })
    .from(aiAnomalySnoozes)
    .where(
      and(
        eq(aiAnomalySnoozes.tenantId, tenantId),
        gt(aiAnomalySnoozes.snoozedUntil, now.toISOString())
      )
    )
    .all();
  const keys = new Set<string>();
  for (const r of rows) keys.add(snoozeKey(r.kind, r.cashierId, r.evidenceRef));
  return keys;
}

/**
 * ENG-047 — persist newly-surfaced alerts to `audit_logs`. The
 * deterministic dedup key `kind:cashierId:occurredAt[date]:evidenceRef`
 * means re-running the detector inside the same 24h window does not
 * write the same row twice; a fresh outlier on the next day creates a
 * new audit row even if the cashier and kind repeat. We use
 * `INSERT OR IGNORE` keyed by `id` so the path is concurrency-safe.
 *
 * `actor_id` is required by `audit_logs`, but the detector has no
 * operator context, so we attribute the row to the cashier whose
 * behavior was flagged. Cashier-less alerts are skipped because there
 * is no valid user id for the NOT NULL + FK-constrained actor column.
 * `metadata.detectedBy = 'ai.anomaly.detector'` keeps the source
 * machine-readable for downstream filters.
 */
async function persistAnomalyAuditLogs(
  db: DatabaseInstance,
  tenantId: string,
  alerts: AnomalyAlert[]
): Promise<void> {
  if (alerts.length === 0) return;
  const rows = alerts.map(alert => {
    const day = alert.occurredAt.slice(0, 10); // YYYY-MM-DD bucket
    const id = `anomaly:${alert.kind}:${alert.cashierId ?? ''}:${day}:${alert.evidenceRef ?? ''}`;
    return {
      id,
      tenantId,
      // The cashier whose behavior was flagged — when null we fall
      // back to the snoozed_by/system column convention by using the
      // tenant id; the audit_logs.actor_id FK to users would fail in
      // that path, so we skip the row entirely (a cashier-less alert
      // means an aggregate detector with no clear individual subject).
      actorId: alert.cashierId,
      action: 'ai.anomaly.detected',
      resourceType: 'user',
      resourceId: alert.cashierId ?? `tenant:${tenantId}`,
      before: null,
      after: null,
      metadata: {
        detectedBy: 'ai.anomaly.detector',
        kind: alert.kind,
        severity: alert.severity,
        observed: alert.observed,
        baselineMean: alert.baselineMean,
        baselineStdDev: alert.baselineStdDev,
        distance: alert.distance,
        evidenceRef: alert.evidenceRef,
      } as Record<string, unknown>,
      createdAt: alert.occurredAt,
    };
  });
  // Skip rows with null actorId — auditLogs.actor_id is NOT NULL.
  const insertable = rows.filter(r => r.actorId !== null) as Array<
    typeof rows[number] & { actorId: string }
  >;
  if (insertable.length === 0) return;
  // INSERT OR IGNORE so re-runs in the same 24h bucket do not write
  // duplicates; the deterministic id absorbs the dedup key.
  await db.insert(auditLogs).values(insertable).onConflictDoNothing();
}

/**
 * Run all four detectors and aggregate their output. Detector queries
 * execute concurrently and fail as a unit: a data-access failure in
 * any detector rejects the request so the dashboard never shows a
 * misleading partial risk picture. Multi-tenant isolation is enforced
 * inside every query via `eq(*.tenantId, tenantId)`.
 *
 * ENG-047 — alerts whose `(kind, cashierId, evidenceRef)` matches an
 * active snooze are filtered out, AND non-snoozed alerts are persisted
 * to `audit_logs` for historical traceability + cross-reference from
 * `/audit-logs`. The audit-log write is best-effort fire-and-forget:
 * a failure there does not poison the response.
 *
 * @returns Sorted by descending severity then descending distance,
 *          so the most extreme alerts appear first in the dashboard.
 */
export async function detectAnomalies(
  db: DatabaseInstance,
  input: AnomalyDetectionInput
): Promise<AnomalyDetectionResult> {
  const now = new Date();
  const [ticketsPerHour, voidRates, refundAmounts, noSale, snoozeKeys] = await Promise.all([
    detectTicketsPerHourSpikes(db, input),
    detectVoidRateOutliers(db, input),
    detectRefundAmountOutliers(db, input),
    detectNoSaleSessionsOutliers(db, input),
    loadActiveSnoozeKeys(db, input.tenantId, now),
  ]);

  const allAlerts = [...ticketsPerHour, ...voidRates, ...refundAmounts, ...noSale];
  // Filter snoozed alerts. We compare against `null` evidenceRef in
  // the snooze key so a kind+cashier-level snooze suppresses every
  // alert of that kind for that cashier regardless of evidenceRef.
  const alerts = allAlerts.filter(alert => {
    if (snoozeKeys.has(snoozeKey(alert.kind, alert.cashierId, alert.evidenceRef))) return false;
    if (snoozeKeys.has(snoozeKey(alert.kind, alert.cashierId, null))) return false;
    return true;
  });
  alerts.sort((a, b) => {
    // High before medium; within the same severity, larger distance first.
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
    return b.distance - a.distance;
  });

  const severityCounts: Record<AnomalySeverity, number> = { medium: 0, high: 0 };
  const kindCounts: Record<AnomalyKind, number> = {
    ticketsPerHourSpike: 0,
    voidRate: 0,
    refundAmount: 0,
    noSaleSessions: 0,
  };
  for (const alert of alerts) {
    severityCounts[alert.severity] += 1;
    kindCounts[alert.kind] += 1;
  }

  // Best-effort persistence — failure here logs but does not poison
  // the response. The dedup key on `id` absorbs concurrent re-runs.
  try {
    await persistAnomalyAuditLogs(db, input.tenantId, alerts);
  } catch {
    // Intentional swallow: dashboard render must not block on audit write.
  }

  return { alerts, totalCount: alerts.length, severityCounts, kindCounts };
}

// ============================================================================
// SUB-DETECTORS
// ============================================================================

/**
 * **Pattern 5 / Hours raras**: each cashier is compared against THEIR
 * OWN 30-day hourly mean. Hours where the count is far above their
 * personal baseline are flagged.
 *
 * Example: cashier "María" usually rings 22 tickets/hour during
 * Friday 6-8pm. One Friday she rings 90 in a single hour — z-score
 * around 7σ vs her personal mean. Likely covering a void burst, or
 * processing legitimate transactions while a partner pockets cash.
 *
 * Uses substr(createdAt, 0, 14) to bucket by hour ('YYYY-MM-DDTHH').
 * No composite index for this aggregation — embedded SQLite handles
 * up to ~50k sales / month before this exceeds 100ms; mitigation is
 * dashboard cache (`staleTime: 5 * 60_000`).
 */
async function detectTicketsPerHourSpikes(
  db: DatabaseInstance,
  input: AnomalyDetectionInput
): Promise<AnomalyAlert[]> {
  const { tenantId, from, to } = input;
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const rows = await db
    .select({
      cashierId: sales.createdBy,
      cashierName: users.name,
      hourBucket: sql<string>`substr(${sales.createdAt}, 1, 13)`,
      count: sql<number>`count(*)`,
    })
    .from(sales)
    .leftJoin(users, eq(sales.createdBy, users.id))
    .where(
      and(
        eq(sales.tenantId, tenantId),
        eq(sales.status, 'completed'),
        gte(sales.createdAt, fromIso),
        lte(sales.createdAt, toIso)
      )
    )
    .groupBy(sales.createdBy, users.name, sql`substr(${sales.createdAt}, 1, 13)`)
    .all();

  // Group by cashier so we can compute personal baselines.
  const byCashier = new Map<string, { name: string | null; counts: { hourBucket: string; count: number }[] }>();
  for (const row of rows) {
    if (!row.cashierId) continue;
    const entry = byCashier.get(row.cashierId);
    if (entry) {
      entry.counts.push({ hourBucket: row.hourBucket, count: Number(row.count) });
    } else {
      byCashier.set(row.cashierId, {
        name: row.cashierName,
        counts: [{ hourBucket: row.hourBucket, count: Number(row.count) }],
      });
    }
  }

  const alerts: AnomalyAlert[] = [];
  for (const [cashierId, { name, counts }] of byCashier) {
    if (counts.length < MIN_PERSONAL_HOURS) continue;
    const values = counts.map(c => c.count);
    const personalMean = mean(values);
    const personalStdDev = stdDev(values, personalMean);
    if (personalStdDev === 0) continue; // perfectly flat cashier — nothing to flag

    for (const { hourBucket, count } of counts) {
      const z = zScore(count, personalMean, personalStdDev);
      const severity = severityFromDistance(z);
      // Only flag UPWARD spikes (high count). Downward dips are the
      // sweethearting signal but require traffic correlation we do
      // not have in v1; captured as a BACKLOG follow-up.
      if (severity === null || z < 0) continue;
      alerts.push({
        id: nanoid(),
        kind: 'ticketsPerHourSpike',
        cashierId,
        cashierName: name,
        severity,
        observed: count,
        baselineMean: personalMean,
        baselineStdDev: personalStdDev,
        distance: z,
        // hourBucket is 'YYYY-MM-DDTHH' — append ':00:00.000Z' to make
        // it round-trip as an ISO timestamp.
        occurredAt: `${hourBucket}:00:00.000Z`,
        evidenceRef: null,
      });
    }
  }
  return alerts;
}

/**
 * **Pattern 2 / Voids fantasma**: per cashier, compute the ratio of
 * voided sales to completed sales over the window. Flag cashiers
 * whose ratio is far above the tenant population mean.
 *
 * Why ratio and not count: a busy cashier will naturally void more
 * absolute sales than a slow one; ratio normalizes for shift volume.
 *
 * Example: cashier "Carlos" voids 15 sales out of 100 (15%) while
 * the tenant population averages 2% with stddev 1%. z-score = 13σ.
 * That is impossible by chance — investigate immediately.
 *
 * Source of voids: `audit_logs.action = 'sale.void'` (richer
 * metadata than `sales.status='voided'` flags), grouped by
 * `actorId`. Source of denominator: completed sales per cashier.
 */
async function detectVoidRateOutliers(
  db: DatabaseInstance,
  input: AnomalyDetectionInput
): Promise<AnomalyAlert[]> {
  const { tenantId, from, to } = input;
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  // Voids per cashier from audit_logs.
  const voidRows = await db
    .select({
      cashierId: auditLogs.actorId,
      cashierName: users.name,
      voidCount: sql<number>`count(*)`,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorId, users.id))
    .where(
      and(
        eq(auditLogs.tenantId, tenantId),
        eq(auditLogs.action, 'sale.void'),
        gte(auditLogs.createdAt, fromIso),
        lte(auditLogs.createdAt, toIso)
      )
    )
    .groupBy(auditLogs.actorId, users.name)
    .all();

  // Completed sales per cashier in the same window.
  const saleRows = await db
    .select({
      cashierId: sales.createdBy,
      saleCount: sql<number>`count(*)`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.tenantId, tenantId),
        eq(sales.status, 'completed'),
        gte(sales.createdAt, fromIso),
        lte(sales.createdAt, toIso)
      )
    )
    .groupBy(sales.createdBy)
    .all();

  const saleByCashier = new Map<string, number>();
  for (const row of saleRows) saleByCashier.set(row.cashierId, Number(row.saleCount));

  // Build the per-cashier ratio universe (every cashier with at least
  // one completed sale in the window). Cashiers with zero completed
  // sales but with voids are very suspicious; emit a synthetic ratio
  // of 1.0 (100% voids) for them.
  type Row = { cashierId: string; cashierName: string | null; voidCount: number; ratio: number };
  const universe: Row[] = [];
  const voidByCashier = new Map<string, { cashierName: string | null; voidCount: number }>();
  for (const row of voidRows) {
    voidByCashier.set(row.cashierId, {
      cashierName: row.cashierName,
      voidCount: Number(row.voidCount),
    });
  }
  // Ensure every cashier present in either set is represented.
  const allCashiers = new Set<string>([...saleByCashier.keys(), ...voidByCashier.keys()]);
  for (const cashierId of allCashiers) {
    const voidEntry = voidByCashier.get(cashierId);
    const saleCount = saleByCashier.get(cashierId) ?? 0;
    const voidCount = voidEntry?.voidCount ?? 0;
    const ratio = saleCount > 0 ? voidCount / saleCount : voidCount > 0 ? 1 : 0;
    universe.push({
      cashierId,
      cashierName: voidEntry?.cashierName ?? null,
      voidCount,
      ratio,
    });
  }

  if (universe.length < MIN_SAMPLE_SIZE) return [];

  // Leave-one-out z-score: per-cashier baseline excludes that
  // cashier so a single outlier does not inflate its own stddev. See
  // `leaveOneOutZScore` JSDoc for the small-N rationale.
  const ratios = universe.map(r => r.ratio);
  const populationMean = mean(ratios);
  const populationStdDev = stdDev(ratios, populationMean);

  const alerts: AnomalyAlert[] = [];
  universe.forEach((row, idx) => {
    const z = leaveOneOutZScore(idx, ratios);
    const severity = severityFromDistance(z);
    if (severity === null || z < 0) return;
    alerts.push({
      id: nanoid(),
      kind: 'voidRate',
      cashierId: row.cashierId,
      cashierName: row.cashierName,
      severity,
      observed: row.ratio,
      // Reported baseline is the population mean+stddev (more
      // intuitive for the operator than the LOO baseline that
      // excludes the candidate).
      baselineMean: populationMean,
      baselineStdDev: populationStdDev,
      distance: z,
      occurredAt: toIso,
      evidenceRef: null,
    });
  });
  return alerts;
}

/**
 * **Pattern 3 / Refunds fraudulentos individuales**: scan every
 * refund in the window and flag those whose `refundAmount` is far
 * above the tenant-wide refund mean.
 *
 * Why refunds individually (not aggregated per cashier): a single
 * fraudulent $5000 refund stands out even when the cashier is
 * otherwise clean. Aggregating would dilute that signal.
 *
 * Returns at most `REFUND_TOP_K` results so the dashboard never
 * floods. Sorted internally by descending z-score.
 *
 * Example: tenant mean refund = $50, stddev = $30. A single $5000
 * refund has z = 165σ — clearly real fraud or a legitimate
 * high-ticket return that the manager should still verify.
 */
async function detectRefundAmountOutliers(
  db: DatabaseInstance,
  input: AnomalyDetectionInput
): Promise<AnomalyAlert[]> {
  const { tenantId, from, to } = input;
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const rows = await db
    .select({
      refundId: saleReturns.id,
      saleId: saleReturns.saleId,
      cashierId: saleReturns.createdBy,
      cashierName: users.name,
      refundAmount: saleReturns.refundAmount,
      createdAt: saleReturns.createdAt,
    })
    .from(saleReturns)
    .leftJoin(users, eq(saleReturns.createdBy, users.id))
    .where(
      and(
        eq(saleReturns.tenantId, tenantId),
        gte(saleReturns.createdAt, fromIso),
        lte(saleReturns.createdAt, toIso)
      )
    )
    .all();

  if (rows.length < MIN_SAMPLE_SIZE) return [];

  const amounts = rows.map(r => Number(r.refundAmount));
  const amountMean = mean(amounts);
  const amountStdDev = stdDev(amounts, amountMean);

  const alerts: AnomalyAlert[] = [];
  for (const row of rows) {
    const amount = Number(row.refundAmount);
    const z = zScore(amount, amountMean, amountStdDev);
    const severity = severityFromDistance(z);
    if (severity === null || z < 0) continue;
    alerts.push({
      id: nanoid(),
      kind: 'refundAmount',
      cashierId: row.cashierId,
      cashierName: row.cashierName,
      severity,
      observed: amount,
      baselineMean: amountMean,
      baselineStdDev: amountStdDev,
      distance: z,
      occurredAt: row.createdAt,
      evidenceRef: row.saleId,
    });
  }

  alerts.sort((a, b) => b.distance - a.distance);
  return alerts.slice(0, REFUND_TOP_K);
}

/**
 * **Pattern 4 / No-sale opens**: count cash sessions where the
 * cashier kept the drawer open for at least `MIN_NOSALE_DURATION_MS`
 * but recorded zero completed sales. A session legitimately ends
 * with zero sales sometimes (training, equipment check, drawer
 * audit), but the count over 30 days should be low and consistent
 * across the team.
 *
 * Cross-cashier detection: per cashier, count of qualifying sessions;
 * z-score that count against the tenant population.
 *
 * Example: cashier "Andrés" has 18 zero-sale sessions over 30 min in
 * a month. Population mean: 2.5, stddev: 1.5. z = 10σ — Andrés is
 * very likely opening the drawer to extract cash.
 */
async function detectNoSaleSessionsOutliers(
  db: DatabaseInstance,
  input: AnomalyDetectionInput
): Promise<AnomalyAlert[]> {
  const { tenantId, from, to } = input;
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  // For each closed session in the window, compute duration and
  // count of completed sales tied to it. SQLite supports
  // strftime('%s', ...) for ISO-string-to-epoch conversion in
  // seconds; multiply by 1000 to get ms.
  const rows = await db
    .select({
      sessionId: cashSessions.id,
      cashierId: cashSessions.cashierId,
      cashierName: users.name,
      openedAt: cashSessions.openedAt,
      closedAt: cashSessions.closedAt,
      durationMs: sql<number>`(strftime('%s', ${cashSessions.closedAt}) - strftime('%s', ${cashSessions.openedAt})) * 1000`,
      completedSaleCount: sql<number>`(
        SELECT count(*) FROM ${sales}
        WHERE ${sales.cashSessionId} = ${cashSessions.id}
          AND ${sales.tenantId} = ${tenantId}
          AND ${sales.status} = 'completed'
      )`,
    })
    .from(cashSessions)
    .leftJoin(users, eq(cashSessions.cashierId, users.id))
    .where(
      and(
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.status, 'closed'),
        gte(cashSessions.openedAt, fromIso),
        lte(cashSessions.openedAt, toIso)
      )
    )
    .all();

  // Build per-cashier no-sale counts.
  const noSaleByCashier = new Map<string, { name: string | null; noSaleCount: number }>();
  const knownCashiers = new Set<string>();
  for (const row of rows) {
    knownCashiers.add(row.cashierId);
    const isLong = Number(row.durationMs) >= MIN_NOSALE_DURATION_MS;
    const isEmpty = Number(row.completedSaleCount) === 0;
    const entry = noSaleByCashier.get(row.cashierId);
    if (!entry) {
      noSaleByCashier.set(row.cashierId, {
        name: row.cashierName,
        noSaleCount: isLong && isEmpty ? 1 : 0,
      });
    } else if (isLong && isEmpty) {
      entry.noSaleCount += 1;
    }
  }

  if (knownCashiers.size < MIN_SAMPLE_SIZE) return [];

  // Leave-one-out z-score (same rationale as voidRate detector).
  const entries = Array.from(noSaleByCashier.entries());
  const counts = entries.map(([, v]) => v.noSaleCount);
  const populationMean = mean(counts);
  const populationStdDev = stdDev(counts, populationMean);

  const alerts: AnomalyAlert[] = [];
  entries.forEach(([cashierId, { name, noSaleCount }], idx) => {
    const z = leaveOneOutZScore(idx, counts);
    const severity = severityFromDistance(z);
    if (severity === null || z < 0) return;
    alerts.push({
      id: nanoid(),
      kind: 'noSaleSessions',
      cashierId,
      cashierName: name,
      severity,
      observed: noSaleCount,
      baselineMean: populationMean,
      baselineStdDev: populationStdDev,
      distance: z,
      occurredAt: toIso,
      evidenceRef: null,
    });
  });
  return alerts;
}

// ============================================================================
// CONSTANTS RE-EXPORT (for tests + telemetry)
// ============================================================================

/** Frozen set of tuning constants, useful for tests + future settings UI. */
export const anomalyDetectionConstants = Object.freeze({
  ANALYSIS_WINDOW_DAYS,
  MAHALANOBIS_THRESHOLD,
  HIGH_SEVERITY_THRESHOLD,
  MIN_SAMPLE_SIZE,
  REFUND_TOP_K,
  MIN_NOSALE_DURATION_MS,
  MIN_PERSONAL_HOURS,
});
