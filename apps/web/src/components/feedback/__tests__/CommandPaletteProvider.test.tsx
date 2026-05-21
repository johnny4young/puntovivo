/**
 * ENG-105 (slice A) — CommandPaletteProvider tests.
 *
 * Pins:
 *   - Mod+K (Ctrl on non-mac) opens the palette.
 *   - A second Mod+K closes it (toggle).
 *   - The provider sets / clears the `data-command-palette-open`
 *     body dataset flag in lockstep with `isOpen`.
 *   - `useCommandPalette` throws when invoked outside the provider.
 *
 * @module components/feedback/__tests__/CommandPaletteProvider.test
 */
import { render, screen, act, renderHook } from '@/test/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandPaletteProvider,
  useCommandPalette,
} from '../CommandPaletteProvider';

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'admin@example.com', role: 'admin', tenantId: 't' },
    logout: vi.fn(async () => undefined),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

beforeEach(() => {
  // Spoof a non-mac platform so the listener interprets `Mod` as
  // `Ctrl` and the dispatched KeyboardEvent below matches.
  Object.defineProperty(navigator, 'platform', {
    value: 'Linux x86_64',
    configurable: true,
  });
});

afterEach(() => {
  delete document.body.dataset.commandPaletteOpen;
});

function dispatchKey(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', init));
  });
}

describe('CommandPaletteProvider (ENG-105a)', () => {
  it('opens the palette on Ctrl+K (non-mac Mod)', async () => {
    render(
      <CommandPaletteProvider>
        <div>app shell</div>
      </CommandPaletteProvider>
    );
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
    dispatchKey({ key: 'k', ctrlKey: true });
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument();
    expect(document.body.dataset.commandPaletteOpen).toBe('true');
  });

  it('toggles off on a second Ctrl+K press', async () => {
    render(
      <CommandPaletteProvider>
        <div>app shell</div>
      </CommandPaletteProvider>
    );
    dispatchKey({ key: 'k', ctrlKey: true });
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument();
    dispatchKey({ key: 'k', ctrlKey: true });
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
    expect(document.body.dataset.commandPaletteOpen).toBeUndefined();
  });

  it('useCommandPalette throws outside the provider', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useCommandPalette())).toThrow(
      /CommandPaletteProvider/
    );
    errSpy.mockRestore();
  });
});
