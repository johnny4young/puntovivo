/**
 * login_attempts cleanup worker.
 *
 * The `login_attempts` table records per-IP and per-email rate-limit
 * buckets that  /  use to throttle login probes. Each
 * row carries an `expires_at` (epoch ms) and is consulted on every
 * login + refresh; once the window closes, the row is logically dead
 * but stays on disk because the rate-limit middleware only updates
 * existing buckets (or inserts fresh ones), never deletes.
 *
 * Without housekeeping, a busy POS accumulates one row per distinct
 * (ip, email) pair seen over the lifetime of the install — easily
 * tens of thousands on a public-facing site over a year. The audit
 * () flagged this as the second
 * unbounded table on disk and asked for a 24 h cleanup sweep.
 *
 * Why a worker (not a TRIGGER): SQLite triggers fire per-write, which
 * would add per-login overhead. A periodic sweep amortizes the cost
 * over the table lifetime and runs only when the server is up.
 *
 * Why 24 h after expiry (not at expiry): we keep expired buckets for
 * a day of slack so a longer audit window can correlate failed-login
 * sprees back to a row's full history. After 24 h the row is purely
 * historical and `system_audit_logs` records that the cleanup ran.
 *
 * Cadence: once per hour. A login_attempts row never matters more
 * than once an hour after it expires, and the DELETE itself touches
 * an indexed column (`idx_login_attempts_expires_at`) so the sweep
 * is O(log n) per pass.
 */

import type { DatabaseInstance } from '../../db/index.js';
import { lt } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { loginAttempts, systemAuditLogs, type NewSystemAuditLog } from '../../db/schema.js';
import { createModuleLogger } from '../../logging/logger.js';

const cleanupLog = createModuleLogger('services/cleanup/login-attempts');

/** Run the sweep no more often than once an hour. */
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
/** Drop rows that expired more than 24 h ago. */
const STALE_AGE_MS = 24 * 60 * 60 * 1000;
const CLEANUP_ACTION = 'login_attempts.cleanup';
const CLEANUP_RESOURCE_TYPE = 'login_attempts';
const CLEANUP_RESOURCE_ID = 'global';

export interface LoginAttemptsCleanupHandle {
  /** Drive a single sweep on demand (test hook + boot pre-warm). */
  tickOnce: () => number;
  /** Stop the periodic timer; idempotent. */
  stop: () => void;
}

export interface LoginAttemptsCleanupOptions {
  db: DatabaseInstance;
  /** Override the periodic interval. Defaults to one hour. */
  intervalMs?: number;
  /** Override the stale-age threshold. Defaults to 24 h. */
  staleAgeMs?: number;
  /** Inject a clock so tests can advance time deterministically. */
  now?: () => number;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
    };
  }
  return { message: String(err) };
}

function buildAuditRow(args: {
  status: NewSystemAuditLog['status'];
  startedAt: number;
  cutoff: number;
  staleAgeMs: number;
  deleted?: number;
  err?: unknown;
}): NewSystemAuditLog {
  const metadata: Record<string, unknown> = {
    cutoff: args.cutoff,
    cutoffIso: new Date(args.cutoff).toISOString(),
    staleAgeMs: args.staleAgeMs,
  };
  if (args.deleted !== undefined) {
    metadata.deleted = args.deleted;
  }
  if (args.err !== undefined) {
    metadata.error = serializeError(args.err);
  }

  return {
    id: nanoid(),
    action: CLEANUP_ACTION,
    resourceType: CLEANUP_RESOURCE_TYPE,
    resourceId: CLEANUP_RESOURCE_ID,
    status: args.status,
    metadata,
    createdAt: new Date(args.startedAt).toISOString(),
  };
}

/**
 * Factory mirrors the fiscalWorker / paymentWorker shape: returns a
 * handle whose `.tickOnce()` is callable by tests and whose `.stop()`
 * releases the interval timer. The caller (createServer) starts the
 * timer inside `listen()` so test harnesses that build a server
 * without listening do not accumulate background timers.
 */
export function createLoginAttemptsCleanup(
  options: LoginAttemptsCleanupOptions
): LoginAttemptsCleanupHandle & { start: () => void } {
  const { db, intervalMs = DEFAULT_INTERVAL_MS, staleAgeMs = STALE_AGE_MS } = options;
  const now = options.now ?? (() => Date.now());
  let timer: NodeJS.Timeout | null = null;

  function tickOnce(): number {
    const startedAt = now();
    const cutoff = startedAt - staleAgeMs;
    try {
      const deleted = db.transaction(tx => {
        const result = tx
          .delete(loginAttempts)
          .where(lt(loginAttempts.expiresAt, cutoff))
          .run() as { changes?: number };
        const changes = result.changes ?? 0;
        tx.insert(systemAuditLogs)
          .values(
            buildAuditRow({
              status: 'ok',
              startedAt,
              cutoff,
              staleAgeMs,
              deleted: changes,
            })
          )
          .run();
        return changes;
      });
      if (deleted > 0) {
        cleanupLog.info({ deleted, cutoff }, 'login_attempts sweep deleted stale rows');
      }
      return deleted;
    } catch (err) {
      try {
        db.insert(systemAuditLogs)
          .values(
            buildAuditRow({
              status: 'error',
              startedAt,
              cutoff,
              staleAgeMs,
              err,
            })
          )
          .run();
      } catch (auditErr) {
        cleanupLog.warn(
          { err: auditErr instanceof Error ? { message: auditErr.message } : auditErr },
          'login_attempts cleanup failed before the system audit row could be written'
        );
      }
      throw err;
    }
  }

  function start(): void {
    if (timer) {
      return;
    }
    timer = setInterval(() => {
      try {
        tickOnce();
      } catch (err) {
        cleanupLog.warn(
          { err: err instanceof Error ? { message: err.message } : err },
          'login_attempts cleanup tick failed; will retry next interval'
        );
      }
    }, intervalMs);
    // Unref so the timer does not keep the event loop alive past a
    // graceful server shutdown.
    timer.unref?.();
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { tickOnce, start, stop };
}
