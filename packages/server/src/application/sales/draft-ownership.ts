/**
 * Durable ownership rules for an unsuspended sale draft.
 *
 * `sales.resume` deliberately lets the same actor recover an active claim from
 * another registered terminal, then rebinds it to the requesting device. Every
 * destructive mutation after that recovery must require both dimensions; an
 * actor-only check would let a stale workspace on the old register win the
 * next writer race and charge or release inventory from the wrong terminal.
 */

export interface ActiveDraftClaim {
  suspendedAt: string | null;
  resumedBy: string | null;
  resumedDeviceId: string | null;
}

export function ownsActiveDraftClaim(
  draft: ActiveDraftClaim,
  actorId: string,
  deviceId: string | null | undefined
): boolean {
  return (
    draft.suspendedAt === null &&
    draft.resumedBy === actorId &&
    typeof deviceId === 'string' &&
    deviceId.length > 0 &&
    draft.resumedDeviceId === deviceId
  );
}
