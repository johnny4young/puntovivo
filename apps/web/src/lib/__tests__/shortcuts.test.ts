/**
 * (slice A) — Canonical shortcut catalogue tests.
 *
 * Pins:
 * - `getShortcutById` returns the entry when present, undefined otherwise.
 * - `formatKeysForDisplay` renders mac vs non-mac symbols correctly.
 * - `formatKeysForAria` always returns canonical CamelCase + `Control`
 * for `Mod` regardless of platform.
 * - `matchesShortcut` accepts both Ctrl + Meta on non-mac for `Mod`
 * combos and rejects unrelated modifiers.
 *
 * @module lib/__tests__/shortcuts.test
 */
import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  ariaKeyshortcutsFor,
  formatKeysForAria,
  formatKeysForDisplay,
  getShortcutById,
  matchesShortcut,
} from '../shortcuts';

function buildKeyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('getShortcutById', () => {
  it('returns the entry when registered', () => {
    const entry = getShortcutById('palette.open');
    expect(entry).toBeDefined();
    expect(entry?.keys).toEqual(['Mod+K']);
    expect(entry?.scope).toBe('global');
  });

  it('returns undefined when not registered', () => {
    expect(getShortcutById('does.not.exist')).toBeUndefined();
  });

  it('catalogue declares every well-known /sales shortcut', () => {
    const required = [
      'sales.charge',
      'sales.productSearch',
      'sales.focusProduct',
      'sales.focusQuantity',
      'sales.focusDiscount',
      'sales.suspend',
      'sales.toggleSuspended',
      'sales.reprint',
      'sales.removeItem',
      // undo binding.
      'sales.undo',
      // fast-cash binding.
      'sales.fastCash',
    ];
    for (const id of required) {
      expect(SHORTCUTS.some(s => s.id === id)).toBe(true);
    }
  });

  // registration sanity check + chip rendering.
  it('exposes sales.undo on Mod+Z with the cashier role', () => {
    const entry = getShortcutById('sales.undo');
    expect(entry).toBeDefined();
    expect(entry?.keys).toEqual(['Mod+Z']);
    expect(entry?.scope).toBe('sales');
    expect(entry?.roles).toContain('cashier');
  });

  // fast-cash registration sanity check. F2 is a bare
  // function key so the combo carries no Mod / Shift / Alt — the
  // matcher must accept it without modifier interference.
  it('exposes sales.fastCash on F2 with the cashier role', () => {
    const entry = getShortcutById('sales.fastCash');
    expect(entry).toBeDefined();
    expect(entry?.keys).toEqual(['F2']);
    expect(entry?.scope).toBe('sales');
    expect(entry?.roles).toContain('cashier');
  });
});

describe('formatKeysForDisplay', () => {
  it('renders Mod as ⌘ and joins without separator on macOS', () => {
    expect(formatKeysForDisplay(['Mod+K'], true)).toBe('⌘K');
    expect(formatKeysForDisplay(['Mod+Shift+P'], true)).toBe('⌘⇧P');
  });

  it('renders Mod as Ctrl and joins with + elsewhere', () => {
    expect(formatKeysForDisplay(['Mod+K'], false)).toBe('Ctrl+K');
    expect(formatKeysForDisplay(['Mod+Shift+P'], false)).toBe('Ctrl+Shift+P');
  });

  it('passes function keys through verbatim', () => {
    expect(formatKeysForDisplay(['F1'], false)).toBe('F1');
    expect(formatKeysForDisplay(['F5'], true)).toBe('F5');
  });

  it('returns empty string for empty input', () => {
    expect(formatKeysForDisplay([])).toBe('');
  });
});

describe('formatKeysForAria', () => {
  it('rewrites Mod to the actual platform modifier', () => {
    expect(formatKeysForAria(['Mod+K'], false)).toBe('Control+K');
    expect(formatKeysForAria(['Mod+Shift+P'], false)).toBe('Control+Shift+P');
    expect(formatKeysForAria(['Mod+K'], true)).toBe('Meta+K');
    expect(formatKeysForAria(['Mod+Shift+P'], true)).toBe('Meta+Shift+P');
  });

  it('joins multiple combos with a single space', () => {
    expect(formatKeysForAria(['F1', 'Mod+Enter'])).toBe('F1 Control+Enter');
  });
});

describe('ariaKeyshortcutsFor', () => {
  it('returns the formatted value for known ids', () => {
    expect(ariaKeyshortcutsFor('sales.charge', false)).toBe('F1');
    expect(ariaKeyshortcutsFor('sales.suspend', false)).toBe('Control+P');
    expect(ariaKeyshortcutsFor('sales.suspend', true)).toBe('Meta+P');
  });

  it('returns undefined when not registered', () => {
    expect(ariaKeyshortcutsFor('nope')).toBeUndefined();
  });
});

describe('matchesShortcut', () => {
  it('matches Mod+K with Ctrl on non-mac', () => {
    const event = buildKeyEvent({ key: 'k', ctrlKey: true });
    const shortcut = getShortcutById('palette.open')!;
    expect(matchesShortcut(event, shortcut, false)).toBe(true);
  });

  it('matches Mod+K with Meta on non-mac (external keyboard)', () => {
    const event = buildKeyEvent({ key: 'k', metaKey: true });
    const shortcut = getShortcutById('palette.open')!;
    expect(matchesShortcut(event, shortcut, false)).toBe(true);
  });

  it('matches Mod+K with Cmd (metaKey) on mac', () => {
    const event = buildKeyEvent({ key: 'k', metaKey: true });
    const shortcut = getShortcutById('palette.open')!;
    expect(matchesShortcut(event, shortcut, true)).toBe(true);
  });

  it('does NOT match Mod+K with only Ctrl on mac', () => {
    const event = buildKeyEvent({ key: 'k', ctrlKey: true });
    const shortcut = getShortcutById('palette.open')!;
    expect(matchesShortcut(event, shortcut, true)).toBe(false);
  });

  it('rejects when key matches but required modifier is absent', () => {
    const event = buildKeyEvent({ key: 'k' });
    const shortcut = getShortcutById('palette.open')!;
    expect(matchesShortcut(event, shortcut, false)).toBe(false);
  });

  it('rejects when shift is required but not pressed', () => {
    const event = buildKeyEvent({ key: 'p', ctrlKey: true });
    const reprint = getShortcutById('sales.reprint')!;
    expect(matchesShortcut(event, reprint, false)).toBe(false);
  });

  it('matches F-keys with no modifier on either platform', () => {
    const event = buildKeyEvent({ key: 'F1' });
    const charge = getShortcutById('sales.charge')!;
    expect(matchesShortcut(event, charge, false)).toBe(true);
    expect(matchesShortcut(event, charge, true)).toBe(true);
  });
});
