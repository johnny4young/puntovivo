import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
/** Manager-safe policy projection; private decision reasons are loaded only inside history. */
export type AvailabilityRecord =
  inferRouterOutputs<AppRouter>['workforce']['availability']['list']['items'][number];
/** Stable list boundary, including a tie-breaker for records created at the same instant. */
export type AvailabilityCursor = NonNullable<
  inferRouterOutputs<AppRouter>['workforce']['availability']['list']['nextCursor']
>;
/** Frozen selected version; background queries cannot silently change the target of a decision. */
export type AvailabilityEditor =
  { action: 'create' } | { action: 'replace' | 'void'; row: AvailabilityRecord };
/** One UI window; nextDay explicitly represents overnight work, including Sunday to Monday. */
export interface AvailabilityWindowFields {
  weekday: number;
  start: string;
  end: string;
  nextDay: boolean;
}
/** Raw form values preserve an intentionally open end and require acknowledgement of an empty week. */
export interface AvailabilityFormValues {
  userId: string;
  fromDate: string;
  untilDate: string;
  windows: AvailabilityWindowFields[];
  emptyConfirmed: boolean;
  reason: string;
}
/** Canonical input from the server contract, never imported as a runtime dependency. */
export type AvailabilitySlot =
  inferRouterInputs<AppRouter>['workforce']['availability']['create']['slots'][number];

export function formatAvailabilityMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
/** Render stored half-open day slots without converting them through the browser timezone. */
export function availabilityWindowFields(slots: AvailabilitySlot[]): AvailabilityWindowFields[] {
  return slots.map(slot => ({
    weekday: slot.weekday,
    start: formatAvailabilityMinute(slot.startMinute),
    end: slot.endMinute === 1440 ? '00:00' : formatAvailabilityMinute(slot.endMinute),
    nextDay: slot.endMinute === 1440,
  }));
}
/** Split explicit overnight windows, reject overlaps/duplicates and never normalize invalid input silently. */
export function normalizeAvailabilityWindows(
  windows: AvailabilityWindowFields[]
): AvailabilitySlot[] | null {
  const minute = (value: string) =>
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
      ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
      : null;
  const slots: AvailabilitySlot[] = [];
  for (const row of windows) {
    const start = minute(row.start),
      end = minute(row.end);
    if (
      !Number.isInteger(row.weekday) ||
      row.weekday < 1 ||
      row.weekday > 7 ||
      start === null ||
      end === null ||
      (!row.nextDay && end <= start) ||
      (row.nextDay && end > start)
    )
      return null;
    if (row.nextDay) {
      slots.push({ weekday: row.weekday, startMinute: start, endMinute: 1440 });
      if (end > 0) slots.push({ weekday: (row.weekday % 7) + 1, startMinute: 0, endMinute: end });
    } else slots.push({ weekday: row.weekday, startMinute: start, endMinute: end });
  }
  if (slots.length > 56) return null;
  slots.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
  for (let i = 1; i < slots.length; i++)
    if (
      slots[i]!.weekday === slots[i - 1]!.weekday &&
      slots[i]!.startMinute < slots[i - 1]!.endMinute
    )
      return null;
  return slots;
}
