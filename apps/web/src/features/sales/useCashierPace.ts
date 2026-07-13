import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { trpc } from '@/lib/trpc';

export type CashierPaceMetrics = NonNullable<
  inferRouterOutputs<AppRouter>['cashSessions']['myPace']
>;

/** Called only inside the preference + active-shift gate. */
export function useCashierPace(siteId: string) {
  const query = trpc.cashSessions.myPace.useQuery(
    { siteId },
    {
      refetchInterval: 60_000,
      staleTime: 30_000,
    }
  );
  return query.data ?? null;
}
