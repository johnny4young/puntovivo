import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { isEmploymentDate } from './employmentTypes';

/** Frozen plan plus explicitly current, manager-safe names; never used as audit snapshot input. */
export type SchedulePlanView = inferRouterOutputs<AppRouter>['workforce']['schedulePlans']['get'];
/** Bounded headers exclude individual employee intent until an authorized detail is opened. */
export type SchedulePlanHeader =
  inferRouterOutputs<AppRouter>['workforce']['schedulePlans']['list']['items'][number];
/** Stable keyset boundary, including unique-id tie breaker. */
export type SchedulePlanCursor = NonNullable<
  inferRouterOutputs<AppRouter>['workforce']['schedulePlans']['list']['nextCursor']
>;
/** Canonical command input, inferred without importing server runtime into the renderer. */
export type SchedulePlanInput =
  inferRouterInputs<AppRouter>['workforce']['schedulePlans']['create'];
/** Editor-owned fields preserve stable rule ids and blank notes across failed requests. */
export interface SchedulePlanFormValues {
  title: string;
  siteId: string;
  fromDate: string;
  untilDate: string;
  anchorWeekStart: string;
  rules: Array<{
    id: string;
    userId: string;
    weekdays: number[];
    intervalWeeks: number;
    startTime: string;
    endTime: string;
    endDayOffset: 0 | 1;
    notes: string;
  }>;
}
/** An existing version is captured once, not replaced when background queries refresh. */
export type SchedulePlanEditor =
  { action: 'create' } | { action: 'regenerate'; view: SchedulePlanView };
/** Cheap form validation only; authoritative timezone/overlap/admission checks stay on the server. */
export function schedulePlanInput(values: SchedulePlanFormValues): SchedulePlanInput | null {
  if (
    !values.title.trim() ||
    values.title.trim().length > 100 ||
    !values.siteId ||
    ![values.fromDate, values.untilDate, values.anchorWeekStart].every(isEmploymentDate) ||
    values.untilDate <= values.fromDate ||
    (Date.parse(values.untilDate) - Date.parse(values.fromDate)) / 86_400_000 > 31 ||
    new Date(`${values.anchorWeekStart}T12:00:00Z`).getUTCDay() !== 1 ||
    values.anchorWeekStart > values.fromDate ||
    values.rules.length < 1 ||
    values.rules.length > 100 ||
    new Set(values.rules.map(rule => rule.id)).size !== values.rules.length
  )
    return null;
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  for (const rule of values.rules) {
    if (
      !rule.id ||
      !rule.userId ||
      !rule.weekdays.length ||
      rule.weekdays.length > 7 ||
      new Set(rule.weekdays).size !== rule.weekdays.length ||
      rule.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7) ||
      !Number.isInteger(rule.intervalWeeks) ||
      rule.intervalWeeks < 1 ||
      rule.intervalWeeks > 4 ||
      !time.test(rule.startTime) ||
      !time.test(rule.endTime) ||
      (rule.endDayOffset !== 0 && rule.endDayOffset !== 1) ||
      // Overnight duration depends on the frozen zone/DST, not nominal wall-clock subtraction.
      (rule.endDayOffset === 0 && rule.endTime <= rule.startTime) ||
      rule.notes.trim().length > 500
    )
      return null;
  }
  return {
    title: values.title.trim(),
    recurrence: {
      siteId: values.siteId,
      fromDate: values.fromDate,
      untilDate: values.untilDate,
      anchorWeekStart: values.anchorWeekStart,
      rules: values.rules.map(rule => ({
        ...rule,
        weekdays: [...rule.weekdays].sort((a, b) => a - b),
        notes: rule.notes.trim() || null,
      })),
    },
  };
}
