/** Which server worker exits main must never retry (ADR 0034). */

/** How a worker ended, as the crash log records it. */
export type WorkerExitKind = 'oom' | 'uncaught' | 'unknown';

/** Why a worker that died must not be restarted. */
export type WorkerFatalCause = 'corruption' | 'key';

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
