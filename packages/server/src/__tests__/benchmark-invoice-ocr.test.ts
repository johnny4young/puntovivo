/**
 * Unit tests for the OCR benchmark scoring helper.
 *
 * Pure-math tests over `scoreFixture` + `aggregateBenchmark` so the
 * threshold gate stays stable independent of the live benchmark in
 * `scripts/benchmark-invoice-ocr.ts`. No AI provider, no SQLite —
 * just the scoring contract.
 */
import { describe, expect, it } from 'vitest';

import {
  aggregateBenchmark,
  descriptionSimilarity,
  isLineMatch,
  normalizeDescription,
  scoreFixture,
  type FixtureGroundTruth,
  type FixtureScore,
} from '../services/ai/vision/benchmark-scoring.js';
import type { InvoiceOcr } from '../services/ai/vision/invoice-ocr.js';

function makeOcr(lines: InvoiceOcr['lines']): InvoiceOcr {
  return {
    supplierName: null,
    supplierTaxId: null,
    invoiceNumber: null,
    invoiceDate: null,
    currencyCode: null,
    lines,
    subtotal: null,
    taxAmount: null,
    total: null,
  };
}

function makeTruth(lines: FixtureGroundTruth['lines']): FixtureGroundTruth {
  return {
    supplierName: null,
    supplierTaxId: null,
    invoiceNumber: null,
    currencyCode: null,
    lines,
  };
}

function makeScore(
  partial: Partial<FixtureScore> & { fixtureId: string; truthLines: number; matchedLines: number }
): FixtureScore {
  return {
    fixtureId: partial.fixtureId,
    truthLines: partial.truthLines,
    matchedLines: partial.matchedLines,
    accuracy: partial.truthLines === 0 ? 1 : partial.matchedLines / partial.truthLines,
    costUsd: partial.costUsd ?? 0,
    durationMs: partial.durationMs ?? 0,
  };
}

describe('benchmark-scoring helpers', () => {
  describe('normalizeDescription', () => {
    it('lowercases, strips accents, drops non-alphanumeric chars', () => {
      expect(normalizeDescription('  CAFÉ   Americano  ')).toBe('cafeamericano');
      expect(normalizeDescription('Coca-Cola 1.5L')).toBe('cocacola15l');
    });
  });

  describe('descriptionSimilarity', () => {
    it('returns 1 for identical strings ignoring case + accents', () => {
      expect(descriptionSimilarity('Café americano', 'cafe americano')).toBe(1);
    });

    it('returns >= 0.7 for fuzzy variants', () => {
      const s = descriptionSimilarity('Café americano', 'café americano grande');
      expect(s).toBeGreaterThanOrEqual(0.7);
    });

    it('returns < 0.7 for unrelated strings', () => {
      const s = descriptionSimilarity('Café', 'Té');
      expect(s).toBeLessThan(0.7);
    });
  });

  describe('isLineMatch', () => {
    it('matches when description fuzzy, quantity equal, unitPrice within 1%', () => {
      const truth: FixtureGroundTruth['lines'][number] = {
        description: 'Coca-Cola 1.5L',
        quantity: 2,
        unitPrice: 5000,
        totalLine: 10000,
      };
      expect(
        isLineMatch(truth, {
          description: 'Coca Cola 1.5 L',
          quantity: 2,
          unitPrice: 5025,
          totalLine: 10050,
        })
      ).toBe(true);
    });

    it('rejects when unitPrice drifts beyond 1%', () => {
      const truth: FixtureGroundTruth['lines'][number] = {
        description: 'Hamburguesa',
        quantity: 1,
        unitPrice: 100,
        totalLine: 100,
      };
      expect(
        isLineMatch(truth, {
          description: 'Hamburguesa',
          quantity: 1,
          unitPrice: 102,
          totalLine: 102,
        })
      ).toBe(false);
    });

    it('treats both-null quantity as a match', () => {
      const truth: FixtureGroundTruth['lines'][number] = {
        description: 'Servicio',
        quantity: null,
        unitPrice: 50000,
        totalLine: 50000,
      };
      expect(
        isLineMatch(truth, {
          description: 'Servicio',
          quantity: null,
          unitPrice: 50000,
          totalLine: 50000,
        })
      ).toBe(true);
    });
  });

  describe('scoreFixture', () => {
    it('A1 — exact description + quantity + unitPrice match', () => {
      const truth = makeTruth([
        { description: 'Empanada de carne', quantity: 3, unitPrice: 3500, totalLine: 10500 },
      ]);
      const extracted = makeOcr([
        { description: 'Empanada de carne', quantity: 3, unitPrice: 3500, totalLine: 10500 },
      ]);
      expect(scoreFixture(truth, extracted)).toEqual({ matchedLines: 1, truthLines: 1 });
    });

    it('A2 — fuzzy description match passes the 0.7 bigram threshold', () => {
      const truth = makeTruth([
        { description: 'Café americano', quantity: 2, unitPrice: 4500, totalLine: 9000 },
      ]);
      const extracted = makeOcr([
        { description: 'café americano grande', quantity: 2, unitPrice: 4500, totalLine: 9000 },
      ]);
      expect(scoreFixture(truth, extracted)).toEqual({ matchedLines: 1, truthLines: 1 });
    });

    it('A3 — false-positive extracted lines do not change the denominator', () => {
      const truth = makeTruth([
        { description: 'Pan baguette', quantity: 1, unitPrice: 2500, totalLine: 2500 },
      ]);
      const extracted = makeOcr([
        { description: 'Pan baguette', quantity: 1, unitPrice: 2500, totalLine: 2500 },
        {
          description: 'Servilletas extra (fantasma)',
          quantity: 1,
          unitPrice: 500,
          totalLine: 500,
        },
      ]);
      expect(scoreFixture(truth, extracted)).toEqual({ matchedLines: 1, truthLines: 1 });
    });

    it('A4 — quantity mismatch breaks the match', () => {
      const truth = makeTruth([
        { description: 'Coca-Cola 1.5L', quantity: 2, unitPrice: 5000, totalLine: 10000 },
      ]);
      const extracted = makeOcr([
        { description: 'Coca-Cola 1.5L', quantity: 3, unitPrice: 5000, totalLine: 15000 },
      ]);
      expect(scoreFixture(truth, extracted)).toEqual({ matchedLines: 0, truthLines: 1 });
    });

    it('A5 — unitPrice within 1% tolerance still matches', () => {
      const truth = makeTruth([
        { description: 'Hamburguesa simple', quantity: 1, unitPrice: 12000, totalLine: 12000 },
      ]);
      const extracted = makeOcr([
        { description: 'Hamburguesa simple', quantity: 1, unitPrice: 12100, totalLine: 12100 },
      ]);
      expect(scoreFixture(truth, extracted)).toEqual({ matchedLines: 1, truthLines: 1 });
    });

    it('A6 — unitPrice outside 1% tolerance breaks the match', () => {
      const truth = makeTruth([
        { description: 'Hamburguesa simple', quantity: 1, unitPrice: 12000, totalLine: 12000 },
      ]);
      const extracted = makeOcr([
        { description: 'Hamburguesa simple', quantity: 1, unitPrice: 12500, totalLine: 12500 },
      ]);
      expect(scoreFixture(truth, extracted)).toEqual({ matchedLines: 0, truthLines: 1 });
    });

    it('A9 — both-null quantity is matched', () => {
      const truth = makeTruth([
        { description: 'Servicio de mesa', quantity: null, unitPrice: 50000, totalLine: 50000 },
      ]);
      const extracted = makeOcr([
        { description: 'Servicio de mesa', quantity: null, unitPrice: 50000, totalLine: 50000 },
      ]);
      expect(scoreFixture(truth, extracted)).toEqual({ matchedLines: 1, truthLines: 1 });
    });

    it('A10 — accented vs unaccented description still matches', () => {
      const truth = makeTruth([
        { description: 'Plátano maduro', quantity: 4, unitPrice: 800, totalLine: 3200 },
      ]);
      const extracted = makeOcr([
        { description: 'Platano maduro', quantity: 4, unitPrice: 800, totalLine: 3200 },
      ]);
      expect(scoreFixture(truth, extracted)).toEqual({ matchedLines: 1, truthLines: 1 });
    });

    it('returns 0/0 for an empty truth (skipped fixture)', () => {
      const truth = makeTruth([]);
      const extracted = makeOcr([
        { description: 'Algo', quantity: 1, unitPrice: 100, totalLine: 100 },
      ]);
      expect(scoreFixture(truth, extracted)).toEqual({ matchedLines: 0, truthLines: 0 });
    });

    it('uses greedy assignment so duplicate truth lines do not over-match a single extracted row', () => {
      const truth = makeTruth([
        { description: 'Café americano', quantity: 1, unitPrice: 4000, totalLine: 4000 },
        { description: 'Café americano', quantity: 1, unitPrice: 4000, totalLine: 4000 },
      ]);
      const extracted = makeOcr([
        { description: 'Café americano', quantity: 1, unitPrice: 4000, totalLine: 4000 },
      ]);
      expect(scoreFixture(truth, extracted)).toEqual({ matchedLines: 1, truthLines: 2 });
    });
  });

  describe('aggregateBenchmark', () => {
    it('A7 — passes when aggregate accuracy reaches the 0.80 threshold', () => {
      const scores: FixtureScore[] = [
        makeScore({ fixtureId: '01', truthLines: 5, matchedLines: 5 }),
        makeScore({ fixtureId: '02', truthLines: 5, matchedLines: 3 }),
      ];
      const result = aggregateBenchmark(scores);
      expect(result.matched).toBe(8);
      expect(result.total).toBe(10);
      expect(result.accuracy).toBeCloseTo(0.8, 5);
      expect(result.passed).toBe(true);
      expect(result.threshold).toBe(0.8);
    });

    it('A8 — fails when aggregate accuracy is below the threshold', () => {
      const scores: FixtureScore[] = [
        makeScore({ fixtureId: '01', truthLines: 5, matchedLines: 4 }),
        makeScore({ fixtureId: '02', truthLines: 5, matchedLines: 3 }),
      ];
      const result = aggregateBenchmark(scores);
      expect(result.matched).toBe(7);
      expect(result.total).toBe(10);
      expect(result.accuracy).toBe(0.7);
      expect(result.passed).toBe(false);
    });

    it('sums costUsd + durationMs across fixtures', () => {
      const scores: FixtureScore[] = [
        makeScore({
          fixtureId: '01',
          truthLines: 1,
          matchedLines: 1,
          costUsd: 0.005,
          durationMs: 800,
        }),
        makeScore({
          fixtureId: '02',
          truthLines: 1,
          matchedLines: 1,
          costUsd: 0.007,
          durationMs: 1100,
        }),
      ];
      const result = aggregateBenchmark(scores);
      expect(result.costUsd).toBeCloseTo(0.012, 5);
      expect(result.durationMs).toBe(1900);
    });

    it('handles empty input as accuracy = 1 (no fixtures), respects custom threshold', () => {
      const result = aggregateBenchmark([], 0.9);
      expect(result.matched).toBe(0);
      expect(result.total).toBe(0);
      expect(result.accuracy).toBe(1);
      expect(result.threshold).toBe(0.9);
      expect(result.passed).toBe(true);
    });

    it('skips empty-truth fixtures from numerator and denominator', () => {
      const scores: FixtureScore[] = [
        makeScore({ fixtureId: '01', truthLines: 0, matchedLines: 0 }),
        makeScore({ fixtureId: '02', truthLines: 4, matchedLines: 4 }),
      ];
      const result = aggregateBenchmark(scores);
      expect(result.matched).toBe(4);
      expect(result.total).toBe(4);
      expect(result.accuracy).toBe(1);
      expect(result.passed).toBe(true);
    });
  });
});
