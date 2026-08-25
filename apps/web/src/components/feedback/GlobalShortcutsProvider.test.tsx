/**
 * Global shortcuts contract (atajos reales): navigation combos route,
 * the sheet toggles on Alt+/, editable targets are respected, and the
 * theme toggle flips the resolved preference.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { render } from '@/test/utils';
import { GlobalShortcutsProvider } from './GlobalShortcutsProvider';

const navigateMock = vi.fn();
vi.mock('react-router', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigateMock };
});

const logoutMock = vi.fn(async () => undefined);
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: 'u1', role: 'admin' },
    logout: logoutMock,
  }),
}));

const switchSiteMock = vi.fn(async () => undefined);
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentSite: { id: 's1', name: 'Norte', isActive: true },
    sites: [
      { id: 's1', name: 'Norte', isActive: true },
      { id: 's2', name: 'Sur', isActive: true },
    ],
    switchSite: switchSiteMock,
  }),
}));

const setPreferenceMock = vi.fn(async () => undefined);
vi.mock('@/components/feedback/ThemeProvider', () => ({
  useTheme: () => ({
    preference: 'system',
    resolvedTheme: 'light',
    isLoading: false,
    setPreference: setPreferenceMock,
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

function fireKey(key: string, options: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('GlobalShortcutsProvider', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  it('navigates on Alt+1..4', () => {
    render(<GlobalShortcutsProvider />);

    fireKey('2', { altKey: true, code: 'Digit2' });
    expect(navigateMock).toHaveBeenCalledWith('/sales');

    fireKey('4', { altKey: true, code: 'Digit4' });
    expect(navigateMock).toHaveBeenCalledWith('/purchases');
  });

  it('navigates even when macOS composes the digit into a symbol', () => {
    render(<GlobalShortcutsProvider />);
    // Alt+1 can report '¡' as key on mac layouts; Digit1 survives.
    fireKey('¡', { altKey: true, code: 'Digit1' });
    expect(navigateMock).toHaveBeenCalledWith('/dashboard');
  });

  it('toggles the shortcut sheet on Alt+/', async () => {
    render(<GlobalShortcutsProvider />);

    fireKey('/', { altKey: true, code: 'Slash' });
    expect(await screen.findByTestId('shortcuts-sheet')).toBeInTheDocument();
    // The sheet lists the register group with a visible combo chip.
    expect(screen.getByText('Charge')).toBeInTheDocument();

    fireKey('/', { altKey: true, code: 'Slash' });
    expect(screen.queryByTestId('shortcuts-sheet')).not.toBeInTheDocument();
  });

  it('opens the sheet from Spanish layouts where / is Shift+7', async () => {
    render(<GlobalShortcutsProvider />);
    // es-LA: Alt+Shift+7 produces key '/' with shiftKey true.
    fireKey('/', { altKey: true, shiftKey: true, code: 'Digit7' });
    expect(await screen.findByTestId('shortcuts-sheet')).toBeInTheDocument();
  });

  it('never OPENS the sheet while another modal owns the page', () => {
    render(<GlobalShortcutsProvider />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);

    fireKey('/', { altKey: true, code: 'Slash' });
    expect(screen.queryByTestId('shortcuts-sheet')).not.toBeInTheDocument();
  });

  it('never fires from an editable target', () => {
    render(<GlobalShortcutsProvider />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: '2',
      code: 'Digit2',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('flips the theme on Alt+Shift+D', () => {
    render(<GlobalShortcutsProvider />);
    fireKey('D', { altKey: true, shiftKey: true, code: 'KeyD' });
    expect(setPreferenceMock).toHaveBeenCalledWith('dark');
  });

  it('cycles to the next active site on Alt+Shift+S', () => {
    render(<GlobalShortcutsProvider />);
    fireKey('S', { altKey: true, shiftKey: true, code: 'KeyS' });
    expect(switchSiteMock).toHaveBeenCalledWith('s2');
  });

  it('Alt+Q asks for confirmation before logging out', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<GlobalShortcutsProvider />);

    fireKey('q', { altKey: true, code: 'KeyQ' });
    expect(logoutMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId('logout-confirm')).toBeInTheDocument();
    const accept = document.getElementById('logout-confirm-accept');
    expect(accept).not.toBeNull();
    await user.click(accept!);
    expect(logoutMock).toHaveBeenCalledOnce();
  });

  it('never remaps a printable key by physical position (AZERTY safety)', () => {
    render(<GlobalShortcutsProvider />);
    // AZERTY labeled Alt+A: key 'a' printable, physical code KeyQ.
    // Remapping by code would fire Alt+Q logout on a cashier opening
    // their register - the printable key must win and match nothing.
    fireKey('a', { altKey: true, code: 'KeyQ' });
    expect(logoutMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('logout-confirm')).not.toBeInTheDocument();
  });

  it('does not act through an open modal (except the sheet toggle)', () => {
    render(<GlobalShortcutsProvider />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);

    fireKey('2', { altKey: true, code: 'Digit2' });
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
