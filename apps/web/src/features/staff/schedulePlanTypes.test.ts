import { describe, expect, it } from 'vitest';
import { schedulePlanInput, type SchedulePlanFormValues } from './schedulePlanTypes';
const valid = (): SchedulePlanFormValues => ({
  title: '  Coverage  ',
  siteId: 'site',
  fromDate: '2026-09-07',
  untilDate: '2026-10-08',
  anchorWeekStart: '2026-09-07',
  rules: [
    {
      id: 'rule',
      userId: 'worker',
      weekdays: [3, 1],
      intervalWeeks: 2,
      startTime: '22:00',
      endTime: '06:00',
      endDayOffset: 1,
      notes: '  ',
    },
  ],
});
describe('recurring schedule form intent', () => {
  it('accepts 31 starting dates and explicit overnight work without rewriting its cadence', () => {
    const value = valid(),
      result = schedulePlanInput(value);
    expect(result?.title).toBe('Coverage');
    expect(result?.recurrence.rules[0]).toEqual({
      ...value.rules[0],
      weekdays: [1, 3],
      notes: null,
    });
    expect(value.rules[0]!.weekdays).toEqual([3, 1]);
  });
  it.each([
    { title: '' },
    { siteId: '' },
    { untilDate: '2026-10-09' },
    { untilDate: '2026-09-07' },
    { fromDate: '2026-02-30' },
    { anchorWeekStart: '2026-09-08' },
    { anchorWeekStart: '2026-09-14' },
    { rules: [] },
  ])('rejects invalid draft fields %j', patch => {
    expect(schedulePlanInput({ ...valid(), ...patch })).toBeNull();
  });
  it.each([
    { userId: '' },
    { weekdays: [] },
    { weekdays: [1, 1] },
    { weekdays: [8] },
    { intervalWeeks: 0 },
    { intervalWeeks: 5 },
    { intervalWeeks: 1.5 },
    { startTime: '24:00' },
    { endTime: '7:00' },
    { endDayOffset: 0 as const },
    { notes: 'x'.repeat(501) },
  ])('rejects invalid rule fields %j', patch => {
    const value = valid();
    value.rules[0] = { ...value.rules[0]!, ...patch };
    expect(schedulePlanInput(value)).toBeNull();
  });
  it('leaves real overnight duration to the server instead of rejecting a valid DST-shortened shift', () => {
    const value = valid();
    value.fromDate = '2026-03-07';
    value.untilDate = '2026-03-08';
    value.anchorWeekStart = '2026-03-02';
    value.rules[0] = {
      ...value.rules[0]!,
      weekdays: [6],
      intervalWeeks: 1,
      startTime: '08:00',
      endTime: '08:30',
      endDayOffset: 1,
    };
    // 24.5 nominal hours are 23.5 real hours across New York's spring transition.
    expect(schedulePlanInput(value)?.recurrence.rules[0]).toMatchObject({
      startTime: '08:00',
      endTime: '08:30',
      endDayOffset: 1,
    });
  });
  it('rejects repeated rule identity and over-capacity rules without truncation', () => {
    const value = valid();
    value.rules.push({ ...value.rules[0]! });
    expect(schedulePlanInput(value)).toBeNull();
    value.rules = Array.from({ length: 101 }, (_, index) => ({
      ...value.rules[0]!,
      id: String(index),
    }));
    expect(schedulePlanInput(value)).toBeNull();
  });
});
