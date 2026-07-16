import { addCalendarDays, calendarDateInTimeZone, zonedWallTimeToIso } from './timezone.js';
import {
  resolveOvertimePolicy,
  type OvertimeCountry,
  type OvertimePolicyProfile,
  type OvertimePremiumCode,
} from './overtime-policy.js';

export interface OvertimeBreakInput {
  startedAt: string;
  endedAt: string | null;
}

export interface OvertimeShiftInput {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string;
  breaks: readonly OvertimeBreakInput[];
}

export interface OvertimePremiumAllocation {
  code: OvertimePremiumCode;
  multiplier: number;
  seconds: number;
}

export interface OvertimeShiftAllocation {
  regularSeconds: number;
  overtimeSeconds: number;
  premiums: OvertimePremiumAllocation[];
  policyIds: string[];
}

export interface CalculateOvertimeInput {
  countryCode: OvertimeCountry;
  timeZone: string;
  firstDayOfWeek: number;
  shifts: readonly OvertimeShiftInput[];
}

interface WorkInterval {
  shiftId: string;
  userId: string;
  startMs: number;
  endMs: number;
}

interface WorkSegment extends WorkInterval {
  localDate: string;
  profile: OvertimePolicyProfile;
  localStartMinute: number;
}

interface Accumulator {
  regularMs: number;
  overtimeMs: number;
  premiums: Map<OvertimePremiumCode, { multiplier: number; milliseconds: number }>;
  policyIds: Set<string>;
}

interface ThresholdState {
  regularMs: number;
  overtimeMs: number;
}

function isoMilliseconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error('Invalid overtime instant');
  return milliseconds;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function workIntervals(shift: OvertimeShiftInput): WorkInterval[] {
  const startMs = isoMilliseconds(shift.startedAt);
  const endMs = isoMilliseconds(shift.endedAt);
  if (endMs <= startMs) return [];

  const breaks = shift.breaks
    .map(item => ({
      startMs: clamp(isoMilliseconds(item.startedAt), startMs, endMs),
      endMs: clamp(isoMilliseconds(item.endedAt ?? shift.endedAt), startMs, endMs),
    }))
    .filter(item => item.endMs > item.startMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const item of breaks) {
    const previous = merged.at(-1);
    if (previous && item.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, item.endMs);
    } else {
      merged.push({ ...item });
    }
  }

  const intervals: WorkInterval[] = [];
  let cursor = startMs;
  for (const item of merged) {
    if (item.startMs > cursor) {
      intervals.push({
        shiftId: shift.id,
        userId: shift.userId,
        startMs: cursor,
        endMs: item.startMs,
      });
    }
    cursor = Math.max(cursor, item.endMs);
  }
  if (cursor < endMs) {
    intervals.push({ shiftId: shift.id, userId: shift.userId, startMs: cursor, endMs });
  }
  return intervals;
}

function localMinuteAt(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-iso8601', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));
  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const raw = parts.find(part => part.type === type)?.value;
    if (!raw) throw new Error(`Unable to resolve ${type} in ${timeZone}`);
    return Number(raw);
  };
  return value('hour') * 60 + value('minute');
}

function weekday(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day)).getUTCDay();
}

function minuteToTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function splitInterval(
  interval: WorkInterval,
  countryCode: OvertimeCountry,
  timeZone: string
): WorkSegment[] {
  const segments: WorkSegment[] = [];
  let cursor = interval.startMs;
  while (cursor < interval.endMs) {
    const localDate = calendarDateInTimeZone(new Date(cursor).toISOString(), timeZone);
    const profile = resolveOvertimePolicy(countryCode, localDate);
    if (!profile) throw new Error(`Missing overtime policy for ${countryCode}`);
    const nextMidnight = isoMilliseconds(
      zonedWallTimeToIso(addCalendarDays(localDate, 1), '00:00', timeZone)
    );
    const dayEnd = Math.min(interval.endMs, nextMidnight);
    const boundaries = new Set<number>();
    if (countryCode === 'CO') {
      if (profile.dayStartMinute !== null) boundaries.add(profile.dayStartMinute);
      if (profile.nightStartMinute !== null) boundaries.add(profile.nightStartMinute);
    }
    if (countryCode === 'AR' && weekday(localDate) === 6) boundaries.add(13 * 60);

    const instants = [...boundaries]
      .map(minute => isoMilliseconds(zonedWallTimeToIso(localDate, minuteToTime(minute), timeZone)))
      .filter(instant => instant > cursor && instant < dayEnd)
      .sort((left, right) => left - right);
    for (const endMs of [...instants, dayEnd]) {
      segments.push({
        ...interval,
        startMs: cursor,
        endMs,
        localDate,
        profile,
        localStartMinute: localMinuteAt(cursor, timeZone),
      });
      cursor = endMs;
    }
  }
  return segments;
}

export function laborWeekStartDate(localDate: string, firstDayOfWeek: number): string {
  const offset = (weekday(localDate) - firstDayOfWeek + 7) % 7;
  return addCalendarDays(localDate, -offset);
}

function accumulatorFor(accumulators: Map<string, Accumulator>, shiftId: string): Accumulator {
  let accumulator = accumulators.get(shiftId);
  if (!accumulator) {
    accumulator = {
      regularMs: 0,
      overtimeMs: 0,
      premiums: new Map(),
      policyIds: new Set(),
    };
    accumulators.set(shiftId, accumulator);
  }
  return accumulator;
}

function addPremium(
  accumulator: Accumulator,
  code: OvertimePremiumCode,
  multiplier: number,
  milliseconds: number
): void {
  const current = accumulator.premiums.get(code);
  accumulator.premiums.set(code, {
    multiplier,
    milliseconds: (current?.milliseconds ?? 0) + milliseconds,
  });
}

function addTieredPremium(
  accumulator: Accumulator,
  milliseconds: number,
  usedMilliseconds: number,
  tierMilliseconds: number,
  first: readonly [OvertimePremiumCode, number],
  later: readonly [OvertimePremiumCode, number]
): void {
  const firstMilliseconds = Math.min(
    milliseconds,
    Math.max(0, tierMilliseconds - usedMilliseconds)
  );
  if (firstMilliseconds > 0) addPremium(accumulator, first[0], first[1], firstMilliseconds);
  const laterMilliseconds = milliseconds - firstMilliseconds;
  if (laterMilliseconds > 0) addPremium(accumulator, later[0], later[1], laterMilliseconds);
}

function classifyPremium(
  segment: WorkSegment,
  overtimeMs: number,
  accumulator: Accumulator,
  weeklyState: ThresholdState,
  dailyState: ThresholdState,
  countryCode: OvertimeCountry
): void {
  if (countryCode === 'CO') {
    const night =
      segment.profile.dayStartMinute !== null &&
      segment.profile.nightStartMinute !== null &&
      (segment.localStartMinute < segment.profile.dayStartMinute ||
        segment.localStartMinute >= segment.profile.nightStartMinute);
    addPremium(
      accumulator,
      night ? 'co_night_overtime' : 'co_day_overtime',
      night ? 1.75 : 1.25,
      overtimeMs
    );
  } else if (countryCode === 'MX') {
    addTieredPremium(
      accumulator,
      overtimeMs,
      weeklyState.overtimeMs,
      9 * 60 * 60 * 1_000,
      ['mx_double_overtime', 2],
      ['mx_triple_overtime', 3]
    );
  } else if (countryCode === 'CL') {
    addPremium(accumulator, 'cl_overtime', 1.5, overtimeMs);
  } else if (countryCode === 'PE') {
    addTieredPremium(
      accumulator,
      overtimeMs,
      dailyState.overtimeMs,
      2 * 60 * 60 * 1_000,
      ['pe_first_two_overtime', 1.25],
      ['pe_additional_overtime', 1.35]
    );
  } else {
    const restDay =
      weekday(segment.localDate) === 0 ||
      (weekday(segment.localDate) === 6 && segment.localStartMinute >= 13 * 60);
    addPremium(
      accumulator,
      restDay ? 'ar_rest_day_overtime' : 'ar_ordinary_overtime',
      restDay ? 2 : 1.5,
      overtimeMs
    );
  }
}

/**
 * Classify net worked time without mutating attendance evidence.
 *
 * Daily overtime does not consume the weekly regular allowance, which avoids
 * counting the same seconds again when the weekly threshold is later reached.
 */
export function calculateOvertime(
  input: CalculateOvertimeInput
): Map<string, OvertimeShiftAllocation> {
  const accumulators = new Map<string, Accumulator>();
  const weeklyStates = new Map<string, ThresholdState>();
  const dailyStates = new Map<string, ThresholdState>();
  const segments = input.shifts
    .flatMap(shift => workIntervals(shift))
    .flatMap(interval => splitInterval(interval, input.countryCode, input.timeZone))
    .sort(
      (left, right) => left.startMs - right.startMs || left.shiftId.localeCompare(right.shiftId)
    );

  for (const shift of input.shifts) accumulatorFor(accumulators, shift.id);
  for (const segment of segments) {
    const accumulator = accumulatorFor(accumulators, segment.shiftId);
    accumulator.policyIds.add(segment.profile.id);
    const weekKey = `${segment.userId}:${laborWeekStartDate(segment.localDate, input.firstDayOfWeek)}`;
    const dayKey = `${segment.userId}:${segment.localDate}`;
    const weeklyState = weeklyStates.get(weekKey) ?? { regularMs: 0, overtimeMs: 0 };
    const dailyState = dailyStates.get(dayKey) ?? { regularMs: 0, overtimeMs: 0 };
    weeklyStates.set(weekKey, weeklyState);
    dailyStates.set(dayKey, dailyState);

    const durationMs = segment.endMs - segment.startMs;
    const weeklyRemaining = Math.max(
      0,
      segment.profile.weeklyRegularSeconds * 1_000 - weeklyState.regularMs
    );
    const dailyRemaining =
      segment.profile.dailyRegularSeconds === null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, segment.profile.dailyRegularSeconds * 1_000 - dailyState.regularMs);
    const regularMs = Math.min(durationMs, weeklyRemaining, dailyRemaining);
    const overtimeMs = durationMs - regularMs;

    accumulator.regularMs += regularMs;
    accumulator.overtimeMs += overtimeMs;
    weeklyState.regularMs += regularMs;
    dailyState.regularMs += regularMs;
    if (overtimeMs > 0) {
      classifyPremium(segment, overtimeMs, accumulator, weeklyState, dailyState, input.countryCode);
      weeklyState.overtimeMs += overtimeMs;
      dailyState.overtimeMs += overtimeMs;
    }
  }

  return new Map(
    [...accumulators].map(([shiftId, value]) => [
      shiftId,
      {
        regularSeconds: Math.floor(value.regularMs / 1_000),
        overtimeSeconds: Math.floor(value.overtimeMs / 1_000),
        premiums: [...value.premiums].map(([code, premium]) => ({
          code,
          multiplier: premium.multiplier,
          seconds: Math.floor(premium.milliseconds / 1_000),
        })),
        policyIds: [...value.policyIds],
      },
    ])
  );
}
