import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { z } from 'zod';
import { workforceDateSchema } from './employment-contract.js';
import { MAX_LIST_DAYS, MAX_SHIFT_DURATION_MS } from './scheduled-shift-policy.js';
import {
  addCalendarDays,
  createScheduleWallTimeResolver,
  type ScheduleWallTimeResolver,
} from './timezone.js';

export const MAX_RECURRENCE_RULES = 100;
export const MAX_RECURRENCE_OCCURRENCES = 1_000;
const DAY_MS = 86_400_000;
const identifier = z.string().trim().min(1).max(100);
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Weekly wall-clock intent; overnight is explicit, never inferred from an earlier end time. */
export const scheduleRecurrenceRuleSchema = z
  .object({
    id: identifier,
    userId: identifier,
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine(days => new Set(days).size === days.length, 'Weekdays must be unique'),
    intervalWeeks: z.number().int().min(1).max(4),
    startTime: localTime,
    endTime: localTime,
    endDayOffset: z.union([z.literal(0), z.literal(1)]),
    notes: z.string().trim().max(500).nullable(),
  })
  .strict()
  .refine(
    rule => rule.endDayOffset === 1 || rule.endTime > rule.startTime,
    'Same-day shifts must end after they start'
  );

/**
 * A bounded batch for one site. [fromDate, untilDate) selects START dates only;
 * the final shift may end the following day. ISO Monday anchors every interval,
 * independently of the tenant's presentation-only first day of the week.
 */
export const scheduleRecurrenceSchema = z
  .object({
    siteId: identifier,
    fromDate: workforceDateSchema,
    untilDate: workforceDateSchema,
    anchorWeekStart: workforceDateSchema,
    rules: z.array(scheduleRecurrenceRuleSchema).min(1).max(MAX_RECURRENCE_RULES),
  })
  .strict()
  .superRefine((input, ctx) => {
    const days = (Date.parse(input.untilDate) - Date.parse(input.fromDate)) / DAY_MS;
    if (!(days >= 1 && days <= MAX_LIST_DAYS)) {
      ctx.addIssue({
        code: 'custom',
        path: ['untilDate'],
        message: `Select at most ${MAX_LIST_DAYS} starting calendar days`,
      });
    }
    if (
      new Date(input.anchorWeekStart).getUTCDay() !== 1 ||
      input.anchorWeekStart > input.fromDate
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['anchorWeekStart'],
        message: 'Anchor the recurrence on an ISO Monday at or before its first date',
      });
    }
    if (new Set(input.rules.map(rule => rule.id)).size !== input.rules.length) {
      ctx.addIssue({ code: 'custom', path: ['rules'], message: 'Rule identifiers must be unique' });
    }
  });

/** Parsed, owned recurrence intent. IDs select employees; they do not establish authorization. */
export type ScheduleRecurrence = z.infer<typeof scheduleRecurrenceSchema>;

/**
 * Frozen occurrence intent, not an operational scheduled shift. The pair
 * (ruleId, startDate) identifies it without relying on array order or random IDs.
 * All temporal endpoints are half-open. Admission must be rechecked at publication.
 */
export interface ScheduleOccurrence {
  ruleId: string;
  userId: string;
  siteId: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  notes: string | null;
}

/** Private typed reasons for the future transport mapper; no database/employee details escape. */
export class ScheduleRecurrenceError extends Error {
  constructor(
    readonly reason: 'empty' | 'limit' | 'window' | 'overlap',
    options?: ErrorOptions
  ) {
    super(`Invalid schedule recurrence: ${reason}`, options);
    this.name = 'ScheduleRecurrenceError';
  }
}

/** Bounded intermediate intent, counted before any expensive timezone conversion. */
interface PendingOccurrence {
  rule: ScheduleRecurrence['rules'][number];
  date: string;
}

function collectOccurrences(input: ScheduleRecurrence): PendingOccurrence[] {
  const pending: PendingOccurrence[] = [];
  for (let date = input.fromDate; date < input.untilDate; date = addCalendarDays(date, 1)) {
    const weekday = new Date(date).getUTCDay() || 7;
    const week = Math.floor((Date.parse(date) - Date.parse(input.anchorWeekStart)) / (7 * DAY_MS));
    for (const rule of input.rules) {
      if (!rule.weekdays.includes(weekday) || week % rule.intervalWeeks !== 0) continue;
      if (pending.length === MAX_RECURRENCE_OCCURRENCES) throw new ScheduleRecurrenceError('limit');
      pending.push({ rule, date });
    }
  }
  if (pending.length === 0) throw new ScheduleRecurrenceError('empty');
  return pending;
}

function compareOccurrences(left: ScheduleOccurrence, right: ScheduleOccurrence): number {
  // Ordinal comparison is independent of the host ICU locale and rule input order.
  for (const key of ['userId', 'startsAt', 'endsAt', 'ruleId'] as const) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }
  return 0;
}

/**
 * No DB reads/writes or reservations occur here. Yields between occurrences keep
 * expansion out of the Electron main-process critical section. Parsed inputs and
 * the conversion cache belong only to this invocation: edits/cancellation in one
 * request cannot contaminate another request or leave a long-lived memory cache.
 */
export async function expandScheduleRecurrence(
  input: ScheduleRecurrence,
  timeZone: string,
  signal?: AbortSignal
): Promise<ScheduleOccurrence[]> {
  signal?.throwIfAborted();
  const parsed = scheduleRecurrenceSchema.parse(input);
  const pending = collectOccurrences(parsed);
  let resolveWallTime: ScheduleWallTimeResolver;
  try {
    resolveWallTime = createScheduleWallTimeResolver(timeZone);
  } catch (cause) {
    throw new ScheduleRecurrenceError('window', { cause });
  }
  const endpoints = new Map<string, string>();
  const resolve = (date: string, time: string) => {
    const key = `${date}T${time}`;
    let result = endpoints.get(key);
    if (result === undefined) {
      result = resolveWallTime(date, time);
      endpoints.set(key, result);
    }
    return result;
  };
  const occurrences: ScheduleOccurrence[] = [];
  for (const { rule, date } of pending) {
    await yieldToEventLoop(undefined, { signal });
    signal?.throwIfAborted();
    let endDate: string, startsAt: string, endsAt: string;
    try {
      endDate = addCalendarDays(date, rule.endDayOffset);
      // Do not synthesize a five-digit end year outside the stored calendar contract.
      workforceDateSchema.parse(endDate);
      startsAt = resolve(date, rule.startTime);
      endsAt = resolve(endDate, rule.endTime);
    } catch (cause) {
      throw new ScheduleRecurrenceError('window', { cause });
    }
    const duration = Date.parse(endsAt) - Date.parse(startsAt);
    if (duration <= 0 || duration > MAX_SHIFT_DURATION_MS) {
      throw new ScheduleRecurrenceError('window');
    }
    occurrences.push({
      ruleId: rule.id,
      userId: rule.userId,
      siteId: parsed.siteId,
      startDate: date,
      startTime: rule.startTime,
      endDate,
      endTime: rule.endTime,
      startsAt,
      endsAt,
      timeZone,
      notes: rule.notes?.trim() || null,
    });
  }
  occurrences.sort(compareOccurrences);
  for (let i = 1; i < occurrences.length; i++) {
    const previous = occurrences[i - 1]!,
      current = occurrences[i]!;
    if (previous.userId === current.userId && previous.endsAt > current.startsAt) {
      throw new ScheduleRecurrenceError('overlap');
    }
  }
  signal?.throwIfAborted();
  return occurrences;
}
