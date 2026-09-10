/**
 * Apportion only the new refund against still-refundable tender cents.
 * Recomputing cumulative targets from the original mix can decrease a prior
 * tender's target at a rounding boundary; persisted refunds must never unwind.
 * Integer cumulative boundaries conserve every cent, including the last one.
 */
export function allocateReturnTenderCents(
  refundCents: number,
  remainingCents: readonly number[]
): number[] | null {
  if (
    !Number.isSafeInteger(refundCents) ||
    refundCents < 0 ||
    remainingCents.some(value => !Number.isSafeInteger(value) || value < 0)
  ) {
    return null;
  }
  const remaining = remainingCents.map(value => BigInt(value));
  const total = remaining.reduce((sum, value) => sum + value, 0n);
  const refund = BigInt(refundCents);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || refund > total) return null;
  if (refund === 0n) return remaining.map(() => 0);

  let through = 0n;
  let allocated = 0n;
  return remaining.map(capacity => {
    through += capacity;
    const numerator = refund * through;
    const target = numerator / total + ((numerator % total) * 2n >= total ? 1n : 0n);
    const delta = target - allocated;
    allocated = target;
    return Number(delta);
  });
}
