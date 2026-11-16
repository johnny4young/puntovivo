import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

export type OperationsToday = inferRouterOutputs<AppRouter>['operations']['today'];
export type TodayPendingItem = OperationsToday['pending'][number];
export type TodayRegister = OperationsToday['registers'][number];
export type PendingFilter = 'all' | 'mine' | 'cashiers';

/** Percent change against last week, null when last week sold nothing to compare with. */
export function percentChange(today: number, comparison: number): number | null {
  if (comparison <= 0) return null;
  return Math.round(((today - comparison) / comparison) * 100);
}

/** Viewers read the queue; managers and admins act on every row. */
export function filterPending(
  items: readonly TodayPendingItem[],
  filter: PendingFilter,
  canAct: boolean
): TodayPendingItem[] {
  if (filter === 'cashiers') return items.filter(item => item.origin === 'cashier');
  if (filter === 'mine') return canAct ? [...items] : [];
  return [...items];
}

export interface DayPhases {
  openingHour: number | null;
  peakHour: number | null;
  handoffHour: number | null;
}

/** Hour index in the business day for an ISO instant, given the day's first hour. */
export function hourIndex(iso: string, dayStartIso: string): number {
  return (Date.parse(iso) - Date.parse(dayStartIso)) / 3_600_000;
}

export function dayPhases(today: OperationsToday, dayStartIso: string): DayPhases {
  const firstShift = today.shifts[0];
  const peak = today.hourly.reduce<{ hour: number; value: number } | null>(
    (best, row) =>
      row.today > 0 && (!best || row.today > best.value)
        ? { hour: row.hour, value: row.today }
        : best,
    null
  );
  return {
    openingHour: firstShift ? Math.max(0, hourIndex(firstShift.startsAt, dayStartIso)) : null,
    peakHour: peak?.hour ?? null,
    handoffHour: today.nextHandoff ? hourIndex(today.nextHandoff.at, dayStartIso) : null,
  };
}

/** Register that holds a pending approval, so its card can say which queue item it waits on. */
export function waitingRank(
  register: TodayRegister,
  numbered: ReadonlyArray<{ item: TodayPendingItem; rank: number }>
): number | null {
  const match = numbered.find(
    ({ item }) =>
      (item.kind === 'staleSession' && item.id === register.sessionId) ||
      (item.kind === 'approval' && item.requesterName === register.cashierName)
  );
  return match?.rank ?? null;
}
