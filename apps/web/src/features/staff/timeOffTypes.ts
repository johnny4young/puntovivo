import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

/** Manager-facing absence projection, without the private explanation stored in history. */
export type TimeOffRecord =
  inferRouterOutputs<AppRouter>['workforce']['timeOff']['list']['items'][number];
/** Stable page boundary preserves ordering when requests share a timestamp. */
export type TimeOffCursor = NonNullable<
  inferRouterOutputs<AppRouter>['workforce']['timeOff']['list']['nextCursor']
>;
/** Captures the exact optimistic version displayed when an explicit decision begins. */
export type TimeOffEditor =
  { action: 'create' } | { action: 'approved' | 'rejected' | 'cancelled'; row: TimeOffRecord };
/** Shared form input; transitions use only reason, never edited identity, dates or state. */
export type TimeOffFormValues = inferRouterInputs<AppRouter>['workforce']['timeOff']['create'];
