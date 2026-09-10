/** Display/edit in the operator's explicitly labelled browser time zone; transport is UTC. */
export function toLocalReservationTime(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
/** Invalid or nonexistent local times (DST spring-forward) must not silently change a booking. */
export function fromLocalReservationTime(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || toLocalReservationTime(date.toISOString()) !== value)
    return null;
  // At the fall-back transition two instants can share the same wall time.
  // Require another explicit time rather than silently choosing the earlier one.
  for (const direction of [-1, 1]) {
    const neighbor = new Date(date.getTime() + direction * 86_400_000);
    const difference = neighbor.getTimezoneOffset() - date.getTimezoneOffset();
    if (
      difference !== 0 &&
      toLocalReservationTime(new Date(date.getTime() + difference * 60_000).toISOString()) === value
    )
      return null;
  }
  return date.toISOString();
}
