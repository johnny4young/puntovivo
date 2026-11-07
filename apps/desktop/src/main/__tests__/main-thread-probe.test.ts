import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildIpcProbeScript,
  createStallSampler,
  measureMainThreadWindow,
  summarizeLatencies,
} from '../main-thread-probe.ts';

function createFakeClock() {
  let now = 0;
  let tick: (() => void) | null = null;
  return {
    clock: {
      now: () => now,
      setInterval: (callback: () => void) => {
        tick = callback;
        return 1;
      },
      clearInterval: () => {
        tick = null;
      },
    },
    /** Advance time and fire the interval once, as a late timer would. */
    fireAt(at: number) {
      now = at;
      tick?.();
    },
    set(at: number) {
      now = at;
    },
    get running() {
      return tick !== null;
    },
  };
}

describe('main-thread stall sampler', () => {
  it('counts only lateness past the jitter floor as blocked time', () => {
    const fake = createFakeClock();
    const sampler = createStallSampler({ intervalMs: 10, minStallMs: 10, clock: fake.clock });
    sampler.start();
    fake.fireAt(10); // on time
    fake.fireAt(25); // 5 ms late: jitter
    fake.fireAt(95); // 60 ms late: blocked
    fake.fireAt(255); // 150 ms late: blocked
    fake.set(1000);
    const summary = sampler.stop();

    assert.equal(fake.running, false);
    assert.equal(summary.windowMs, 1000);
    // The final partial gap (255 -> 1000) also counts: 735 ms late.
    assert.equal(summary.blockedMs, 60 + 150 + 735);
    assert.equal(summary.blockedPercent, 94.5);
    assert.equal(summary.maxStallMs, 735);
    assert.equal(summary.stallsOver50Ms, 3);
    assert.equal(summary.stallsOver100Ms, 2);
  });

  it('reports an idle window as unblocked', () => {
    const fake = createFakeClock();
    const sampler = createStallSampler({ intervalMs: 10, clock: fake.clock });
    sampler.start();
    for (let at = 10; at <= 100; at += 10) fake.fireAt(at);
    const summary = sampler.stop();
    assert.equal(summary.blockedMs, 0);
    assert.equal(summary.blockedPercent, 0);
    assert.equal(summary.maxStallMs, 0);
  });
});

describe('latency summary', () => {
  it('uses nearest-rank percentiles', () => {
    const samples = Array.from({ length: 100 }, (_, index) => index + 1);
    assert.deepEqual(summarizeLatencies(samples), {
      count: 100,
      p50: 50,
      p95: 95,
      p99: 99,
      max: 100,
    });
  });

  it('ignores non-finite samples and reports an empty set as zeros', () => {
    assert.deepEqual(summarizeLatencies([Number.NaN]), {
      count: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      max: 0,
    });
  });
});

describe('main-thread window', () => {
  it('probes the trivial app-version channel for the requested duration', () => {
    const script = buildIpcProbeScript(15_000.7, 25);
    assert.match(script, /window\.electron\.getAppVersion\(\)/);
    assert.match(script, /performance\.now\(\) \+ 15000;/);
    assert.match(script, /setTimeout\(resolve, 25\)/);
  });

  it('summarizes renderer samples alongside the sampler', async () => {
    const fake = createFakeClock();
    const metrics = await measureMainThreadWindow({
      durationMs: 1000,
      sampler: createStallSampler({ clock: fake.clock }),
      runRendererScript: async () => {
        fake.set(1000);
        return [1, 2, 3];
      },
    });
    assert.equal(metrics.ipc.count, 3);
    assert.equal(metrics.ipc.max, 3);
    assert.equal(metrics.mainThread.windowMs, 1000);
  });

  it('stops the sampler when the renderer probe fails', async () => {
    const fake = createFakeClock();
    await assert.rejects(
      measureMainThreadWindow({
        durationMs: 1000,
        sampler: createStallSampler({ clock: fake.clock }),
        runRendererScript: async () => {
          throw new Error('renderer gone');
        },
      }),
      /renderer gone/
    );
    assert.equal(fake.running, false);
  });
});
