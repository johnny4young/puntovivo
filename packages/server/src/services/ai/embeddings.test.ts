/**
 * embeddings test scaffolding.
 *
 * The pure math (cosine similarity, parseEmbedding, canonical text)
 * is the failure mode that scales with every search request, so the
 * tests focus there. The provider-network paths (`embedText`,
 * `regenerateProductEmbeddings`) are validated by the live smoke
 * since hitting the OpenAI API in unit tests is not the right shape
 * here — they would either be brittle (real network) or trivially
 * mocked (no useful assertion).
 */
import { describe, expect, it } from 'vitest';

import { __testInternals } from './embeddings.js';

const { cosineSimilarity, parseEmbedding, productCanonicalText } = __testInternals;

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 6);
  });

  it('returns 0 for zero-length input (no division-by-zero)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 1, 1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 when dimensions mismatch (defensive)', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('approximates real OpenAI semantic distances correctly', () => {
    // Synthetic fixture: two near-aligned vectors should score ~0.95+.
    const a = [0.12, -0.34, 0.78, 0.05, -0.22];
    const b = [0.15, -0.32, 0.75, 0.07, -0.2];
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.95);

    // Two semantically unrelated vectors should score below 0.5.
    const x = [0.9, 0.1, 0.0, -0.4, 0.2];
    const y = [-0.5, 0.7, -0.2, 0.3, 0.6];
    expect(cosineSimilarity(x, y)).toBeLessThan(0.5);
  });
});

describe('parseEmbedding', () => {
  it('returns null for null input', () => {
    expect(parseEmbedding(null)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseEmbedding('{not-json')).toBeNull();
  });

  it('returns null for non-array JSON', () => {
    expect(parseEmbedding('{"foo":1}')).toBeNull();
  });

  it('parses a valid float array', () => {
    expect(parseEmbedding('[1.5, -0.3, 0.0]')).toEqual([1.5, -0.3, 0.0]);
  });

  it('filters non-numeric entries within otherwise valid JSON (defensive)', () => {
    // JSON itself disallows NaN / Infinity literals, so the realistic
    // bad-data case is a number-typed array contaminated with strings
    // / nulls (e.g. a halfway-corrupted DB row).
    expect(parseEmbedding('[1.5, "a", null, 2.5]')).toEqual([1.5, 2.5]);
  });
});

describe('productCanonicalText', () => {
  it('uses just the name when description and sku are missing', () => {
    expect(productCanonicalText({ name: 'Vino tinto reserva' })).toBe('Vino tinto reserva');
  });

  it('joins name + description + sku with em-dash separator', () => {
    expect(
      productCanonicalText({
        name: 'Vino tinto reserva',
        description: 'Cosecha 2020',
        sku: 'VT-2020',
      })
    ).toBe('Vino tinto reserva — Cosecha 2020 — VT-2020');
  });

  it('skips description / sku when null', () => {
    expect(productCanonicalText({ name: 'Manzana', description: null, sku: null })).toBe('Manzana');
  });

  it('preserves Unicode characters (Spanish accents, ñ)', () => {
    expect(productCanonicalText({ name: 'Empanada de pollo y piña', sku: 'PIÑA-01' })).toBe(
      'Empanada de pollo y piña — PIÑA-01'
    );
  });
});
