/**
 * optimistic-concurrency guard for user-edited catalogs.
 *
 * Each versioned catalog row (`products`, `customers`, `providers`,
 * `categories`, `tenant_locale_settings`) carries a monotonically increasing
 * `version` column. Every `*.update` mutation runs an UPDATE that pins the
 * client-supplied version in its WHERE clause (`... AND version = ?`) and
 * sets `version = suppliedVersion + 1`. If another tab or operator already
 * saved an edit, the stored version no longer matches, the WHERE selects zero
 * rows, and the incoming write is rejected with `STALE_VERSION` instead of
 * silently clobbering the other change. The renderer then reloads the row
 * (now carrying the bumped version) before letting the operator retry.
 *
 * This is the *live-edit* layer guard (two browser tabs against the same
 * authoritative embedded DB) and is intentionally distinct from the
 * *sync-layer* auto-LWW reconciliation policy in
 * `docs/architecture/0004-conflict-policy.md` (), which handles
 * offline cross-device merges with an audit trail.
 *
 * Invariants:
 * - The matching UPDATE MUST pin `version = suppliedVersion` in its WHERE and
 * set `version = suppliedVersion + 1`. A single better-sqlite3 UPDATE
 * statement is atomic, so no surrounding read is required and there is no
 * TOCTOU window — `changes === 0` unambiguously means the stored version
 * diverged (or the row was concurrently deleted), both of which the
 * operator resolves the same way: reload and retry.
 * - Callers must already have established row existence + tenant scope
 * (NOT_FOUND / `ensureTenant*`) before this guard runs, so a zero-change
 * result is attributed to a stale version rather than a missing row.
 */
import { throwServerError } from './errorCodes.js';

/**
 * Throws `STALE_VERSION` when an optimistic-versioned UPDATE matched no rows.
 * No-op when at least one row changed.
 *
 * @param entity   stable catalog identifier for the error `details` (e.g.
 * `'product'`, `'customer'`) so the renderer / logs can
 * attribute the conflict without leaking row data.
 * @param changes  the `changes` count returned by the better-sqlite3 UPDATE.
 * @param suppliedVersion the `version` the client round-tripped in the input.
 */
export function assertVersionedWriteApplied(
  entity: string,
  changes: number,
  suppliedVersion: number
): void {
  if (changes === 0) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'STALE_VERSION',
      message: `Stale ${entity} version: no row matched version ${suppliedVersion}`,
      details: { entity, suppliedVersion },
    });
  }
}
