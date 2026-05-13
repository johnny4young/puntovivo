/**
 * ENG-040d — Scoring helpers for the 10-invoice OCR accuracy benchmark.
 *
 * Pure functions; no I/O, no AI dependency. The benchmark CLI in
 * `scripts/benchmark-invoice-ocr.ts` consumes these to score each
 * fixture against a ground-truth JSON, and a mocked unit test in
 * `__tests__/benchmark-invoice-ocr.test.ts` pins the math so the
 * threshold logic stays stable across refactors.
 *
 * @module services/ai/vision/benchmark-scoring
 */

import type { InvoiceOcr, InvoiceOcrLine } from './invoice-ocr.js';

/** Default pass threshold for the aggregate accuracy. */
export const BENCHMARK_DEFAULT_THRESHOLD = 0.8;

/** Description similarity threshold for the bigram Sorensen-Dice match. */
export const DESCRIPTION_SIMILARITY_THRESHOLD = 0.7;

/** Unit-price tolerance as a fraction of the truth value (1%). */
export const UNIT_PRICE_TOLERANCE = 0.01;

/**
 * Shape of the committed ground-truth JSON next to each fixture image.
 * Mirrors the structured invoice schema but with hand-labelled values.
 */
export interface FixtureGroundTruth {
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  currencyCode: string | null;
  lines: Array<{
    description: string;
    quantity: number | null;
    unitPrice: number | null;
    totalLine: number | null;
  }>;
}

/** Per-fixture score row carried into the report and the aggregate. */
export interface FixtureScore {
  fixtureId: string;
  truthLines: number;
  matchedLines: number;
  accuracy: number;
  costUsd: number;
  durationMs: number;
}

/** Aggregate row appended at the bottom of the benchmark report. */
export interface BenchmarkAggregate {
  matched: number;
  total: number;
  accuracy: number;
  costUsd: number;
  durationMs: number;
  threshold: number;
  passed: boolean;
}

export interface BenchmarkResult {
  fixtures: FixtureScore[];
  aggregate: BenchmarkAggregate;
}

/**
 * Normalize a description for similarity comparison: lowercase, strip
 * accents, drop non-alphanumeric chars (hyphens, spaces, decimal
 * separators all collapse to nothing). The OCR pipeline frequently
 * differs from ground truth only by punctuation and whitespace
 * ("Coca-Cola 1.5L" vs "Coca Cola 1.5 L"), so the normalized form
 * absorbs that drift.
 */
export function normalizeDescription(input: string): string {
  // `\p{M}` matches every Unicode combining-mark category (Mn/Me/Mc).
  // After NFD this strips accents without depending on the source file
  // being encoded in a particular byte-exact way (an embedded literal
  // range like /[̀-ͯ]/ also works but is brittler against
  // editors that re-encode combining-mark literals).
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Character-bigram Sørensen-Dice similarity ∈ [0, 1]. Returns 1 when
 * both inputs normalize to the same string; returns 0 when there is
 * no overlap. Dice handles substring extensions ("Café americano" vs
 * "Café americano grande") better than Jaccard at the same threshold,
 * because the denominator weights both sets symmetrically.
 */
export function descriptionSimilarity(a: string, b: string): number {
  const na = normalizeDescription(a);
  const nb = normalizeDescription(b);
  if (na.length === 0 && nb.length === 0) return 1;
  if (na === nb) return 1;
  const bigramsA = toBigramSet(na);
  const bigramsB = toBigramSet(nb);
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let intersection = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) intersection++;
  }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

function toBigramSet(text: string): Set<string> {
  const set = new Set<string>();
  if (text.length < 2) {
    if (text.length === 1) set.add(text);
    return set;
  }
  for (let i = 0; i < text.length - 1; i++) {
    set.add(text.slice(i, i + 2));
  }
  return set;
}

/**
 * Decide whether an extracted line matches a ground-truth line.
 *
 * Match requires all of:
 * - description similarity >= DESCRIPTION_SIMILARITY_THRESHOLD
 * - quantity equal or both null
 * - unitPrice equal within ±UNIT_PRICE_TOLERANCE of truth, or both null
 *
 * `totalLine` is not part of the match criterion because the OCR
 * pipeline can derive it from `quantity * unitPrice` even when the
 * receipt printed the total in a separate column; comparing it would
 * double-count noise.
 */
export function isLineMatch(
  truth: FixtureGroundTruth['lines'][number],
  extracted: InvoiceOcrLine,
): boolean {
  if (descriptionSimilarity(truth.description, extracted.description) < DESCRIPTION_SIMILARITY_THRESHOLD) {
    return false;
  }
  if (!matchesNullableNumber(truth.quantity, extracted.quantity)) return false;
  if (!matchesNullableUnitPrice(truth.unitPrice, extracted.unitPrice)) return false;
  return true;
}

/**
 * Quantity comparison is exact. The 1-unit tolerance from earlier
 * drafts allowed `2` and `3` to match, which defeats the purpose —
 * if the OCR misreads "2" as "3" we want the score to reflect that.
 * Both-null is treated as a match (the truth row had no quantity
 * column).
 */
function matchesNullableNumber(truth: number | null, extracted: number | null): boolean {
  if (truth === null && extracted === null) return true;
  if (truth === null || extracted === null) return false;
  return truth === extracted;
}

function matchesNullableUnitPrice(truth: number | null, extracted: number | null): boolean {
  if (truth === null && extracted === null) return true;
  if (truth === null || extracted === null) return false;
  if (truth === 0) return Math.abs(extracted) <= UNIT_PRICE_TOLERANCE;
  return Math.abs(truth - extracted) / Math.abs(truth) <= UNIT_PRICE_TOLERANCE;
}

/**
 * Score a single fixture: count how many ground-truth lines have a
 * matching extracted line. Greedy assignment — each extracted line
 * can match at most one truth line, processed left-to-right.
 *
 * Convention: when the truth has zero lines, the fixture contributes
 * 0/0 (skipped from the ratio). The benchmark aggregate handles the
 * empty-denominator case explicitly to avoid NaN.
 */
export function scoreFixture(
  truth: FixtureGroundTruth,
  extracted: InvoiceOcr,
): { matchedLines: number; truthLines: number } {
  const truthLines = truth.lines.length;
  if (truthLines === 0) {
    return { matchedLines: 0, truthLines: 0 };
  }

  const usedExtractedIndices = new Set<number>();
  let matchedLines = 0;

  for (const truthLine of truth.lines) {
    let bestIdx = -1;
    let bestSimilarity = 0;
    for (let i = 0; i < extracted.lines.length; i++) {
      if (usedExtractedIndices.has(i)) continue;
      const candidate = extracted.lines[i];
      if (!candidate) continue;
      if (!isLineMatch(truthLine, candidate)) continue;
      const similarity = descriptionSimilarity(truthLine.description, candidate.description);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      usedExtractedIndices.add(bestIdx);
      matchedLines++;
    }
  }

  return { matchedLines, truthLines };
}

/**
 * Aggregate per-fixture scores into the report row.
 *
 * Aggregate accuracy is `sum(matched) / sum(truth)` across all
 * fixtures. Fixtures with `truthLines === 0` contribute zero to both
 * numerator and denominator and therefore do not affect the ratio.
 */
export function aggregateBenchmark(
  scores: FixtureScore[],
  threshold: number = BENCHMARK_DEFAULT_THRESHOLD,
): BenchmarkAggregate {
  let matched = 0;
  let total = 0;
  let costUsd = 0;
  let durationMs = 0;
  for (const score of scores) {
    matched += score.matchedLines;
    total += score.truthLines;
    costUsd += score.costUsd;
    durationMs += score.durationMs;
  }
  const accuracy = total === 0 ? 1 : matched / total;
  return {
    matched,
    total,
    accuracy,
    costUsd,
    durationMs,
    threshold,
    passed: accuracy >= threshold,
  };
}
