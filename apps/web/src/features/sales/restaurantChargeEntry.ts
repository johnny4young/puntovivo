import type { ResumeDraftSelection } from './useSalesFlows';

/** History state is untrusted; accept only the fields a resume needs. */
export function readRestaurantChargeEntry(state: unknown): ResumeDraftSelection | null {
  if (!state || typeof state !== 'object' || !('restaurantCharge' in state)) return null;
  const entry = state.restaurantCharge;
  if (!entry || typeof entry !== 'object') return null;
  const { id, tableId, label, suspendedAt } = entry as Record<string, unknown>;
  if (typeof id !== 'string' || !id.trim() || typeof tableId !== 'string') return null;
  return {
    id,
    tableId,
    label: typeof label === 'string' ? label : null,
    suspendedAt: typeof suspendedAt === 'string' ? suspendedAt : null,
    resumedDeviceId: null,
  };
}
