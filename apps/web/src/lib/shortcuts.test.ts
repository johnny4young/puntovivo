/**
 * Matcher semantics pinned after the atajos-reales review: the
 * event.code fallback rescues ONLY macOS Alt-composition — it must
 * never remap a deliberate printable keypress by physical position,
 * never apply to non-Alt combos, and never treat NumLock-off numpad
 * navigation as digits.
 */
import { describe, expect, it } from 'vitest';
import { altChordLetter, getShortcutById, matchesShortcut } from './shortcuts';

function keyEvent(key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ...init });
}

describe('matchesShortcut — code fallback boundaries', () => {
  const paletteOpen = getShortcutById('palette.open')!;
  const navDashboard = getShortcutById('nav.dashboard')!;
  const logout = getShortcutById('app.logout')!;
  const focusProduct = getShortcutById('sales.focusProduct')!;

  it('matches the plain labeled key', () => {
    expect(matchesShortcut(keyEvent('1', { altKey: true, code: 'Digit1' }), navDashboard)).toBe(
      true
    );
  });

  it('rescues macOS Alt-composition through the physical code', () => {
    // mac US: Alt+1 composes to a non-ASCII character.
    expect(matchesShortcut(keyEvent('¡', { altKey: true, code: 'Digit1' }), navDashboard)).toBe(
      true
    );
    // mac US: Alt+P composes to pi.
    expect(matchesShortcut(keyEvent('π', { altKey: true, code: 'KeyP' }), focusProduct)).toBe(true);
  });

  it('never remaps a printable key by physical position', () => {
    // AZERTY labeled Alt+A: printable key a on physical KeyQ. Firing
    // Alt+Q logout here would end a cashier session mid-shift.
    expect(matchesShortcut(keyEvent('a', { altKey: true, code: 'KeyQ' }), logout)).toBe(false);
  });

  it('never applies the fallback to non-Alt combos', () => {
    // Dvorak: physical KeyK types t. Ctrl+T must not open the palette.
    expect(matchesShortcut(keyEvent('t', { ctrlKey: true, code: 'KeyK' }), paletteOpen)).toBe(
      false
    );
  });

  it('ignores NumLock-off numpad navigation keys', () => {
    // Numpad1 with NumLock off reports End - the user means navigation.
    expect(matchesShortcut(keyEvent('End', { altKey: true, code: 'Numpad1' }), navDashboard)).toBe(
      false
    );
  });
});

describe('altChordLetter', () => {
  it('prefers the printable label', () => {
    expect(altChordLetter(keyEvent('a', { altKey: true, code: 'KeyQ' }))).toBe('a');
  });

  it('falls back to the physical letter for composed characters', () => {
    expect(altChordLetter(keyEvent('π', { altKey: true, code: 'KeyP' }))).toBe('p');
    expect(altChordLetter(keyEvent('Dead', { altKey: true, code: 'KeyN' }))).toBe('n');
  });
});
