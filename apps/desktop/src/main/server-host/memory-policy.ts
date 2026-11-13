/**
 * Memory caps and watch for the server worker (ADR 0034). The values are
 * provisional until the soak calibrates them on the target register.
 */
import type { ResourceLimits } from 'node:worker_threads';
import type { WorkerMemorySample } from './protocol.ts';

/** Old-generation heap cap; the target is twice the soak peak. */
export const DEFAULT_WORKER_MAX_OLD_GENERATION_MB = 384;
/** Process RSS that, seen twice in a row, raises a memory alert. */
export const DEFAULT_RSS_ALERT_MB = 900;

function readPositiveInt(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Caps for the worker, overridable per machine while calibrating. */
export function resolveWorkerResourceLimits(env: NodeJS.ProcessEnv = process.env): ResourceLimits {
  return {
    maxOldGenerationSizeMb:
      readPositiveInt(env.PUNTOVIVO_SERVER_WORKER_MAX_OLD_MB) ??
      DEFAULT_WORKER_MAX_OLD_GENERATION_MB,
  };
}

/**
 * Native memory (SQLite cache, mmap, Argon2, buffers) is outside the V8 cap,
 * so RSS is watched instead. v1 only alerts; it never restarts the worker.
 */
export function createMemoryWatch(deps: {
  thresholdMb?: number;
  onAlert: (sample: WorkerMemorySample) => void;
}) {
  const threshold = deps.thresholdMb ?? DEFAULT_RSS_ALERT_MB;
  let overInARow = 0;
  let alerted = false;
  return {
    observe(sample: WorkerMemorySample): void {
      overInARow = sample.rssMb > threshold ? overInARow + 1 : 0;
      if (overInARow === 0) alerted = false;
      if (overInARow >= 2 && !alerted) {
        alerted = true;
        deps.onAlert(sample);
      }
    },
  };
}
