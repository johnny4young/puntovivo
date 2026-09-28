import { afterEach, describe, expect, it } from 'vitest';
import {
  calendarDayAt,
  cn,
  formatCalendarDay,
  formatCurrency,
  formatDate,
  formatDateTime,
  generateId,
  getActiveTenantLocale,
  getErrorMessage,
  isOnline,
  setActiveTenantLocale,
} from './utils';

afterEach(() => {
  setActiveTenantLocale(null);
});

describe('cn — tailwind-merge wrapper', () => {
  it('merges duplicate Tailwind utilities', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('drops falsy class names from clsx input', () => {
    const flag = false as boolean;
    expect(cn('a', undefined, null, '', flag && 'b', 'c')).toBe('a c');
  });

  it('keeps non-conflicting utilities in order', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });
});

describe('formatCurrency — locale resolution branches', () => {
  it('falls back to USD with two decimals when no tenant locale is set', () => {
    setActiveTenantLocale(null);
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(-100)).toBe('-$100.00');
    expect(formatCurrency(1_000_000)).toBe('$1,000,000.00');
    expect(formatCurrency(19.999)).toBe('$20.00');
    expect(formatCurrency(0.99)).toBe('$0.99');
  });

  it('honours an explicit currency arg over the active tenant locale', () => {
    setActiveTenantLocale({
      locale: 'en-US',
      currency: 'USD',
      displayDecimals: 2,
      timezone: 'UTC',
      dateFormatShort: 'MM/dd/yyyy',
    });
    const out = formatCurrency(1000, 'EUR', 'en-US');
    expect(out).toMatch(/€/);
  });

  it('uses tenant displayDecimals when no explicit currency is given', () => {
    setActiveTenantLocale({
      locale: 'es-CO',
      currency: 'COP',
      displayDecimals: 0,
      timezone: 'America/Bogota',
      dateFormatShort: 'dd/MM/yyyy',
    });
    // 0 decimals → trailing fractional part absent. es-CO uses `.` as the
    // thousand separator, so `94.000` is allowed; we only forbid trailing
    // `,00` / `.00` sequences at end-of-string.
    expect(formatCurrency(94000)).not.toMatch(/[.,]00$/);
  });

  it('skips the displayDecimals branch when an explicit currency arg is supplied', () => {
    setActiveTenantLocale({
      locale: 'en-US',
      currency: 'USD',
      displayDecimals: 0,
      timezone: 'UTC',
      dateFormatShort: 'MM/dd/yyyy',
    });
    // Explicit currency means the locale-default decimals win (USD = 2).
    expect(formatCurrency(94000, 'USD')).toMatch(/\.00$/);
  });
});

describe('calendarDayAt — tenant-local reporting day', () => {
  it('uses the tenant timezone at both sides of UTC midnight', () => {
    const instant = new Date('2026-08-27T02:30:00.000Z');

    expect(calendarDayAt(instant, 'America/Bogota')).toBe('2026-08-26');
    expect(calendarDayAt(instant, 'Europe/Madrid')).toBe('2026-08-27');
  });

  it('always returns the Gregorian YYYY-MM-DD report shape', () => {
    expect(calendarDayAt(new Date('2026-01-05T12:00:00.000Z'), 'Asia/Bangkok')).toBe('2026-01-05');
  });
});

describe('formatCalendarDay — date-only business records', () => {
  it('does not shift a Colombian supplier date to the previous day', () => {
    setActiveTenantLocale({
      locale: 'es-CO',
      currency: 'COP',
      displayDecimals: 0,
      timezone: 'America/Bogota',
      dateFormatShort: 'dd/MM/yyyy',
    });

    expect(formatCalendarDay('2026-08-31')).toBe('31/08/2026');
  });

  it('rejects timestamps and impossible calendar dates', () => {
    expect(formatCalendarDay('2026-08-31T00:00:00.000Z')).toBe('');
    expect(formatCalendarDay('2026-02-30')).toBe('');
  });
});

describe('formatDate / formatDateTime — tenant formats', () => {
  it('formats with the default medium date style when no tenant locale is set', () => {
    expect(formatDate(new Date('2024-03-15T12:00:00'))).toMatch(/Mar.*15.*2024/);
    expect(formatDate(new Date('2024-03-15T12:00:00'), { dateStyle: 'long' })).toContain('March');
    expect(formatDateTime(new Date('2024-03-15T14:30:00'))).toMatch(/Mar.*15.*2024.*\d{1,2}:\d{2}/);
  });

  it('uses the active tenant short date format and timezone', () => {
    setActiveTenantLocale({
      locale: 'es-CO',
      currency: 'COP',
      displayDecimals: 0,
      timezone: 'America/Bogota',
      dateFormatShort: 'dd/MM/yyyy',
    });

    expect(formatDate('2026-04-23T23:30:00Z')).toBe('23/04/2026');
    expect(formatDateTime('2026-04-23T23:30:00Z')).toMatch(/^23\/04\/2026\s/);
  });

  it('uses US ordering when the active tenant format is MM/dd/yyyy', () => {
    setActiveTenantLocale({
      locale: 'en-US',
      currency: 'USD',
      displayDecimals: 2,
      timezone: 'America/New_York',
      dateFormatShort: 'MM/dd/yyyy',
    });

    expect(formatDate('2026-04-23T23:30:00Z')).toBe('04/23/2026');
  });
});

describe('formatDate / formatDateTime — invalid-input safety', () => {
  it('returns empty string for an empty input string (no Intl crash)', () => {
    expect(formatDate('')).toBe('');
    expect(formatDateTime('')).toBe('');
  });

  it('returns empty string for invalid date strings', () => {
    expect(formatDate('not-a-date')).toBe('');
    expect(formatDateTime('not-a-date')).toBe('');
  });

  it('returns empty string when called with null or undefined at runtime', () => {
    expect(formatDate(null as unknown as string)).toBe('');
    expect(formatDate(undefined as unknown as string)).toBe('');
    expect(formatDateTime(null as unknown as string)).toBe('');
    expect(formatDateTime(undefined as unknown as string)).toBe('');
  });

  it('formats valid ISO strings as a non-empty localized string', () => {
    expect(formatDate('2026-04-25T12:00:00')).not.toBe('');
    expect(formatDateTime('2026-04-25T12:00:00')).not.toBe('');
  });

  it('honours the explicit options branch (overrides dateStyle)', () => {
    const out = formatDate('2026-04-25T12:00:00', { dateStyle: 'short' });
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('setActiveTenantLocale / getActiveTenantLocale', () => {
  it('round-trips a snapshot through the module-level setter', () => {
    const snapshot = {
      locale: 'es-CL',
      currency: 'CLP',
      displayDecimals: 0,
      timezone: 'America/Santiago',
      dateFormatShort: 'dd-MM-yyyy',
    };
    setActiveTenantLocale(snapshot);
    expect(getActiveTenantLocale()).toEqual(snapshot);
    setActiveTenantLocale(null);
    expect(getActiveTenantLocale()).toBeNull();
  });
});

describe('generateId', () => {
  it('returns a UUID-shaped string', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe('isOnline', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, writable: true });
  });

  it.each([
    [{ onLine: true }, true],
    [{ onLine: false }, false],
    [undefined, true],
  ])('reads navigator.onLine and assumes online without a navigator (%o)', (value, expected) => {
    Object.defineProperty(globalThis, 'navigator', { value, writable: true });
    expect(isOnline()).toBe(expected);
  });
});

describe('getErrorMessage', () => {
  it('returns Error.message for Error instances', () => {
    expect(getErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('returns the fallback for non-Error values (string, null, plain object)', () => {
    expect(getErrorMessage('not an error', 'fb')).toBe('fb');
    expect(getErrorMessage(null, 'fb2')).toBe('fb2');
    expect(getErrorMessage({ message: 'fake' }, 'fb3')).toBe('fb3');
  });
});
