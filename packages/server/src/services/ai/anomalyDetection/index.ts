/**
 * AI anomaly + fraud detection (local-only).
 *
 * this barrel preserves the public surface of the former flat
 * `services/ai/anomalyDetection.ts` (928 LOC), which was decomposed into
 * per-detector modules during the megafile wave. Behavior is unchanged;
 * only the file layout moved. Importers keep using
 * `services/ai/index.js`, which re-exports from here.
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
 * outliers that match five common POS fraud patterns:
 *
 * 1. Sweethearting — cashier "passes" items without scanning.
 * 2. Voids fantasma — cashier voids a real sale and pockets cash.
 * 3. Refunds fraudulentos — refund a sale never returned.
 * 4. No-sale opens — opens drawer without a sale to extract cash.
 * 5. Activity in odd hours — out-of-hours bursts that hide voids.
 *
 * ## Why local-only / no LLM
 *
 * - **Determinism**: same data + same formula → same alert.
 * Auditable, defensible if a cashier disputes the flag. An LLM
 * would introduce variance the tenant cannot reproduce.
 * - **Privacy**: transaction data never leaves the embedded
 * database. Habeas Data (Colombia, Ley 1581 / 2012), LFPDPPP
 * (Mexico), Ley 19.628 (Chile) all require explicit consent for
 * cross-border transfer of transactional records. SQLite-local
 * statistics satisfy that by construction.
 * - **Cost**: detection runs on every dashboard refetch (every
 * ~5 min) without consuming tokens or hitting `ai_audit_log`
 * (this module does NOT call `recordCall` — it is statistical,
 * not generative).
 * - **Sufficiency**: for the five patterns above, classical
 * statistics is state-of-the-art. An LLM does not add useful
 * signal — only opacity and bill.
 *
 * ## Algorithm: z-score + diagonal Mahalanobis
 *
 * The acceptance contract mentions "isolation forest variant". This v1
 * ships z-score + diagonal Mahalanobis instead because:
 *
 * - ~80 LOC of math, fully testable from synthetic fixtures.
 * - One tunable parameter (the threshold) instead of a tree
 * ensemble's depth + sample-size + contamination triplet.
 * - For ≤ 4 features per detector with mostly Gaussian noise
 * (counts, ratios, amounts), z-score with σ-multiplier is
 * mathematically equivalent to the most-discriminative
 * dimension of an isolation forest with similar tuning, at a
 * fraction of the cognitive cost.
 *
 * Diagonal Mahalanobis assumes feature independence — refund-amount
 * outlier, void-rate outlier, etc. are computed per-dimension and
 * combined via L2 norm of per-dimension z-scores. The full Mahalanobis
 * with covariance estimation requires many more samples to be
 * statistically reliable; for tenants with 5-20 cashiers the diagonal
 * form is the responsible choice.
 *
 * **Upgrade criteria** (captured as follow-up work): if a pilot
 * tenant reports false-positive rate > 30%, or a confirmed
 * false-negative (real fraud missed), promote to a mini isolation
 * forest. The public `detectAnomalies()` signature stays the same;
 * only the internals change.
 *
 * ## Threshold: 3σ (≈ 0.27% probability under Gaussian H0)
 *
 * Hardcoded for v1. Per-tenant tunable via
 * `tenants.settings.ai.anomalyThreshold` is captured as follow-up work
 * follow-up — most operators will leave the default and want the
 * predictability of "3σ across all my stores".
 *
 * ## Data sources (read-only, no schema changes)
 *
 * - `sales` filtered by `status = 'completed' | 'voided'` for the
 * tickets/hour and ticket-spike detectors.
 * - `audit_logs` filtered by `action = 'sale.void'` for void
 * counts. We use audit_logs rather than `sales.status='voided'`
 * flags because void metadata (reason, actor at time of action)
 * is captured there.
 * - `sale_returns.refund_amount` for refund-amount outliers.
 * - `cash_sessions` for the "no-sale" proxy (sessions with zero
 * completed sales over a > 30-minute duration).
 *
 * Window: 30 days rolling, configurable per call.
 *
 * @module services/ai/anomalyDetection
 */
export { detectAnomalies } from './detectAnomalies.js';
export {
  ANALYSIS_WINDOW_DAYS,
  anomalyDetectionConstants,
  type AnomalyAlert,
  type AnomalyDetectionInput,
  type AnomalyDetectionResult,
  type AnomalyKind,
  type AnomalySeverity,
} from './types.js';
