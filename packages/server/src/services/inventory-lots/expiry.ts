/** Fail-closed lot-expiry evaluation shared by every custody workflow. */

import { ISO_DATE_ONLY_PATTERN, parseStrictIsoInstant } from '../../lib/isoDate.js';

/**
 * A date-only expiry remains valid through that calendar date. Full ISO
 * timestamps expire at their exact instant. Malformed dates and clocks fail
 * closed so historical corruption never makes inventory sellable.
 *
 * Both forms are read with the strict parser. `Date.parse` is not a validator:
 * it rolls an impossible calendar date FORWARD (`2026-02-30` becomes March
 * 2nd), so a corrupt expiry resolves to a finite future instant and the lot
 * stays sellable — the exact opposite of the fail-closed rule this module
 * exists to enforce. The date-only branch used to round-trip defensively while
 * the timestamp branch trusted Date.parse outright; both go through the strict
 * parser now.
 */
export function isLotExpiredAt(expiresAt: string | null, nowIso: string): boolean {
  if (!expiresAt) return false;
  const nowTime = parseStrictIsoInstant(nowIso);
  // A corrupt reference clock must never make dated inventory sellable.
  if (nowTime === null) return true;
  // Historical rows can predate schema validation. Treat any malformed,
  // non-null expiry as non-sellable rather than silently trusting it.
  const expiryTime = parseStrictIsoInstant(expiresAt);
  if (expiryTime === null) return true;
  if (ISO_DATE_ONLY_PATTERN.test(expiresAt)) {
    return expiresAt < new Date(nowTime).toISOString().slice(0, 10);
  }
  return expiryTime <= nowTime;
}
