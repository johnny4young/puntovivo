import { describe, expect, it } from 'vitest';
import { dateTimeFormatter } from './dateTimeFormatter';

describe('bounded date formatter reuse', () => {
  it('canonicalizes full option sets without retaining formatted dates', () => {
    const options = {
      timeZone: 'America/Bogota',
      dateStyle: 'medium',
      timeStyle: 'short',
    } as const;
    const formatter = dateTimeFormatter('es-CO', options);
    expect(
      dateTimeFormatter('es-CO', {
        timeStyle: 'short',
        dateStyle: 'medium',
        timeZone: 'America/Bogota',
        hour12: undefined,
      })
    ).toBe(formatter);
    for (const date of ['2026-01-01T01:30:00Z', '2026-07-01T20:30:00Z']) {
      expect(formatter.format(new Date(date))).toBe(
        new Intl.DateTimeFormat('es-CO', options).format(new Date(date))
      );
    }
  });

  it('isolates locale, zone, calendar, numbering and hour options across DST', () => {
    for (const locale of ['en-US', 'es-CO'])
      for (const timeZone of ['America/New_York', 'UTC', 'America/Bogota']) {
        for (const hour12 of [true, false]) {
          const options = {
            timeZone,
            hour12,
            dateStyle: 'long',
            timeStyle: 'short',
            calendar: 'gregory',
            numberingSystem: 'latn',
          } as const;
          for (const date of [
            '2026-03-08T06:59:00Z',
            '2026-03-08T07:01:00Z',
            '2026-11-01T05:59:00Z',
            '2026-11-01T06:01:00Z',
          ]) {
            expect(dateTimeFormatter(locale, options).format(new Date(date))).toBe(
              new Intl.DateTimeFormat(locale, options).format(new Date(date))
            );
          }
        }
      }
    expect(dateTimeFormatter('en-US', { timeZone: 'UTC', calendar: 'gregory' })).not.toBe(
      dateTimeFormatter('en-US', { timeZone: 'UTC', calendar: 'buddhist' })
    );
    expect(dateTimeFormatter('en-US', { timeZone: 'UTC', numberingSystem: 'latn' })).not.toBe(
      dateTimeFormatter('en-US', { timeZone: 'UTC', numberingSystem: 'arab' })
    );
  });

  it('bounds retained configurations and does not retain the ambient system zone', () => {
    const first = dateTimeFormatter('en-US-x-first', { timeZone: 'UTC' });
    for (let index = 0; index < 64; index++)
      dateTimeFormatter(`en-US-x-${index}`, { timeZone: 'UTC' });
    expect(dateTimeFormatter('en-US-x-first', { timeZone: 'UTC' })).not.toBe(first);
    expect(dateTimeFormatter('en-US', { dateStyle: 'medium' })).not.toBe(
      dateTimeFormatter('en-US', { dateStyle: 'medium' })
    );
    expect(() => dateTimeFormatter('en-US', { timeZone: 'invalid-zone' })).toThrow(RangeError);
  });
});
