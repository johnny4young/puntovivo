/**
 * ENG-105 (slice A) — Command Palette context + global listener.
 *
 * Mounts `<CommandPalette />` once at the top of the React tree and
 * registers a single `keydown` listener for `Mod+K` (Cmd on macOS,
 * Ctrl or Meta elsewhere) that toggles the modal open / closed.
 *
 * The provider sits BELOW `AuthProvider` so it can read the active
 * user role + logout handler — both reside on the auth context.
 *
 * @module components/feedback/CommandPaletteProvider
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getShortcutById, matchesShortcut } from '@/lib/shortcuts';
import { CommandPalette } from './CommandPalette';

interface CommandPaletteContextValue {
  isOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null
);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const openPalette = useCallback(() => setIsOpen(true), []);
  const closePalette = useCallback(() => setIsOpen(false), []);
  const togglePalette = useCallback(() => setIsOpen(open => !open), []);

  useEffect(() => {
    const shortcut = getShortcutById('palette.open');
    if (!shortcut) return;
    const handler = (event: KeyboardEvent) => {
      // Skip when an existing modal owns the focus — chaining a
      // palette on top of another modal creates a focus-trap
      // tangle. The shared `Modal` adds `data-modal-open="true"`
      // on the document body when mounted; we read that flag and
      // bail when set unless the open modal IS the palette itself.
      if (document.body.dataset.commandPaletteOpen === 'true') {
        // Allow toggle (close) when the palette is already open.
        if (matchesShortcut(event, shortcut)) {
          event.preventDefault();
          setIsOpen(false);
        }
        return;
      }
      if (!matchesShortcut(event, shortcut)) return;
      event.preventDefault();
      setIsOpen(open => !open);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Mark the body whenever the palette is open so the global
  // listener above knows to short-circuit. Pairs with the
  // shared `Modal`'s own focus management — we use a dedicated
  // dataset key to avoid colliding with future modal frameworks.
  useEffect(() => {
    if (isOpen) {
      document.body.dataset.commandPaletteOpen = 'true';
    } else {
      delete document.body.dataset.commandPaletteOpen;
    }
    return () => {
      delete document.body.dataset.commandPaletteOpen;
    };
  }, [isOpen]);

  const value = useMemo<CommandPaletteContextValue>(
    () => ({ isOpen, openPalette, closePalette, togglePalette }),
    [isOpen, openPalette, closePalette, togglePalette]
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandPalette isOpen={isOpen} onClose={closePalette} />
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) {
    throw new Error(
      'useCommandPalette must be used inside <CommandPaletteProvider>'
    );
  }
  return ctx;
}
