/**
 * math primitives for the anomaly detector.
 *
 * extracted verbatim from the former flat
 * `services/ai/anomalyDetection.ts` (the MATH PRIMITIVES section)
 * during the megafile decomposition. Pure functions, no DB access.
 *
 * @module services/ai/anomalyDetection/stats
 */
import { HIGH_SEVERITY_THRESHOLD, MAHALANOBIS_THRESHOLD, type AnomalySeverity } from './types.js';

/** Arithmetic mean. Returns 0 for empty input (callers guard size). */
export function mean(xs: number[]): number {
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
export function stdDev(xs: number[], xsMean: number): number {
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
export function zScore(value: number, xsMean: number, sd: number): number {
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
export function leaveOneOutZScore(idx: number, population: number[]): number {
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
export function severityFromDistance(distance: number): AnomalySeverity | null {
  const abs = Math.abs(distance);
  if (abs < MAHALANOBIS_THRESHOLD) return null;
  if (abs >= HIGH_SEVERITY_THRESHOLD) return 'high';
  return 'medium';
}
