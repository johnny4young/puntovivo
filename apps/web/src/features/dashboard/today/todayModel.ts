import type { TFunction } from 'i18next';
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

/** Mine is what waits on a manager's decision; automatic outbox alerts belong to Operations. */
export function filterPending(
  items: readonly TodayPendingItem[],
  filter: PendingFilter,
  canAct: boolean
): TodayPendingItem[] {
  if (filter === 'cashiers') return items.filter(item => item.origin === 'cashier');
  if (filter === 'mine') return canAct ? items.filter(item => item.kind !== 'attention') : [];
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

/** ISO instant of an hour index in the business day; the inverse of hourIndex. */
export function hourToIso(hour: number, dayStartIso: string): string {
  return new Date(Date.parse(dayStartIso) + hour * 3_600_000).toISOString();
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
      (item.kind === 'approval' && item.requesterId === register.cashierId)
  );
  return match?.rank ?? null;
}

export interface BandLabel {
  x: number;
  text: string;
}

export interface PlacedBandLabel extends BandLabel {
  textX: number;
  anchor: 'start' | 'end';
}

// Uppercase 11px with 0.14em tracking runs close to 8.5px per glyph.
const LABEL_GLYPH_WIDTH = 8.5;
const LABEL_GAP = 12;

/**
 * Anchors each phase label beside its line, flipping it left near the right edge,
 * and drops any label that would overlap an earlier one.
 */
export function placeBandLabels(
  labels: readonly BandLabel[],
  width: number,
  padX: number
): PlacedBandLabel[] {
  const placed: PlacedBandLabel[] = [];
  let previous: { left: number; right: number } | null = null;
  for (const label of [...labels].sort((a, b) => a.x - b.x)) {
    const textWidth = label.text.length * LABEL_GLYPH_WIDTH;
    const anchor = label.x + 6 + textWidth > width - padX ? 'end' : 'start';
    const textX = anchor === 'end' ? label.x - 6 : label.x + 6;
    const left = anchor === 'end' ? textX - textWidth : textX;
    const right = left + textWidth;
    if (previous && left < previous.right + LABEL_GAP && right > previous.left - LABEL_GAP) {
      continue;
    }
    placed.push({ ...label, textX, anchor });
    previous = { left, right };
  }
  return placed;
}

/** «2 h 5 min» or «25 min». */
export function formatDuration(minutes: number, t: TFunction) {
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? t('dashboard:today.registers.durationHours', { hours, minutes: minutes % 60 })
    : t('dashboard:today.registers.durationMinutes', { minutes });
}

/** Whole minutes from one instant to a later one, never negative. */
export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
}

// The full reason (up to 500 characters) stays in the approvals queue.
export const REASON_MAX = 80;

export function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "hace 2 min" from one instant to a later one, "hace un momento" under a minute. */
export function ago(fromIso: string, nowIso: string, t: TFunction) {
  const minutes = minutesBetween(fromIso, nowIso);
  return minutes < 1
    ? t('dashboard:today.pending.agoNow')
    : t('dashboard:today.pending.ago', { duration: formatDuration(minutes, t) });
}
