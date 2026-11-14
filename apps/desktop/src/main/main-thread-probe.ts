/**
 * Main-thread stall sampler for the soak mode. Electron-free so it runs under
 * `node --test`.
 */

/** Timer lateness below this is scheduler jitter, not a blocked main thread. */
export const DEFAULT_MIN_STALL_MS = 10;
export const DEFAULT_SAMPLE_INTERVAL_MS = 10;

/** How long and how badly the main thread was blocked during one window. */
export interface StallSummary {
  windowMs: number;
  blockedMs: number;
  blockedPercent: number;
  maxStallMs: number;
  stallsOver50Ms: number;
  stallsOver100Ms: number;
}

interface SamplerClock {
  now: () => number;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Samples a short interval timer: every tick that fires later than its
 * interval plus `minStallMs` adds the lateness to the blocked total.
 */
export function createStallSampler(
  options: {
    intervalMs?: number;
    minStallMs?: number;
    clock?: SamplerClock;
  } = {}
) {
  const intervalMs = options.intervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
  const minStallMs = options.minStallMs ?? DEFAULT_MIN_STALL_MS;
  const clock: SamplerClock = options.clock ?? {
    now: () => performance.now(),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
  };
  const stalls: number[] = [];
  let startedAt = 0;
  let last = 0;
  let handle: unknown = null;

  function record(at: number): void {
    const stall = at - last - intervalMs;
    if (stall >= minStallMs) stalls.push(stall);
    last = at;
  }

  return {
    start(): void {
      startedAt = clock.now();
      last = startedAt;
      handle = clock.setInterval(() => record(clock.now()), intervalMs);
    },
    stop(): StallSummary {
      const stoppedAt = clock.now();
      clock.clearInterval(handle);
      record(stoppedAt);
      const windowMs = Math.max(stoppedAt - startedAt, 1);
      const blockedMs = stalls.reduce((sum, stall) => sum + stall, 0);
      return {
        windowMs: round(windowMs),
        blockedMs: round(blockedMs),
        blockedPercent: round((blockedMs / windowMs) * 100),
        maxStallMs: round(stalls.reduce((max, stall) => Math.max(max, stall), 0)),
        stallsOver50Ms: stalls.filter(stall => stall > 50).length,
        stallsOver100Ms: stalls.filter(stall => stall > 100).length,
      };
    },
  };
}
