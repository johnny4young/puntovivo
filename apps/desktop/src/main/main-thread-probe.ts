/**
 * Main-thread responsiveness measurement for the Electron gate.
 *
 * Electron-free so the sampler and summaries run under `node --test`. The
 * gate script drives the server from outside the app; this module only
 * observes the main thread and the renderer IPC round trip meanwhile.
 */

/** Timer lateness below this is scheduler jitter, not a blocked main thread. */
export const DEFAULT_MIN_STALL_MS = 10;
export const DEFAULT_SAMPLE_INTERVAL_MS = 10;
export const DEFAULT_IPC_PROBE_INTERVAL_MS = 25;

/** How long and how badly the main thread was blocked during one window. */
export interface StallSummary {
  windowMs: number;
  blockedMs: number;
  blockedPercent: number;
  maxStallMs: number;
  stallsOver50Ms: number;
  stallsOver100Ms: number;
}

/** Percentiles of one latency sample set, in milliseconds. */
export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** What the main process prints as `PUNTOVIVO_MAIN_THREAD_METRICS=<json>`. */
export interface MainThreadMetrics {
  mainThread: StallSummary;
  ipc: LatencySummary;
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

/** Nearest-rank percentiles; an empty set reports zeros with `count: 0`. */
export function summarizeLatencies(samples: readonly number[]): LatencySummary {
  const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (percentile: number) =>
    sorted.length === 0
      ? 0
      : round(
          sorted[Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1)]!
        );
  return {
    count: sorted.length,
    p50: at(50),
    p95: at(95),
    p99: at(99),
    max: sorted.length === 0 ? 0 : round(sorted.at(-1)!),
  };
}

/**
 * Renderer script: invokes the trivial `get-app-version` channel every
 * `intervalMs` for `durationMs` and resolves with each round trip in ms.
 */
export function buildIpcProbeScript(
  durationMs: number,
  intervalMs = DEFAULT_IPC_PROBE_INTERVAL_MS
): string {
  return `(async () => {
  const end = performance.now() + ${Math.trunc(durationMs)};
  const samples = [];
  while (performance.now() < end) {
    const startedAt = performance.now();
    await window.electron.getAppVersion();
    samples.push(performance.now() - startedAt);
    await new Promise(resolve => setTimeout(resolve, ${Math.trunc(intervalMs)}));
  }
  return samples;
})()`;
}

/** Runs the sampler and the renderer probe over the same window. */
export async function measureMainThreadWindow(deps: {
  durationMs: number;
  runRendererScript: (script: string) => Promise<unknown>;
  sampler?: ReturnType<typeof createStallSampler>;
}): Promise<MainThreadMetrics> {
  const sampler = deps.sampler ?? createStallSampler();
  sampler.start();
  let samples: unknown;
  try {
    samples = await deps.runRendererScript(buildIpcProbeScript(deps.durationMs));
  } catch (error) {
    sampler.stop();
    throw error;
  }
  return {
    mainThread: sampler.stop(),
    ipc: summarizeLatencies(Array.isArray(samples) ? (samples as number[]) : []),
  };
}
