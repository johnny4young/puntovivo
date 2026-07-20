/**
 * public types + tuning constants for the anomaly detector.
 *
 * extracted verbatim from the former flat
 * `services/ai/anomalyDetection.ts` during the megafile decomposition.
 * Pure declarations only (no imports), so every other module in the
 * package can depend on this leaf without risking a cycle.
 *
 * @module services/ai/anomalyDetection/types
 */

// ============================================================================
// PUBLIC TYPES
// ============================================================================

/**
 * Catalog of anomaly classes emitted by the detector.
 */
export type AnomalyKind = 'ticketsPerHourSpike' | 'voidRate' | 'refundAmount' | 'noSaleSessions';

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
 * lifetime of a single `ai.anomalies.list`
 * response — clients use it as a React key
 * and as a target for follow-up actions.
 * @property kind         Which sub-detector fired.
 * @property cashierId    User who owns the anomalous behavior. Null
 * only for tenant-wide refund-amount outliers
 * when the underlying sale's `createdBy` is
 * unresolvable (defensive null-guard).
 * @property cashierName  Display name; falls back to the user id when
 * the user row was deleted (tombstoned).
 * @property severity     `medium` (3 ≤ distance < 4.5) or `high`
 * (distance ≥ 4.5). Below 3.0 the alert is
 * filtered out.
 * @property observed     Raw metric value the cashier hit (e.g. void
 * ratio = 0.42, refund amount = 5000.00).
 * @property baselineMean Reference mean against which `observed` was
 * compared. Either personal (per-cashier) or
 * cross-cashier (tenant population).
 * @property baselineStdDev Reference standard deviation.
 * @property distance     L2 norm of per-dimension z-scores (single
 * dimension for v1 detectors → equivalent to
 * the absolute z-score).
 * @property occurredAt   ISO timestamp identifying the bucket the
 * anomaly was observed in. For aggregate
 * ratios (voidRate / noSaleSessions), this is
 * the upper bound of the analysis window.
 * @property evidenceRef  Optional pointer the operator can use to
 * cross-reference. Today populated for
 * refundAmount alerts (the saleId).
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
 * detector emits no alert. Tuned per tenant in a future change.
 */
export const MAHALANOBIS_THRESHOLD = 3.0;

/**
 * Above this, severity is `high`. 4.5σ ≈ 7e-6 false-positive rate —
 * effectively impossible by chance, so worth pushing to the operator
 * with the louder badge.
 */
export const HIGH_SEVERITY_THRESHOLD = 4.5;

/**
 * Cross-cashier detectors require at least this many cashiers in the
 * tenant population to compute a meaningful mean and stddev. Below
 * this, those detectors no-op (personal-baseline detectors still run).
 */
export const MIN_SAMPLE_SIZE = 5;

/** Cap returned refund-amount outliers to avoid flooding the UI. */
export const REFUND_TOP_K = 10;

/**
 * A cash session opened for less than this duration is too short to
 * reasonably contain a sale, so an empty session below this threshold
 * is NOT counted as a "no sale". Filters out drawer-open mistakes
 * and split-shift handoffs.
 */
export const MIN_NOSALE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/** Personal-baseline detector ignores cashiers with fewer than this
 * many active hours in the window — too small a sample for a
 * meaningful personal mean. */
export const MIN_PERSONAL_HOURS = 5;

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
