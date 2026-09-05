/** Inferred kitchen-only contracts keep the board aligned with the server's CAS inputs. */
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
/** Read-side DTOs, including frozen preparation and operational generations. */
export type KitchenOutputs = inferRouterOutputs<AppRouter>['kds'];
/** Tenant/site-scoped query and observed-version mutation contracts. */
export type KitchenInputs = inferRouterInputs<AppRouter>['kds'];
/** One coherent board projection; invalid snapshots remain read-only. */
export type KdsCardData = KitchenOutputs['list']['items'][number];
/** Callbacks carry the exact generation displayed to the cook, not a fresh cache lookup. */
export interface KdsActions {
  onReady: (input: KitchenInputs['markReady']) => void;
  onRecall: (input: KitchenInputs['recall']) => void;
  onResend: (input: KitchenInputs['resend']) => void;
  onLine: (input: KitchenInputs['transitionLine']) => void;
}
