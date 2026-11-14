import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createStallSampler } from '../main-thread-probe.ts';

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
