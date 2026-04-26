import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cn,
  debounce,
  formatCurrency,
  formatDate,
  formatDateTime,
  generateId,
  getActiveTenantLocale,
  getErrorMessage,
  isOnline,
  setActiveTenantLocale,
  sleep,
  throttle,
} from './utils';

afterEach(() => {
  setActiveTenantLocale(null);
  vi.useRealTimers();
});

describe('cn — tailwind-merge wrapper', () => {
  it('merges duplicate Tailwind utilities', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('drops falsy class names from clsx input', () => {
    const flag = false as boolean;
    expect(cn('a', undefined, flag && 'b', 'c')).toBe('a c');
  });
});

describe('formatCurrency — locale resolution branches', () => {
  it('falls back to USD when no tenant locale and no explicit currency', () => {
    setActiveTenantLocale(null);
    expect(formatCurrency(1234.5)).toMatch(/\$/);
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

describe('debounce / throttle', () => {
  it('debounce coalesces rapid calls and invokes once after the delay', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 50);
    debounced('a');
    debounced('b');
    debounced('c');
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('c');
  });

  it('throttle invokes immediately, then suppresses calls inside the window', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const throttled = throttle(spy, 100);
    throttled('a');
    throttled('b');
    throttled('c');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('a');
    vi.advanceTimersByTime(100);
    throttled('d');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith('d');
  });
});

describe('sleep', () => {
  it('resolves after the requested delay', async () => {
    vi.useFakeTimers();
    const promise = sleep(20);
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(resolved).toBe(true);
  });
});

describe('isOnline', () => {
  it('reads navigator.onLine when available', () => {
    expect(isOnline()).toBe(navigator.onLine);
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

describe('teardown', () => {
  beforeEach(() => {
    setActiveTenantLocale(null);
  });
  it('clears the active tenant locale between suites', () => {
    expect(getActiveTenantLocale()).toBeNull();
  });
});
