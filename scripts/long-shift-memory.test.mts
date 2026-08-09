import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareRendererMemoryGrowth,
  renderRendererMemoryReport,
  type RendererMemoryGrowthBudget,
  type RendererMemorySample,
} from '../e2e/web/support/long-shift-memory.ts';

const budget: RendererMemoryGrowthBudget = {
  usedHeapMb: 4,
  documents: 1,
  nodes: 100,
  jsEventListeners: 8,
};

function sample(
  checkpoint: number,
  overrides: Partial<RendererMemorySample> = {}
): RendererMemorySample {
  return {
    checkpoint,
    usedHeapMb: 40,
    documents: 3,
    nodes: 500,
    jsEventListeners: 80,
    ...overrides,
  };
}

test('accepts bounded post-GC growth and ignores released intermediate peaks', () => {
  const samples = [
    sample(0),
    sample(10, { usedHeapMb: 65, nodes: 900, jsEventListeners: 120 }),
    sample(20, { usedHeapMb: 44, nodes: 570, jsEventListeners: 86 }),
  ];
  const result = compareRendererMemoryGrowth(samples, budget);
  assert.deepEqual(result.growth, {
    usedHeapMb: 4,
    documents: 0,
    nodes: 70,
    jsEventListeners: 6,
  });
  assert.deepEqual(result.regressions, []);
});

test('rejects final retained heap, DOM, document, and listener growth independently', () => {
  const result = compareRendererMemoryGrowth(
    [
      sample(0),
      sample(30, {
        usedHeapMb: 49,
        documents: 5,
        nodes: 601,
        jsEventListeners: 89,
      }),
    ],
    budget
  );
  assert.deepEqual(
    result.regressions.map(item => item.metric),
    ['usedHeapMb', 'documents', 'nodes', 'jsEventListeners']
  );
  assert.match(renderRendererMemoryReport([result.baseline, result.final], result, budget), /FAIL/);
});

test('requires baseline plus final evidence', () => {
  assert.throws(() => compareRendererMemoryGrowth([sample(0)], budget), /baseline and final/);
});
