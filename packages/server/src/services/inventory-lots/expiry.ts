/** Fail-closed lot-expiry evaluation shared by every custody workflow. */

/**
 * A date-only expiry remains valid through that calendar date. Full ISO
 * timestamps expire at their exact instant. Malformed dates and clocks fail
 * closed so historical corruption never makes inventory sellable.
 */
export function isLotExpiredAt(expiresAt: string | null, nowIso: string): boolean {
  if (!expiresAt) return false;
  const nowTime = Date.parse(nowIso);
  if (!Number.isFinite(nowTime)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    const expiryDateTime = Date.parse(`${expiresAt}T00:00:00.000Z`);
    const normalizedExpiry = Number.isFinite(expiryDateTime)
      ? new Date(expiryDateTime).toISOString().slice(0, 10)
      : null;
    if (normalizedExpiry !== expiresAt) return true;
    return expiresAt < new Date(nowTime).toISOString().slice(0, 10);
  }
  const expiryTime = Date.parse(expiresAt);
  return !Number.isFinite(expiryTime) || expiryTime <= nowTime;
}
