/**
 * Regression suite for the strict ISO parser (`lib/isoDate`). The rule it
 * exists to enforce is narrow and easy to regress: `Date.parse` accepts an
 * impossible calendar date and rolls it forward into the next month, so any
 * fail-closed check built on `Number.isFinite(Date.parse(value))` lets the
 * corrupt value through as a valid instant. These cases pin both halves of
 * the contract — the impossible dates that must be rejected, and the real
 * ones that must keep parsing.
 */

import { describe, expect, it } from 'vitest';
import { isStrictIsoInstant, parseStrictIsoInstant } from '../lib/isoDate.js';

describe('parseStrictIsoInstant', () => {
  it('rejects impossible calendar dates that Date.parse rolls forward', () => {
    // Every one of these is finite under Date.parse, two days off the input.
    for (const value of [
      '2026-02-30',
      '2026-02-30T00:00:00.000Z',
      '2026-06-31',
      '2026-06-31T23:59:59.000Z',
      '2026-04-31T12:00:00Z',
      '2026-02-29T00:00:00.000Z',
      '1900-02-29',
    ]) {
      expect(Number.isFinite(Date.parse(value))).toBe(true);
      expect(parseStrictIsoInstant(value)).toBeNull();
    }
  });

  it('rejects out-of-range components and non-ISO shapes', () => {
    for (const value of [
      '2026-13-01',
      '2026-00-10',
      '2026-01-00',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:60:00Z',
      '2026-01-01T00:00:60Z',
      '2026-01-15 10:00:00',
      '15/01/2026',
      'invalid-reference-clock',
      '',
    ]) {
      expect(parseStrictIsoInstant(value)).toBeNull();
    }
  });

  it('parses real dates, leap days and offset timestamps', () => {
    expect(parseStrictIsoInstant('2026-02-28')).toBe(Date.parse('2026-02-28T00:00:00.000Z'));
    expect(parseStrictIsoInstant('2028-02-29')).toBe(Date.parse('2028-02-29T00:00:00.000Z'));
    expect(parseStrictIsoInstant('2000-02-29')).toBe(Date.parse('2000-02-29T00:00:00.000Z'));
    expect(parseStrictIsoInstant('2026-01-15T10:30:00.250Z')).toBe(
      Date.parse('2026-01-15T10:30:00.250Z')
    );
    expect(parseStrictIsoInstant('2026-01-15T10:30:00-05:00')).toBe(
      Date.parse('2026-01-15T15:30:00.000Z')
    );
  });

  it('anchors a zone-less timestamp to UTC, not to the host clock', () => {
    // Date.parse would read this in local time, making a stored expiry mean
    // different instants on different machines.
    expect(parseStrictIsoInstant('2026-01-15T10:30:00')).toBe(
      Date.parse('2026-01-15T10:30:00.000Z')
    );
  });

  it('exposes the boolean form used by input validation', () => {
    expect(isStrictIsoInstant('2026-02-28')).toBe(true);
    expect(isStrictIsoInstant('2026-02-30')).toBe(false);
  });
});
