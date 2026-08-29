/**
 * (slice A) — Canonical keyboard-shortcut catalogue.
 *
 * This module is the single source of truth for every keyboard
 * shortcut the renderer exposes. Three downstream consumers read
 * from it:
 *
 * 1. The Command Palette (`CommandPalette.tsx`) — displays the
 * shortcut hint on the right of every action it knows about.
 * 2. The `aria-keyshortcuts` attribute on the real buttons in
 * the DOM (Charge / Suspend / Toggle Suspended / ...). The
 * attribute closes the Remaining slice of  (AA
 * accessibility) that was waiting on this canonical map.
 * 3. `docs/SHORTCUTS.md` documents the catalogue — adding a
 * shortcut here without updating the doc is a review-time
 * flag.
 *
 * Existing imperative handlers (`useSalesKeyboardShortcuts.ts`,
 * Modal ESC handler, etc.) stay where they are — the catalogue
 * is declarative, not the event-loop owner. The only NEW handler
 * wired in slice A is the global Mod+K listener inside
 * `CommandPaletteProvider.tsx`.
 *
 * @module lib/shortcuts
 */

import { DASHBOARD_ROLES, MANAGER_OR_ADMIN_ROLES, SALES_ROLES } from '@puntovivo/shared/roles';
import type { UserRole } from '@/types';

/**
 * Symbolic key strings. We avoid encoding native `KeyboardEvent.key`
 * values directly to keep the catalogue platform-neutral. `Mod` is
 * the meta-modifier that maps to `Cmd` on macOS and `Ctrl`
 * elsewhere — see `isMacPlatform()` below.
 */
export type ShortcutKey = string;

/**
 * Surface where the shortcut is active. `global` means the
 * shortcut fires from anywhere in the renderer (e.g. `Mod+K`);
 * named scopes are documented in `SHORTCUTS.md` but the catalogue
 * itself does not enforce them — every imperative handler decides
 * its own scope guard.
 */
export type ShortcutScope = 'global' | 'sales' | 'modal';

export interface ShortcutDefinition {
  /** Stable id used by callers (`getShortcutById('palette.open')`). */
  id: string;
  /**
   * Array of key combinations that fire the shortcut. Every
   * element is a `+`-joined string of modifiers + final key, where
   * modifiers come first in order: `Control`, `Alt`, `Shift`,
   * `Meta`, `Mod` (special — see notes above).
   *
   * Example: `['Mod+K']`, `['F1']`, `['Mod+Shift+P']`,
   * `['Alt+P']`.
   */
  keys: ShortcutKey[];
  scope: ShortcutScope;
  /**
   * i18n key under the `shortcuts` namespace whose value is the
   * human-readable action label, NOT the keys. Example:
   * `palette.open` → `shortcuts:palette.open.label`.
   */
  labelKey: string;
  /**
   * Exact router destination for global navigation shortcuts. Keeping the
   * route next to its keys and roles lets the listener, palette and visible
   * links consume one mapping instead of maintaining parallel href tables.
   */
  route?: string;
  /**
   * Roles that can SEE / TRIGGER this shortcut. The Command
   * Palette filters its action list by this set; an imperative
   * handler may also defer to the role guard already on the
   * route. `null` (default) means visible to every authenticated
   * role.
   */
  roles?: readonly UserRole[];
}

/**
 * Declarative catalogue. New shortcuts are added to this list, NOT
 * created ad-hoc inside components. The companion update to
 * `docs/SHORTCUTS.md` should land in the same PR.
 */
export const SHORTCUTS: readonly ShortcutDefinition[] = [
  // (this slice) — the only NEW handler wired in this PR.
  {
    id: 'palette.open',
    keys: ['Mod+K'],
    scope: 'global',
    labelKey: 'palette.open',
  },

  // /  — pre-existing /sales shortcuts declared
  // here for the palette hint + aria-keyshortcuts hookup. The
  // imperative handler lives in `useSalesKeyboardShortcuts.ts`.
  {
    id: 'sales.charge',
    keys: ['F1'],
    scope: 'sales',
    labelKey: 'sales.charge',
    roles: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'sales.productSearch',
    keys: ['F5'],
    scope: 'sales',
    labelKey: 'sales.productSearch',
    roles: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'sales.focusProduct',
    keys: ['Alt+P'],
    scope: 'sales',
    labelKey: 'sales.focusProduct',
    roles: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'sales.focusQuantity',
    keys: ['Alt+C'],
    scope: 'sales',
    labelKey: 'sales.focusQuantity',
    roles: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'sales.focusDiscount',
    keys: ['Alt+D'],
    scope: 'sales',
    labelKey: 'sales.focusDiscount',
    roles: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'sales.focusUnit',
    keys: ['Alt+U'],
    scope: 'modal',
    labelKey: 'sales.focusUnit',
    roles: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'sales.suspend',
    keys: ['Mod+P'],
    scope: 'sales',
    labelKey: 'sales.suspend',
    roles: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'sales.toggleSuspended',
    keys: ['Mod+R'],
    scope: 'sales',
    labelKey: 'sales.toggleSuspended',
    roles: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'sales.reprint',
    keys: ['Mod+Shift+P'],
    scope: 'sales',
    labelKey: 'sales.reprint',
    roles: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'sales.removeItem',
    keys: ['Delete'],
    scope: 'sales',
    labelKey: 'sales.removeItem',
    roles: ['admin', 'manager', 'cashier'],
  },
  // undo the last cart mutation (add / qty / discount /
  // remove). The imperative handler lives in
  // `useSalesKeyboardShortcuts.ts`; the catalogue entry powers the
  // visible chip on the SaleCartTable "Deshacer" button + the
  // `aria-keyshortcuts` attribute on the same button.
  {
    id: 'sales.undo',
    keys: ['Mod+Z'],
    scope: 'sales',
    labelKey: 'sales.undo',
    roles: ['admin', 'manager', 'cashier'],
  },
  // "atajos reales" band — bindings the public site once
  // promised without shipping; each one now has a real handler.
  //
  // Global navigation. The imperative handler lives in
  // `GlobalShortcutsProvider` and matches on `event.code`, so the
  // combos survive macOS Alt-composition (Alt+2 emits '€' as
  // `event.key` on some layouts) and non-QWERTY layouts alike.
  {
    id: 'nav.dashboard',
    keys: ['Alt+1'],
    scope: 'global',
    labelKey: 'nav.dashboard',
    route: '/dashboard',
    roles: DASHBOARD_ROLES,
  },
  {
    id: 'nav.sales',
    keys: ['Alt+2'],
    scope: 'global',
    labelKey: 'nav.sales',
    route: '/sales',
    roles: SALES_ROLES,
  },
  {
    id: 'nav.inventory',
    keys: ['Alt+3'],
    scope: 'global',
    labelKey: 'nav.inventory',
    route: '/inventory',
    roles: MANAGER_OR_ADMIN_ROLES,
  },
  {
    id: 'nav.purchases',
    keys: ['Alt+4'],
    scope: 'global',
    labelKey: 'nav.purchases',
    route: '/purchases',
    roles: MANAGER_OR_ADMIN_ROLES,
  },
  // The shortcut sheet itself. Its lazy body lists this combo with
  // the rest of the canonical catalogue once the operator opens it.
  {
    id: 'app.shortcutsSheet',
    keys: ['Alt+/'],
    scope: 'global',
    labelKey: 'app.shortcutsSheet',
  },
  {
    id: 'app.themeToggle',
    keys: ['Alt+Shift+D'],
    scope: 'global',
    labelKey: 'app.themeToggle',
  },
  {
    id: 'app.switchSite',
    keys: ['Alt+Shift+S'],
    scope: 'global',
    labelKey: 'app.switchSite',
  },
  {
    id: 'app.logout',
    keys: ['Alt+Q'],
    scope: 'global',
    labelKey: 'app.logout',
  },
  // Register lifecycle, wired through `useSalesKeyboardShortcuts`
  // next to the rest of the /sales handlers.
  {
    id: 'sales.newSale',
    keys: ['Alt+N'],
    scope: 'sales',
    labelKey: 'sales.newSale',
    roles: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'sales.openCashSession',
    keys: ['Alt+A'],
    scope: 'sales',
    labelKey: 'sales.openCashSession',
    roles: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'sales.cashMovement',
    keys: ['Alt+M'],
    scope: 'sales',
    labelKey: 'sales.cashMovement',
    roles: ['admin', 'manager', 'cashier'],
  },
  {
    id: 'sales.closeCashSession',
    keys: ['Alt+Shift+C'],
    scope: 'sales',
    labelKey: 'sales.closeCashSession',
    roles: ['admin', 'manager', 'cashier'],
  },

  // fast-cash rapid checkout. F2 opens the payment
  // modal in exact-cash mode (paymentMethod=cash + amountReceived
  // = grand total + Confirmar focused) for a one-keystroke checkout
  // on the most common LATAM-retail case. When the modal is already
  // open, F2 re-applies the exact amount on top of whatever was
  // tipped — the imperative handler decides the in-modal behaviour.
  {
    id: 'sales.fastCash',
    keys: ['F2'],
    scope: 'sales',
    labelKey: 'sales.fastCash',
    roles: ['admin', 'manager', 'cashier'],
  },
];

/**
 * Return the shortcut entry with the given id, or `undefined` if
 * it is not in the catalogue. Callers must handle `undefined` —
 * a typo in an id should be visible at the call site, not
 * silently produce a wrong shortcut hint.
 */
export function getShortcutById(id: string): ShortcutDefinition | undefined {
  return SHORTCUTS.find(s => s.id === id);
}

/** Return the registered global-navigation shortcut for an exact route. */
export function getShortcutByRoute(route: string): ShortcutDefinition | undefined {
  return SHORTCUTS.find(shortcut => shortcut.route === route);
}

/** Return the canonical aria-keyshortcuts value for an exact route. */
export function ariaKeyshortcutsForRoute(
  route: string,
  mac: boolean = isMacPlatform()
): string | undefined {
  const shortcut = getShortcutByRoute(route);
  return shortcut ? formatKeysForAria(shortcut.keys, mac) : undefined;
}

/**
 * Detect whether the renderer is running on macOS. Used by the
 * `Mod` modifier resolver below.
 *
 * NOTE: `navigator.platform` is deprecated but still the most
 * reliable signal for the meta-modifier on every Electron version
 * we ship today. `navigator.userAgentData` is not yet available
 * everywhere the renderer runs, so we keep the legacy field.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform ?? '';
  return /Mac/i.test(platform);
}

/**
 * Render a key combination as a human-readable string. `Mod`
 * resolves to `⌘` on macOS and `Ctrl` on every other platform.
 *
 * @example
 * formatKeysForDisplay(['Mod+K'])      → '⌘K' (mac) / 'Ctrl+K'
 * formatKeysForDisplay(['F1'])         → 'F1'
 * formatKeysForDisplay(['Mod+Shift+P'])→ '⌘⇧P' (mac) / 'Ctrl+Shift+P'
 */
export function formatKeysForDisplay(keys: ShortcutKey[], mac: boolean = isMacPlatform()): string {
  if (keys.length === 0) return '';
  const first = keys[0]!;
  const parts = first.split('+');
  const out: string[] = [];
  for (const part of parts) {
    if (part === 'Mod') {
      out.push(mac ? '⌘' : 'Ctrl');
    } else if (part === 'Shift') {
      out.push(mac ? '⇧' : 'Shift');
    } else if (part === 'Alt') {
      out.push(mac ? '⌥' : 'Alt');
    } else if (part === 'Control') {
      out.push(mac ? '⌃' : 'Ctrl');
    } else if (part === 'Meta') {
      out.push(mac ? '⌘' : 'Win');
    } else {
      out.push(part);
    }
  }
  // macOS conventionally joins modifier symbols with no separator
  // (⌘⇧P); other platforms use `+` (Ctrl+Shift+P).
  return mac ? out.join('') : out.join('+');
}

/**
 * Render a key combination as a value suitable for
 * `aria-keyshortcuts`. The WAI-ARIA spec requires modifier names
 * in canonical CamelCase (`Control`, `Shift`, `Alt`, `Meta`) and
 * `+` as the join character. The `Mod` placeholder resolves to the
 * key the operator actually presses: `Meta` on macOS, `Control`
 * elsewhere.
 *
 * @example
 * formatKeysForAria(['Mod+P'])        → 'Meta+P' (mac) / 'Control+P'
 * formatKeysForAria(['F1'])           → 'F1'
 * formatKeysForAria(['Mod+Shift+P'])  → 'Meta+Shift+P' (mac) / 'Control+Shift+P'
 */
export function formatKeysForAria(keys: ShortcutKey[], mac: boolean = isMacPlatform()): string {
  if (keys.length === 0) return '';
  return keys
    .map(k =>
      k
        .split('+')
        .map(part => (part === 'Mod' ? (mac ? 'Meta' : 'Control') : part))
        .join('+')
    )
    .join(' ');
}

/**
 * Return the canonical aria-keyshortcuts attribute value for a
 * given catalogue id. Returns `undefined` when the id is not
 * registered — callers should omit the attribute rather than
 * stamp an empty string.
 */
export function ariaKeyshortcutsFor(
  id: string,
  mac: boolean = isMacPlatform()
): string | undefined {
  const def = getShortcutById(id);
  if (!def) return undefined;
  return formatKeysForAria(def.keys, mac);
}

/**
 * Match a `KeyboardEvent` against a `ShortcutDefinition.keys`
 * entry. Used by the global listener in
 * `CommandPaletteProvider.tsx` (and reusable by any future
 * imperative handler that wants to read the catalogue).
 *
 * The matcher accepts BOTH `Ctrl` and `Meta` as `Mod` on
 * non-macOS to gracefully handle external keyboards mapped to
 * either modifier.
 */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: ShortcutDefinition,
  mac: boolean = isMacPlatform()
): boolean {
  return shortcut.keys.some(combo => matchesSingleCombo(event, combo, mac));
}

function matchesSingleCombo(event: KeyboardEvent, combo: string, mac: boolean): boolean {
  const parts = combo.split('+');
  const finalKey = parts[parts.length - 1]!;
  const required = new Set(parts.slice(0, -1));

  const needsMod = required.has('Mod');
  const needsShift = required.has('Shift');
  const needsAlt = required.has('Alt');
  const needsControl = required.has('Control');
  const needsMeta = required.has('Meta');

  // Mod resolves to Cmd on macOS, Ctrl elsewhere. On non-macOS we
  // also accept Meta so an external mac keyboard plugged into a
  // Windows box still works.
  if (needsMod) {
    const modPressed = mac ? event.metaKey : event.ctrlKey || event.metaKey;
    if (!modPressed) return false;
  } else {
    // `Mod` not required → reject if either of the OS-level modifiers
    // is actively pressed (so Ctrl+F1 does not fire when F1 was
    // declared alone). Exception: when the combo explicitly demands
    // Control or Meta, the dedicated check below handles it.
    if (!needsControl && !needsMeta) {
      // Allow Ctrl/Meta to also be ABSENT when not required.
      if (event.ctrlKey || event.metaKey) return false;
    }
  }
  if (needsControl && !event.ctrlKey) return false;
  if (needsMeta && !event.metaKey) return false;
  if (needsShift !== event.shiftKey) return false;
  if (needsAlt !== event.altKey) return false;

  // Compare the final key case-insensitively. `KeyboardEvent.key`
  // is already platform-agnostic for printable characters...
  if (event.key.toLowerCase() === finalKey.toLowerCase()) return true;

  // ...EXCEPT under Alt on macOS, where the OS composes an alternate
  // character (Alt+P → 'π', Alt+N → dead tilde) and `key` never
  // matches. Rescue ONLY that case: the combo must require Alt, and
  // the reported key must be a composed/named character rather than a
  // plain printable — a printable `key` is a deliberate label press on
  // the user's layout and must never be remapped by physical position
  // (on AZERTY the physical KeyQ types 'a'; remapping it would fire
  // Alt+Q-logout on a cashier pressing the labeled Alt+A). Numpad
  // codes are deliberately excluded: with NumLock off they report
  // navigation keys (End/PageDown), which are composed-looking but
  // mean navigation, not digits.
  if (!needsAlt) return false;
  if (isPlainPrintableKey(event.key)) return false;
  const code = event.code ?? '';
  if (/^[a-z]$/i.test(finalKey)) {
    return code === `Key${finalKey.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(finalKey)) {
    return code === `Digit${finalKey}`;
  }
  if (finalKey === '/') {
    return code === 'Slash';
  }
  return false;
}

/** A single printable ASCII character — a deliberate label press. */
function isPlainPrintableKey(key: string): boolean {
  return key.length === 1 && key.charCodeAt(0) >= 0x20 && key.charCodeAt(0) <= 0x7e;
}

/**
 * The letter the operator MEANT under an Alt chord. Printable keys win
 * (label semantics, layout-respecting); composed/dead characters fall
 * back to the physical `event.code` letter so macOS Alt-composition
 * does not swallow the chord. Shared by every imperative Alt handler
 * so the two matching systems cannot diverge.
 */
export function altChordLetter(event: KeyboardEvent): string {
  if (isPlainPrintableKey(event.key)) {
    return event.key.toLowerCase();
  }
  const code = event.code ?? '';
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3).toLowerCase();
  }
  return event.key.toLowerCase();
}

/**
 * True while any modal dialog owns the page. Both window-level
 * shortcut listeners (Command Palette, GlobalShortcutsProvider) apply
 * the same policy through this ONE helper: shortcuts never act
 * "through" an open dialog.
 */
export function hasOpenModalDialog(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}
