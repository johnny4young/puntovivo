import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  expandScheduleRecurrence,
  MAX_RECURRENCE_OCCURRENCES,
  scheduleRecurrenceSchema,
  type ScheduleRecurrence,
} from './schedule-recurrence.js';
import { calendarDateInTimeZone } from './timezone.js';

const rule = (
  overrides: Partial<ScheduleRecurrence['rules'][number]> = {}
): ScheduleRecurrence['rules'][number] => ({
  id: 'rule-a',
  userId: 'employee-a',
  weekdays: [1, 3, 5],
  intervalWeeks: 1,
  startTime: '08:00',
  endTime: '16:00',
  endDayOffset: 0,
  notes: null,
  ...overrides,
});
const intent = (overrides: Partial<ScheduleRecurrence> = {}): ScheduleRecurrence => ({
  siteId: 'site-a',
  fromDate: '2026-09-07',
  untilDate: '2026-09-21',
  anchorWeekStart: '2026-09-07',
  rules: [rule()],
  ...overrides,
});
const daily = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    rule({ id: `rule-${i}`, userId: `employee-${i}`, weekdays: [1, 2, 3, 4, 5, 6, 7] })
  );

describe('bounded recurring schedule intent', () => {
  it('freezes local and real endpoints without creating operational IDs or authorizations', async () => {
    const result = await expandScheduleRecurrence(intent(), 'America/Bogota');
    expect(result.map(row => row.startDate)).toEqual([
      '2026-09-07',
      '2026-09-09',
      '2026-09-11',
      '2026-09-14',
      '2026-09-16',
      '2026-09-18',
    ]);
    expect(result[0]).toEqual({
      ruleId: 'rule-a',
      userId: 'employee-a',
      siteId: 'site-a',
      startDate: '2026-09-07',
      startTime: '08:00',
      endDate: '2026-09-07',
      endTime: '16:00',
      startsAt: '2026-09-07T13:00:00.000Z',
      endsAt: '2026-09-07T21:00:00.000Z',
      timeZone: 'America/Bogota',
      notes: null,
    });
  });

  it('uses an explicit ISO week anchor when the visible range starts midweek', async () => {
    const result = await expandScheduleRecurrence(
      intent({
        fromDate: '2026-09-09',
        untilDate: '2026-10-01',
        rules: [rule({ weekdays: [1, 3], intervalWeeks: 2 })],
      }),
      'UTC'
    );
    expect(result.map(row => row.startDate)).toEqual(['2026-09-09', '2026-09-21', '2026-09-23']);
  });

  it('retains the fourth-week cadence across a calendar year boundary', async () => {
    const result = await expandScheduleRecurrence(
      intent({
        fromDate: '2026-12-28',
        untilDate: '2027-01-28',
        anchorWeekStart: '2026-12-28',
        rules: [rule({ weekdays: [1], intervalWeeks: 4 })],
      }),
      'America/Bogota'
    );
    expect(result.map(row => row.startDate)).toEqual(['2026-12-28', '2027-01-25']);
  });

  it('allows the final overnight shift to end outside the start-date selection', async () => {
    const result = await expandScheduleRecurrence(
      intent({
        fromDate: '2026-09-13',
        untilDate: '2026-09-14',
        rules: [rule({ weekdays: [7], startTime: '22:00', endTime: '02:00', endDayOffset: 1 })],
      }),
      'America/Bogota'
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startDate: '2026-09-13',
      endDate: '2026-09-14',
      startsAt: '2026-09-14T03:00:00.000Z',
      endsAt: '2026-09-14T07:00:00.000Z',
    });
  });

  it('crosses leap day using calendar arithmetic', async () => {
    const result = await expandScheduleRecurrence(
      intent({
        fromDate: '2028-02-28',
        untilDate: '2028-03-02',
        anchorWeekStart: '2028-02-28',
        rules: daily(1),
      }),
      'UTC'
    );
    expect(result.map(row => row.startDate)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('normalizes only owned text and keeps the caller input untouched', async () => {
    const input = intent({ rules: [rule({ notes: '  Opening shift  ' })] });
    const before = structuredClone(input);
    expect((await expandScheduleRecurrence(input, 'UTC'))[0]?.notes).toBe('Opening shift');
    expect(input).toEqual(before);
    expect(
      (await expandScheduleRecurrence(intent({ rules: [rule({ notes: '   ' })] }), 'UTC'))[0]?.notes
    ).toBeNull();
  });

  it('does not allow edits during an asynchronous expansion to change the frozen intent', async () => {
    const input = intent();
    const pending = expandScheduleRecurrence(input, 'UTC');
    input.rules[0]!.userId = 'changed-user';
    input.rules[0]!.startTime = '12:00';
    input.rules[0]!.weekdays.length = 0;
    input.siteId = 'changed-site';
    const result = await pending;
    expect(result).toHaveLength(6);
    expect(
      result.every(
        row => row.userId === 'employee-a' && row.startTime === '08:00' && row.siteId === 'site-a'
      )
    ).toBe(true);
  });

  it('produces a deterministic order regardless of rule and weekday input order', async () => {
    const rules = [rule(), rule({ id: 'rule-b', userId: 'employee-b', weekdays: [7, 2] })];
    const first = await expandScheduleRecurrence(intent({ rules }), 'UTC');
    const second = await expandScheduleRecurrence(
      intent({
        rules: [...rules]
          .reverse()
          .map(item => ({ ...item, weekdays: [...item.weekdays].reverse() })),
      }),
      'UTC'
    );
    expect(second).toEqual(first);
    expect(new Set(first.map(row => JSON.stringify([row.ruleId, row.startDate]))).size).toBe(
      first.length
    );
  });

  it.each([
    { fromDate: '2026-02-30' },
    { fromDate: '0000-09-07' },
    { untilDate: '2026-09-07' },
    { untilDate: '2026-09-06' },
    { untilDate: '2026-10-09' },
    { anchorWeekStart: '2026-09-08' },
    { anchorWeekStart: '2026-09-14' },
    { siteId: '' },
    { siteId: 'a'.repeat(101) },
    { rules: [] },
    { rules: daily(101) },
    { rules: [rule(), rule()] },
    { rules: [rule({ weekdays: [1, 1] })] },
    { rules: [rule({ weekdays: [0] })] },
    { rules: [rule({ weekdays: [8] })] },
    { rules: [rule({ weekdays: [] })] },
    { rules: [rule({ intervalWeeks: 0 })] },
    { rules: [rule({ intervalWeeks: 5 })] },
    { rules: [rule({ intervalWeeks: 1.5 })] },
    { rules: [rule({ startTime: '24:00' })] },
    { rules: [rule({ endTime: '08:00' })] },
    { rules: [rule({ endTime: '07:00' })] },
    { rules: [rule({ notes: 'a'.repeat(501) })] },
  ])('rejects invalid intent before expansion (%j)', async patch => {
    const input = intent(patch);
    expect(scheduleRecurrenceSchema.safeParse(input).success).toBe(false);
    await expect(expandScheduleRecurrence(input, 'UTC')).rejects.toThrow();
  });

  it('rejects extra properties instead of accepting caller-supplied publication state', () => {
    expect(scheduleRecurrenceSchema.safeParse({ ...intent(), status: 'published' }).success).toBe(
      false
    );
    expect(
      scheduleRecurrenceSchema.safeParse(
        intent({
          rules: [{ ...rule(), authorized: true } as ScheduleRecurrence['rules'][number]],
        })
      ).success
    ).toBe(false);
  });

  it('rejects empty selections and over-capacity expansions, never silently truncating', async () => {
    await expect(
      expandScheduleRecurrence(
        intent({ untilDate: '2026-09-08', rules: [rule({ weekdays: [2] })] }),
        'UTC'
      )
    ).rejects.toMatchObject({ reason: 'empty' });
    await expect(
      expandScheduleRecurrence(intent({ untilDate: '2026-10-02', rules: daily(41) }), 'UTC')
    ).rejects.toMatchObject({ reason: 'limit' });
  });

  it('allocates one Intl formatter per expansion rather than one per candidate minute', async () => {
    const OriginalFormatter = Intl.DateTimeFormat;
    // Native Intl constructors require a real returned instance, not a spy's receiver.
    const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
      ...args: Parameters<typeof Intl.DateTimeFormat>
    ) {
      return new OriginalFormatter(...args);
    });
    try {
      await expandScheduleRecurrence(intent({ rules: daily(20) }), 'America/New_York');
      expect(formatter).toHaveBeenCalledTimes(1);
    } finally {
      formatter.mockRestore();
    }
  });

  it('accepts exactly the occurrence ceiling and yields before resolving the batch', async () => {
    let resolved = false;
    const pending = expandScheduleRecurrence(
      intent({ untilDate: '2026-10-02', rules: daily(40) }),
      'UTC'
    ).then(result => {
      resolved = true;
      return result;
    });
    await yieldToEventLoop();
    expect(resolved).toBe(false);
    const result = await pending;
    expect(result).toHaveLength(MAX_RECURRENCE_OCCURRENCES);
    expect(new Set(result.map(row => JSON.stringify([row.ruleId, row.startDate]))).size).toBe(
      1_000
    );
  });
});

describe('recurrence temporal admission', () => {
  const onDay = (
    date: string,
    monday: string,
    overrides: Partial<ScheduleRecurrence['rules'][number]> = {}
  ) =>
    intent({
      fromDate: date,
      untilDate: new Date(Date.parse(date) + 86_400_000).toISOString().slice(0, 10),
      anchorWeekStart: monday,
      rules: [rule({ weekdays: [1, 2, 3, 4, 5, 6, 7], ...overrides })],
    });

  it('keeps weekly wall time across spring DST instead of adding 168 UTC hours', async () => {
    const result = await expandScheduleRecurrence(
      intent({
        fromDate: '2026-03-01',
        untilDate: '2026-03-16',
        anchorWeekStart: '2026-02-23',
        rules: [rule({ weekdays: [7] })],
      }),
      'America/New_York'
    );
    expect(result.map(row => row.startsAt)).toEqual([
      '2026-03-01T13:00:00.000Z',
      '2026-03-08T12:00:00.000Z',
      '2026-03-15T12:00:00.000Z',
    ]);
  });

  it.each([
    ['2026-03-08', '2026-03-02', 'America/New_York', '02:30', '04:00'],
    ['2026-03-08', '2026-03-02', 'America/New_York', '01:30', '02:30'],
    ['2026-09-06', '2026-08-31', 'America/Santiago', '00:30', '04:00'],
  ])(
    'rejects nonexistent local endpoints without moving the shift (%s, %s, %s)',
    async (date, monday, zone, startTime, endTime) => {
      await expect(
        expandScheduleRecurrence(onDay(date, monday, { startTime, endTime }), zone)
      ).rejects.toMatchObject({ reason: 'window' });
    }
  );

  it('uses the earliest repeated minute, matching existing manual shift semantics', async () => {
    const [row] = await expandScheduleRecurrence(
      onDay('2026-11-01', '2026-10-26', {
        startTime: '01:30',
        endTime: '02:30',
      }),
      'America/New_York'
    );
    expect(row).toMatchObject({
      startsAt: '2026-11-01T05:30:00.000Z',
      endsAt: '2026-11-01T07:30:00.000Z',
    });
  });

  it('supports half-hour DST and fractional-hour tenant zones', async () => {
    expect(
      (
        await expandScheduleRecurrence(
          onDay('2026-04-05', '2026-03-30', {
            startTime: '01:45',
            endTime: '02:15',
          }),
          'Australia/Lord_Howe'
        )
      )[0]
    ).toMatchObject({
      startsAt: '2026-04-04T14:45:00.000Z',
      endsAt: '2026-04-04T15:45:00.000Z',
    });
    expect((await expandScheduleRecurrence(intent(), 'Asia/Kathmandu'))[0]?.startsAt).toBe(
      '2026-09-07T02:15:00.000Z'
    );
  });

  it('enforces at most 24 real hours, not nominal wall-clock hours', async () => {
    await expect(
      expandScheduleRecurrence(
        onDay('2026-11-01', '2026-10-26', {
          startTime: '00:00',
          endTime: '00:00',
          endDayOffset: 1,
        }),
        'America/New_York'
      )
    ).rejects.toMatchObject({ reason: 'window' });
    const [spring] = await expandScheduleRecurrence(
      onDay('2026-03-08', '2026-03-02', {
        startTime: '00:00',
        endTime: '00:00',
        endDayOffset: 1,
      }),
      'America/New_York'
    );
    expect(Date.parse(spring!.endsAt) - Date.parse(spring!.startsAt)).toBe(23 * 3_600_000);
    const [ordinary] = await expandScheduleRecurrence(
      onDay('2026-09-07', '2026-09-07', {
        startTime: '00:00',
        endTime: '00:00',
        endDayOffset: 1,
      }),
      'UTC'
    );
    expect(Date.parse(ordinary!.endsAt) - Date.parse(ordinary!.startsAt)).toBe(24 * 3_600_000);
    await expect(
      expandScheduleRecurrence(
        onDay('2026-09-07', '2026-09-07', {
          startTime: '08:00',
          endTime: '09:00',
          endDayOffset: 1,
        }),
        'UTC'
      )
    ).rejects.toMatchObject({ reason: 'window' });
  });

  it('rejects unknown zones and does not return a partial batch after a later DST gap', async () => {
    await expect(expandScheduleRecurrence(intent(), 'Unknown/Nowhere')).rejects.toMatchObject({
      reason: 'window',
    });
    await expect(
      expandScheduleRecurrence(
        intent({
          fromDate: '2026-03-01',
          untilDate: '2026-03-09',
          anchorWeekStart: '2026-02-23',
          rules: [rule({ weekdays: [7], startTime: '02:30', endTime: '04:00' })],
        }),
        'America/New_York'
      )
    ).rejects.toMatchObject({ reason: 'window' });
  });

  it('rejects overlap across rules and across overnight occurrences of the same employee', async () => {
    await expect(
      expandScheduleRecurrence(intent({ rules: [rule(), rule({ id: 'other' })] }), 'UTC')
    ).rejects.toMatchObject({ reason: 'overlap' });
    await expect(
      expandScheduleRecurrence(
        intent({
          rules: [
            rule({ weekdays: [7], startTime: '22:00', endTime: '09:00', endDayOffset: 1 }),
            rule({ id: 'other', weekdays: [1] }),
          ],
        }),
        'UTC'
      )
    ).rejects.toMatchObject({ reason: 'overlap' });
  });

  it('allows adjacent shifts and independent employees in the same window', async () => {
    const result = await expandScheduleRecurrence(
      intent({
        rules: [
          rule({ endTime: '12:00' }),
          rule({ id: 'afternoon', startTime: '12:00' }),
          rule({ id: 'other-employee', userId: 'employee-b' }),
        ],
      }),
      'UTC'
    );
    expect(result).toHaveLength(18);
  });

  it('does not share endpoint caches across concurrent requests or timezone changes', async () => {
    const input = intent();
    const [utc, bogota] = await Promise.all([
      expandScheduleRecurrence(input, 'UTC'),
      expandScheduleRecurrence(input, 'America/Bogota'),
    ]);
    expect(utc[0]?.startsAt).toBe('2026-09-07T08:00:00.000Z');
    expect(bogota[0]?.startsAt).toBe('2026-09-07T13:00:00.000Z');
  });

  it('aborts before work and during expansion without affecting another caller', async () => {
    const already = new AbortController();
    const reason = new Error('Cancelled generation');
    already.abort(reason);
    await expect(expandScheduleRecurrence(intent(), 'UTC', already.signal)).rejects.toBe(reason);
    const controller = new AbortController();
    const pending = expandScheduleRecurrence(
      intent({ rules: daily(20) }),
      'UTC',
      controller.signal
    );
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const other = expandScheduleRecurrence(intent(), 'UTC');
    await yieldToEventLoop();
    controller.abort();
    await rejection;
    expect(await other).toHaveLength(6);
  });

  it('matches a calendar oracle and round-trips real endpoints for bounded random rules', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 31 }),
        fc.constantFrom('UTC', 'America/Bogota', 'America/New_York', 'Australia/Lord_Howe'),
        async (weekdays, intervalWeeks, days, zone) => {
          const from = Date.parse('2026-09-07');
          const input = intent({
            untilDate: new Date(from + days * 86_400_000).toISOString().slice(0, 10),
            rules: [rule({ weekdays, intervalWeeks })],
          });
          const expected = Array.from(
            { length: days },
            (_, offset) => new Date(from + offset * 86_400_000)
          )
            .filter(
              (day, offset) =>
                weekdays.includes(day.getUTCDay() || 7) &&
                Math.floor(offset / 7) % intervalWeeks === 0
            )
            .map(day => day.toISOString().slice(0, 10));
          if (expected.length === 0) {
            await expect(expandScheduleRecurrence(input, zone)).rejects.toMatchObject({
              reason: 'empty',
            });
            return;
          }
          const result = await expandScheduleRecurrence(input, zone);
          expect(result.map(row => row.startDate)).toEqual(expected);
          for (const row of result) {
            expect(calendarDateInTimeZone(row.startsAt, zone)).toBe(row.startDate);
            expect(calendarDateInTimeZone(row.endsAt, zone)).toBe(row.endDate);
            expect(Date.parse(row.endsAt) - Date.parse(row.startsAt)).toBe(8 * 3_600_000);
          }
        }
      ),
      { numRuns: 50, seed: 20260904 }
    );
  });
});
