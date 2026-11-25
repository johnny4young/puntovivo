import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { hourIndex, type OperationsToday } from '@/features/dashboard/today/todayModel';

export type MorningRecap = inferRouterOutputs<AppRouter>['operations']['morningRecap'];
export type MorningRegister = MorningRecap['registersToOpen'][number];

/** Nothing sold, open or waiting to be received yet today. */
export function isBeforeOpening(today: OperationsToday): boolean {
  return (
    today.sales.orders === 0 &&
    today.sales.total === 0 &&
    today.registers.length === 0 &&
    today.awaitingHandoffs.length === 0
  );
}

export type Greeting = 'morning' | 'afternoon' | 'evening';

export function greetingAt(today: Pick<OperationsToday, 'generatedAt' | 'dayStartIso'>): Greeting {
  const hour = hourIndex(today.generatedAt, today.dayStartIso);
  if (hour < 12) return 'morning';
  return hour < 19 ? 'afternoon' : 'evening';
}

/** The busiest hours, at least two hours apart, in time order. */
export function curvePeaks(
  rows: ReadonlyArray<{ hour: number; value: number }>,
  count = 2
): number[] {
  const picked: number[] = [];
  const ranked = rows
    .filter(row => row.value > 0)
    .sort((a, b) => b.value - a.value || a.hour - b.hour);
  for (const row of ranked) {
    if (picked.length === count) break;
    if (picked.every(hour => Math.abs(hour - row.hour) >= 2)) picked.push(row.hour);
  }
  return picked.sort((a, b) => a - b);
}

export interface Opening {
  at: string;
  minutes: number;
}

/** Today's first scheduled shift, the closest thing to an opening time, while it is still ahead. */
export function openingIn(
  today: Pick<OperationsToday, 'shifts' | 'dayStartIso' | 'generatedAt'>
): Opening | null {
  const first = today.shifts.find(shift => shift.startsAt >= today.dayStartIso);
  if (!first) return null;
  const minutes = Math.ceil((Date.parse(first.startsAt) - Date.parse(today.generatedAt)) / 60_000);
  return minutes > 0 ? { at: first.startsAt, minutes } : null;
}

export interface FloatSummary {
  kind: 'each' | 'single' | 'total';
  amount: number;
}

/** "200.000 cada una" when every drawer starts the same, otherwise their sum. */
export function floatSummary(registers: readonly MorningRegister[]): FloatSummary | null {
  const floats = registers.map(register => register.openingFloat);
  const sum = floats.reduce((total, value) => total + value, 0);
  if (sum <= 0) return null;
  if (floats.length === 1) return { kind: 'single', amount: sum };
  return floats.every(value => value === floats[0])
    ? { kind: 'each', amount: floats[0]! }
    : { kind: 'total', amount: sum };
}

export function groupBySite(registers: readonly MorningRegister[]): MorningRegister[][] {
  const bySite = new Map<string, MorningRegister[]>();
  for (const register of registers) {
    const group = bySite.get(register.siteId);
    if (group) group.push(register);
    else bySite.set(register.siteId, [register]);
  }
  return [...bySite.values()];
}
