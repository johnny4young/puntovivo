/**
 * When main may restart a server worker that died on its own. Pure, so the
 * lifecycle and its tests share one definition (ADR 0034).
 */

export type WorkerExitKind = 'oom' | 'uncaught' | 'unknown';

/** Why a worker that died must not be restarted. */
export type WorkerFatalCause = 'corruption' | 'key';

/** What main knows about a worker that exited without being asked to. */
export interface WorkerExitFailure {
  error: Error;
  kind: WorkerExitKind;
  exitCode: number;
  uptimeMs: number;
  pendingCalls: number;
}

const CORRUPTION_CODES = new Set(['SQLITE_CORRUPT', 'SQLITE_NOTADB', 'SQLITE_CORRUPT_VTAB']);
const CORRUPTION_MESSAGES = [/database disk image is malformed/i, /file is not a database/i];
// Anchor store and key envelope failures: restarting reopens the same state.
const KEY_CODE = /^(AUDIT_ANCHOR_[A-Z_]+|DB_KEY_[A-Z_]+|SQLITE_AUTH)$/;

/** A corrupt database or a key that no longer opens it is never retried. */
export function classifyFatalCause(error: Error): WorkerFatalCause | null {
  const code = (error as { code?: unknown }).code;
  // Anchor failures are thrown with the code as their message.
  const candidates = [typeof code === 'string' ? code : '', error.message.trim()];
  if (candidates.some(value => CORRUPTION_CODES.has(value))) return 'corruption';
  if (candidates.some(value => KEY_CODE.test(value))) return 'key';
  if (CORRUPTION_MESSAGES.some(pattern => pattern.test(error.message))) return 'corruption';
  return null;
}

export interface RestartPolicyOptions {
  /** Restarts allowed inside `windowMs`; one more is fatal. */
  maxRestarts?: number;
  windowMs?: number;
  /** Delay before the 1st, 2nd and 3rd restart in the window. */
  backoffMs?: readonly number[];
}

export type RestartDecision =
  | { action: 'restart'; attempt: number; delayMs: number }
  | { action: 'give-up'; restartsInWindow: number };

export const DEFAULT_RESTART_POLICY = {
  maxRestarts: 3,
  windowMs: 10 * 60_000,
  backoffMs: [500, 2_000, 8_000],
} as const satisfies Required<RestartPolicyOptions>;

/** Sliding window of restarts: ten quiet minutes clear the count. */
export function createRestartBudget(options: RestartPolicyOptions = {}) {
  const maxRestarts = options.maxRestarts ?? DEFAULT_RESTART_POLICY.maxRestarts;
  const windowMs = options.windowMs ?? DEFAULT_RESTART_POLICY.windowMs;
  const backoffMs = options.backoffMs ?? DEFAULT_RESTART_POLICY.backoffMs;
  let restarts: number[] = [];

  return {
    /** Records one restart attempt at `now` when it is allowed. */
    next(now: number): RestartDecision {
      restarts = restarts.filter(at => now - at < windowMs);
      if (restarts.length >= maxRestarts) {
        return { action: 'give-up', restartsInWindow: restarts.length };
      }
      restarts.push(now);
      const attempt = restarts.length;
      const delayMs = backoffMs[Math.min(attempt, backoffMs.length) - 1] ?? 0;
      return { action: 'restart', attempt, delayMs };
    },
  };
}
