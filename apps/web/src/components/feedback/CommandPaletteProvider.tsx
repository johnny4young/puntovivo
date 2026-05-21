/**
 * ENG-105 (slice A) — Command Palette context + global listener.
 *
 * Mounts `<CommandPalette />` once at the top of the React tree and
 * registers a single `keydown` listener for `Mod+K` (Cmd on macOS,
 * Ctrl or Meta elsewhere) that toggles the modal open / closed.
 *
 * The provider sits BELOW `AuthProvider` so it can read the active
 * auth state. The palette body reads the active role + logout
 * handler from the same context when it is mounted.
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
import { useAuth } from '@/features/auth/AuthProvider';
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
  const { isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const paletteIsOpen = isAuthenticated && isOpen;
  const openPalette = useCallback(() => {
    if (isAuthenticated) {
      setIsOpen(true);
    }
  }, [isAuthenticated]);
  const closePalette = useCallback(() => setIsOpen(false), []);
  const togglePalette = useCallback(() => {
    if (isAuthenticated) {
      setIsOpen(open => !open);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const shortcut = getShortcutById('palette.open');
    if (!shortcut) return;
    const handler = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, shortcut)) return;
      if (paletteIsOpen) {
        event.preventDefault();
        setIsOpen(false);
        return;
      }

      // Skip when another modal owns focus. Stacking the palette on
      // top of a payment/search/confirm modal creates dueling focus
      // traps; the palette itself is handled by the `isOpen` branch.
      const anotherModalIsOpen = document.querySelector(
        '[role="dialog"][aria-modal="true"]'
      );
      if (anotherModalIsOpen) {
        return;
      }

      event.preventDefault();
      setIsOpen(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isAuthenticated, paletteIsOpen]);

  // Mark the body whenever the palette is open so the global
  // listener above knows to short-circuit. Pairs with the
  // shared `Modal`'s own focus management — we use a dedicated
  // dataset key to avoid colliding with future modal frameworks.
  useEffect(() => {
    if (paletteIsOpen) {
      document.body.dataset.commandPaletteOpen = 'true';
    } else {
      delete document.body.dataset.commandPaletteOpen;
    }
    return () => {
      delete document.body.dataset.commandPaletteOpen;
    };
  }, [paletteIsOpen]);

  const value = useMemo<CommandPaletteContextValue>(
    () => ({
      isOpen: paletteIsOpen,
      openPalette,
      closePalette,
      togglePalette,
    }),
    [paletteIsOpen, openPalette, closePalette, togglePalette]
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandPalette isOpen={paletteIsOpen} onClose={closePalette} />
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
