/** Explicit employee-global weekly availability; never inferred from attendance or contracts. */
import { z } from 'zod';
import { workforceDateSchema } from './employment-contract.js';
import { resolveUtcDayWindow } from '../reports/day-window.js';

export const availabilitySlotSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine(slot => slot.endMinute > slot.startMinute, 'Split overnight windows at midnight');

/** ISO weekday (Monday=1); half-open local minutes. Adjacent windows may join, overlapping ones may not. */
export type AvailabilitySlot = z.infer<typeof availabilitySlotSchema>;
export const availabilitySlotsSchema = z
  .array(availabilitySlotSchema)
  .max(56)
  .superRefine((slots, ctx) => {
    const ordered = [...slots].sort(
      (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute
    );
    for (let i = 1; i < ordered.length; i++) {
      const previous = ordered[i - 1]!,
        current = ordered[i]!;
      if (previous.weekday === current.weekday && previous.endMinute > current.startMinute)
        ctx.addIssue({ code: 'custom', message: 'Weekly availability windows must not overlap' });
    }
  });
export const availabilityPeriodSchema = z
  .object({
    fromDate: workforceDateSchema,
    untilDate: workforceDateSchema.nullable(),
  })
  .strict()
  .refine(
    period => period.untilDate === null || period.untilDate > period.fromDate,
    'End date must follow start date'
  );

/** Frozen real period; null end is intentional open-ended recurrence, not missing data. */
export interface AvailabilityWindow {
  fromDate: string;
  untilDate: string | null;
  startsAt: string;
  endsAt: string | null;
  timeZone: string;
}
/** Validated positive availability. An empty slot set explicitly blocks all time in its period. */
export interface AvailabilityPolicy extends AvailabilityWindow {
  slots: AvailabilitySlot[];
}

export function resolveAvailabilityWindow(
  period: z.infer<typeof availabilityPeriodSchema>,
  timeZone: string
): AvailabilityWindow {
  availabilityPeriodSchema.parse(period);
  const startsAt = resolveUtcDayWindow(period.fromDate, timeZone).startIso;
  const endsAt =
    period.untilDate === null ? null : resolveUtcDayWindow(period.untilDate, timeZone).startIso;
  if (endsAt !== null && endsAt <= startsAt) throw new RangeError('Empty availability period');
  return { ...period, startsAt, endsAt, timeZone };
}

/**
 * Compile once per decision, then inspect real UTC minutes, not nominal wall-time duration.
 * Both occurrences of a repeated DST minute obey the same rule; nonexistent minutes are
 * never synthesized. Minute sampling is exact because slot boundaries are local minutes.
 * Every shift is bounded to 24 real hours. Historical odd-second timezone offsets fail
 * closed instead of pretending minute sampling is exact for them.
 */
export function compileAvailability(
  policy: AvailabilityPolicy
): (startsAt: string, endsAt: string) => boolean {
  const slots = availabilitySlotsSchema.parse(policy.slots);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: policy.timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const effectiveStart = Date.parse(policy.startsAt),
    effectiveEnd = policy.endsAt === null ? Infinity : Date.parse(policy.endsAt);
  if (!Number.isFinite(effectiveStart) || !(effectiveEnd > effectiveStart))
    throw new RangeError('Invalid availability instants');
  return (startsAt, endsAt) => {
    const shiftStart = Date.parse(startsAt),
      shiftEnd = Date.parse(endsAt);
    if (
      !Number.isFinite(shiftStart) ||
      !Number.isFinite(shiftEnd) ||
      shiftEnd <= shiftStart ||
      shiftEnd - shiftStart > 86_400_000
    )
      return false;
    const start = Math.max(effectiveStart, shiftStart),
      end = Math.min(effectiveEnd, shiftEnd);
    for (
      let instant = start;
      instant < end;
      instant = (Math.floor(instant / 60_000) + 1) * 60_000
    ) {
      const date = new Date(instant);
      const parts = formatter.formatToParts(date);
      const part = (key: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === key)?.value;
      const weekday = weekdays.indexOf(part('weekday') ?? '') + 1,
        minute = Number(part('hour')) * 60 + Number(part('minute'));
      if (Number(part('second')) !== date.getUTCSeconds()) return false;
      if (
        !slots.some(
          slot => slot.weekday === weekday && slot.startMinute <= minute && slot.endMinute > minute
        )
      )
        return false;
    }
    return true;
  };
}
