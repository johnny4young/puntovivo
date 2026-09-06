/**
 * The same station must read the same everywhere. These cases pin the two
 * inputs that made the old name-only check disagree with itself: a custom
 * station legitimately NAMED `main`, and a renamed default kitchen.
 */
import { describe, expect, it } from 'vitest';
import { resolveStationLabel } from '../stationLabel';

const DEFAULT_LABEL = 'Kitchen';

describe('resolveStationLabel', () => {
  it('localizes the untouched default station', () => {
    expect(resolveStationLabel({ code: 'main', name: 'main' }, DEFAULT_LABEL)).toBe(DEFAULT_LABEL);
  });

  it('localizes the default station when no name reached the client', () => {
    expect(resolveStationLabel({ code: 'main' }, DEFAULT_LABEL)).toBe(DEFAULT_LABEL);
    expect(resolveStationLabel({ code: 'main', name: null }, DEFAULT_LABEL)).toBe(DEFAULT_LABEL);
  });

  it('keeps the operator name when the default station was renamed', () => {
    expect(resolveStationLabel({ code: 'main', name: 'Cocina Central' }, DEFAULT_LABEL)).toBe(
      'Cocina Central'
    );
  });

  it('never localizes a custom station that happens to be named main', () => {
    // The API accepts this. Keying off the name alone showed it as the default
    // kitchen in the board filter while the column heading fell through to the
    // code, giving one station two names on the same screen.
    expect(resolveStationLabel({ code: 'grill', name: 'main' }, DEFAULT_LABEL)).toBe('main');
  });

  it('falls back to the code when a custom station has no usable name', () => {
    expect(resolveStationLabel({ code: 'grill', name: '  ' }, DEFAULT_LABEL)).toBe('grill');
    expect(resolveStationLabel({ code: 'grill' }, DEFAULT_LABEL)).toBe('grill');
  });
});
