import type { CDPSession, Page } from '@playwright/test';

export const LONG_SHIFT_METRICS = ['usedHeapMb', 'documents', 'nodes', 'jsEventListeners'] as const;

export type LongShiftMetric = (typeof LONG_SHIFT_METRICS)[number];

export interface RendererMemorySample {
  checkpoint: number;
  usedHeapMb: number;
  documents: number;
  nodes: number;
  jsEventListeners: number;
}

export interface RendererMemoryGrowthBudget {
  usedHeapMb: number;
  documents: number;
  nodes: number;
  jsEventListeners: number;
}

export interface RendererMemoryGrowthResult {
  baseline: RendererMemorySample;
  final: RendererMemorySample;
  growth: Record<LongShiftMetric, number>;
  regressions: Array<{
    metric: LongShiftMetric;
    growth: number;
    ceiling: number;
  }>;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Force a renderer GC before reading CDP counters. Working-set RSS is useful
 * for the existing Electron boot ceiling, but it does not reliably return
 * pages to the OS during one shift. Used JS heap plus live DOM/listener counts
 * are the stable leak signals for a same-renderer lifecycle soak.
 */
export async function sampleRendererMemory(
  page: Page,
  session: CDPSession,
  checkpoint: number,
  settleMs: number
): Promise<RendererMemorySample> {
  await page.requestGC();
  await page.waitForTimeout(settleMs);
  await page.requestGC();

  const heap = (await session.send('Runtime.getHeapUsage')) as {
    usedSize: number;
  };
  const dom = (await session.send('Memory.getDOMCounters')) as {
    documents: number;
    nodes: number;
    jsEventListeners: number;
  };

  return {
    checkpoint,
    usedHeapMb: round(heap.usedSize / 1024 / 1024),
    documents: dom.documents,
    nodes: dom.nodes,
    jsEventListeners: dom.jsEventListeners,
  };
}

export function compareRendererMemoryGrowth(
  samples: RendererMemorySample[],
  budget: RendererMemoryGrowthBudget
): RendererMemoryGrowthResult {
  if (samples.length < 2) {
    throw new Error('long-shift soak needs at least a baseline and final sample');
  }

  const baseline = samples[0]!;
  const final = samples.at(-1)!;
  const growth = Object.fromEntries(
    LONG_SHIFT_METRICS.map(metric => [metric, round(final[metric] - baseline[metric])])
  ) as Record<LongShiftMetric, number>;
  const regressions = LONG_SHIFT_METRICS.flatMap(metric =>
    growth[metric] > budget[metric]
      ? [{ metric, growth: growth[metric], ceiling: budget[metric] }]
      : []
  );

  return { baseline, final, growth, regressions };
}

export function renderRendererMemoryReport(
  samples: RendererMemorySample[],
  result: RendererMemoryGrowthResult,
  budget: RendererMemoryGrowthBudget
): string {
  const lines = [
    `Long-shift renderer memory ${result.regressions.length === 0 ? 'PASS' : 'FAIL'}`,
    '| checkpoint | heap MB | documents | nodes | listeners |',
    '| ---: | ---: | ---: | ---: | ---: |',
    ...samples.map(
      sample =>
        `| ${sample.checkpoint} | ${sample.usedHeapMb.toFixed(2)} | ${sample.documents} | ${sample.nodes} | ${sample.jsEventListeners} |`
    ),
    '',
    '| metric | final growth | ceiling |',
    '| --- | ---: | ---: |',
    ...LONG_SHIFT_METRICS.map(
      metric => `| ${metric} | ${result.growth[metric]} | ${budget[metric]} |`
    ),
  ];
  return lines.join('\n');
}
