import type { ShiftSwapRequest } from './shiftSwapTypes';

type DisplayShift = ShiftSwapRequest['offered'];

/** Legacy time zones are rendered defensively instead of crashing the whole workforce surface. */
export function formatSwapShift(
  shift: Pick<DisplayShift, 'startsAt' | 'endsAt' | 'timeZone' | 'siteName'>,
  locale: string
): string {
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: shift.timeZone,
    });
    return `${shift.siteName} · ${formatter.format(Date.parse(shift.startsAt))} – ${formatter.format(
      Date.parse(shift.endsAt)
    )}`;
  } catch {
    return `${shift.siteName} · ${shift.startsAt} – ${shift.endsAt}`;
  }
}
