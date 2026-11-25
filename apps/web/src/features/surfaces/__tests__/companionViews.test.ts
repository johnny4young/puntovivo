import { describe, expect, it } from 'vitest';
import {
  companionViews,
  isCompanionOwner,
  parseCompanionView,
  sealedDayDate,
} from '../companionViews';

describe('companionViews', () => {
  it('gives the owner tabs to admins and managers only', () => {
    expect(isCompanionOwner('admin')).toBe(true);
    expect(isCompanionOwner('manager')).toBe(true);
    expect(isCompanionOwner('viewer')).toBe(false);
    expect(companionViews(false)).toEqual(['today', 'more']);
  });

  it('falls back to today for unknown or forbidden views', () => {
    expect(parseCompanionView('registers', true)).toBe('registers');
    expect(parseCompanionView('registers', false)).toBe('today');
    expect(parseCompanionView('nope', true)).toBe('today');
    expect(parseCompanionView(null, true)).toBe('today');
  });

  it('picks the requested day, today once signed, otherwise yesterday', () => {
    expect(sealedDayDate('2026-11-02', '2026-11-11', false)).toBe('2026-11-02');
    expect(sealedDayDate('not-a-date', '2026-11-11', true)).toBe('2026-11-11');
    expect(sealedDayDate(null, '2026-03-01', false)).toBe('2026-02-28');
  });
});
