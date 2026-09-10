import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ShiftSwaps = RouterOutputs['workforce']['shiftSwaps'];

export type ShiftSwapShift = ShiftSwaps['myShifts']['items'][number];
export type ShiftSwapCandidate = ShiftSwaps['candidates']['items'][number];
export type ShiftSwapRequest = ShiftSwaps['mine']['items'][number];
export type ShiftSwapRequestCursor = NonNullable<ShiftSwaps['mine']['nextCursor']>;
export type ShiftSwapShiftCursor = NonNullable<ShiftSwaps['myShifts']['nextCursor']>;
export type ShiftSwapStatus = ShiftSwapRequest['status'];
export type ShiftSwapDecisionStatus = 'accepted' | 'approved' | 'rejected' | 'cancelled';

export interface ShiftSwapDecision {
  status: ShiftSwapDecisionStatus;
  reason?: string;
}
