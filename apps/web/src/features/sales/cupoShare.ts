/** Share of the cupo, clamped to a meter; no cupo draws nothing. */
export function cupoShare(amount: number, limit: number): number {
  return limit > 0 ? Math.min(100, Math.max(0, (amount / limit) * 100)) : 0;
}
