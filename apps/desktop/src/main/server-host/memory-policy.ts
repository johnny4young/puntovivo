/**
 * Memory caps and watch threshold for the server worker (ADR 0034). The values
 * are provisional until the soak calibrates them on the target register.
 */
import type { ResourceLimits } from 'node:worker_threads';

/** Old-generation heap cap; the target is twice the soak peak. */
export const DEFAULT_WORKER_MAX_OLD_GENERATION_MB = 384;
/** Process RSS that, seen twice in a row, raises a memory alert. v1 only alerts. */
export const DEFAULT_RSS_ALERT_MB = 900;
/** How often the worker reports memory and event-loop use. */
export const WORKER_STATS_INTERVAL_MS = 60_000;

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
