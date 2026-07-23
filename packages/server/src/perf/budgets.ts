/**
 * Loader + helper utilities for the repo-wide
 * `perf-budget.json`.
 *
 * The same JSON file is consumed by two surfaces:
 *
 * - `scripts/check-bundle-size.mjs` (Node-only, post-build gate
 * for the web bundle).
 * - `__tests__/perf-trpc-latency.test.ts` (vitest, p95 gate for a
 * curated set of fixture-sized tRPC procedures).
 * - `__tests__/perf-store-profile.test.ts` (vitest, deterministic
 * store-volume, hot-read p95, and SQLite query-plan gate).
 *
 * This module is the server-side accessor. It loads the file via
 * `node:fs` at import time so the budget is fixed for the duration
 * of a vitest run; the bundle-size script reuses the same JSON path
 * but parses it inline (no shared TS layer because the script is
 * pure `.mjs`).
 *
 * The helpers (`computePercentile`) live next to the loader so any
 * future percentile-based gate can reuse the same math.
 *
 * @module perf/budgets
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// `packages/server/src/perf` → repo root is 4 levels up.
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const BUDGET_PATH = resolve(REPO_ROOT, 'perf-budget.json');

export interface PerfBudgetTrpcLatencyMs {
  /** Map of `<routerSegment>.<procedureName>` → p95 ceiling in ms. */
  p95: Record<string, number>;
  /** Iterations to run before the recorded samples (JIT warmup). */
  warmupIterations: number;
  /** Recorded samples per procedure after warmup. */
  samplesPerProcedure: number;
  /** Allowed delta over the budget in percent. */
  thresholdPercent: number;
}

export interface PerfBudgetBundleSize {
  perChunkGzKb: Record<string, number>;
  thresholdPercent: number;
}

export interface PerfBudgetStoreProfile {
  /** Deterministic developer seed preset used by the store-scale gate. */
  preset: 'mega';
  /** Iterations discarded before each recorded procedure sample. */
  warmupIterations: number;
  /** Recorded samples per operational read. */
  samplesPerProcedure: number;
  /** Shared tolerance over elapsed and p95 budgets. */
  thresholdPercent: number;
  /** Full mega seed elapsed-time baseline in milliseconds. */
  seedElapsedMs: number;
  /** Minimum persisted rows required before measurements are trusted. */
  minimumRows: Record<string, number>;
  /** Store-sized tRPC read key to p95 baseline in milliseconds. */
  p95: Record<string, number>;
  /** Query key to the SQLite index required by EXPLAIN QUERY PLAN. */
  queryPlanIndexes: Record<string, string>;
}

export interface PerfBudget {
  version: number;
  bundleSize: PerfBudgetBundleSize;
  trpcLatencyMs: PerfBudgetTrpcLatencyMs;
  storeProfile: PerfBudgetStoreProfile;
}

/**
 * Load the repo-wide `perf-budget.json`. The result is cached per
 * import so consecutive callers in the same test run see the same
 * budget. Throws when the file is missing or malformed — fail loud.
 */
let cached: PerfBudget | null = null;
export function loadPerfBudget(): PerfBudget {
  if (cached) return cached;
  const raw = readFileSync(BUDGET_PATH, 'utf8');
  const parsed = JSON.parse(raw) as Partial<PerfBudget> & {
    bundleSize?: Partial<PerfBudgetBundleSize>;
    trpcLatencyMs?: Partial<PerfBudgetTrpcLatencyMs>;
    storeProfile?: Partial<PerfBudgetStoreProfile>;
  };
  if (
    typeof parsed.version !== 'number' ||
    !parsed.bundleSize ||
    !parsed.trpcLatencyMs ||
    typeof parsed.trpcLatencyMs.thresholdPercent !== 'number' ||
    typeof parsed.trpcLatencyMs.samplesPerProcedure !== 'number' ||
    typeof parsed.trpcLatencyMs.warmupIterations !== 'number' ||
    !parsed.trpcLatencyMs.p95 ||
    !parsed.storeProfile ||
    parsed.storeProfile.preset !== 'mega' ||
    !Number.isInteger(parsed.storeProfile.warmupIterations) ||
    parsed.storeProfile.warmupIterations < 0 ||
    !Number.isInteger(parsed.storeProfile.samplesPerProcedure) ||
    parsed.storeProfile.samplesPerProcedure < 1 ||
    typeof parsed.storeProfile.thresholdPercent !== 'number' ||
    !Number.isFinite(parsed.storeProfile.thresholdPercent) ||
    parsed.storeProfile.thresholdPercent < 0 ||
    typeof parsed.storeProfile.seedElapsedMs !== 'number' ||
    !Number.isFinite(parsed.storeProfile.seedElapsedMs) ||
    parsed.storeProfile.seedElapsedMs < 1 ||
    !parsed.storeProfile.minimumRows ||
    Object.keys(parsed.storeProfile.minimumRows).length === 0 ||
    Object.values(parsed.storeProfile.minimumRows).some(
      value => !Number.isInteger(value) || value < 1
    ) ||
    !parsed.storeProfile.p95 ||
    Object.keys(parsed.storeProfile.p95).length === 0 ||
    Object.values(parsed.storeProfile.p95).some(
      value => typeof value !== 'number' || !Number.isFinite(value) || value <= 0
    ) ||
    !parsed.storeProfile.queryPlanIndexes ||
    Object.keys(parsed.storeProfile.queryPlanIndexes).length === 0 ||
    Object.values(parsed.storeProfile.queryPlanIndexes).some(
      value => typeof value !== 'string' || value.length === 0
    ) ||
    !parsed.bundleSize.perChunkGzKb ||
    typeof parsed.bundleSize.thresholdPercent !== 'number'
  ) {
    throw new Error(`perf-budget.json at ${BUDGET_PATH} is missing required fields`);
  }
  cached = parsed as PerfBudget;
  return cached;
}

/**
 * Compute the `p`th percentile of `samples` (linear interpolation,
 * `p` in [0, 100]). Defensive against empty input — returns 0 so a
 * caller comparing against a budget can short-circuit rather than
 * crash.
 *
 * Examples:
 * computePercentile([1..100], 95) === 95
 * computePercentile([10, 20, 30], 50) === 20
 * computePercentile([], 95) === 0
 *
 * Exported here so the latency suite and any future percentile
 * caller share the same implementation.
 */
export function computePercentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  if (p < 0 || p > 100) {
    throw new Error(`computePercentile: p must be in [0, 100], got ${p}`);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const fraction = rank - lo;
  return sorted[lo]! * (1 - fraction) + sorted[hi]! * fraction;
}
