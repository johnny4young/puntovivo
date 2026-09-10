import { z } from 'zod';
import { workforceDateSchema } from './employment-contract.js';
import { addCalendarDays, resolveUtcDayWindow } from '../reports/day-window.js';

/** Operational classifications only; these do not establish paid leave or legal entitlements. */
export const TIME_OFF_KINDS = ['vacation', 'leave', 'absence'] as const;
/** Approval is explicit; cancellation preserves the prior approval in immutable history. */
export const TIME_OFF_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
/** No clinical details or attachments belong in this bounded operational explanation. */
export const timeOffReasonSchema = z.string().trim().min(10).max(500);

export const timeOffWindowSchema = z
  .object({ fromDate: workforceDateSchema, untilDate: workforceDateSchema })
  .strict()
  .refine(
    value => value.untilDate > value.fromDate,
    'The end date is exclusive and must follow the start'
  )
  .refine(value => {
    const days = (Date.parse(value.untilDate) - Date.parse(value.fromDate)) / 86_400_000;
    return days >= 1 && days <= 366;
  }, 'Use a bounded period of at most 366 calendar days');

/** Frozen interval in real UTC instants; calendar dates are half-open in the captured tenant zone. */
export interface TimeOffWindow {
  fromDate: string;
  untilDate: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
}

/** Reuse the reporting day boundary: LATAM DST may skip midnight but not the whole day. */
export function resolveTimeOffWindow(
  input: z.infer<typeof timeOffWindowSchema>,
  timeZone: string
): TimeOffWindow {
  const dates = timeOffWindowSchema.parse(input);
  const startsAt = resolveUtcDayWindow(dates.fromDate, timeZone).startIso;
  const endsAt = resolveUtcDayWindow(
    addCalendarDays(dates.untilDate, -1),
    timeZone
  ).endExclusiveIso;
  if (endsAt <= startsAt) throw new RangeError('Time off must contain real calendar time');
  return { ...dates, startsAt, endsAt, timeZone };
}

/** Closed transitions; repeat requests must replay through the command envelope, not advance again. */
export function canAdvanceTimeOff(
  current: (typeof TIME_OFF_STATUSES)[number],
  next: Exclude<(typeof TIME_OFF_STATUSES)[number], 'pending'>
): boolean {
  return current === 'pending' || (current === 'approved' && next === 'cancelled');
}
