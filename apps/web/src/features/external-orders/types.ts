import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
/** Server-derived inbox details. No browser state can authorize a sale or cancellation. */
export type ExternalOrderDetail = inferRouterOutputs<AppRouter>['externalOrders']['get'];
/** Read-only connector metadata: no stored secret or ciphertext is part of this projection. */
export type ExternalConnector =
  inferRouterOutputs<AppRouter>['externalOrders']['connectors']['rows'][number];
/** Quote fingerprint freezes the local amounts explicitly reviewed by the operator. */
export type ExternalQuote = inferRouterOutputs<AppRouter>['externalOrders']['quote'];
export const externalStatuses = [
  'received',
  'accepted',
  'cancel_requested',
  'cancelled',
  'rejected',
] as const;
export const externalInputClass =
  'mt-1 w-full rounded border border-line bg-surface-1 p-2 text-secondary-900';
export const externalButtonClass = 'rounded border border-line px-3 py-2 disabled:opacity-50';
