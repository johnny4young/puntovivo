import { describe, expect, it } from 'vitest';

import { runVectorStorageBenchmark } from './vector-storage-benchmark.js';

describe('vector storage benchmark', () => {
  it('compares JSON and PVEC against the bounded semantic candidate pool', () => {
    const report = runVectorStorageBenchmark({
      dimensions: [384, 768],
      candidateCount: 20,
      topK: 5,
      warmupIterations: 0,
      samples: 1,
      seed: 0x5eed2026,
    });

    expect(report.results).toHaveLength(2);
    for (const result of report.results) {
      expect(result.pvecFloat32.bytesPerVector).toBe(12 + result.dimensions * 4);
      expect(result.pvecFloat32.storageReductionPercent).toBeGreaterThan(70);
      expect(result.pvecFloat32.recallAtK).toBe(1);
      expect(result.pvecFloat32.maxSimilarityError).toBeLessThan(1e-6);
      expect(result.json.decodeAndRankP95Ms).toBeGreaterThanOrEqual(0);
      expect(result.pvecFloat32.decodeAndRankP95Ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects malformed benchmark contracts', () => {
    expect(() =>
      runVectorStorageBenchmark({
        dimensions: [],
        candidateCount: 0,
        topK: 1,
        warmupIterations: 0,
        samples: 0,
        seed: 1,
      })
    ).toThrow(/configuration/);
  });
});
