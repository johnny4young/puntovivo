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
import { render, screen, act, renderHook, waitFor } from '@/test/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPaletteProvider, useCommandPalette } from '../CommandPaletteProvider';

let mockIsAuthenticated = true;
let mockRole = 'admin';

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
    user: { id: 'user-1', email: 'admin@example.com', role: mockRole, tenantId: 't' },
    logout: vi.fn(async () => undefined),
  }),
}));

// ENG-203 — the palette body wires the omnibox sell handler (trpc + cart
// store underneath); mock it so this suite stays network-free and can
// assert the synthetic row's activation contract.
const omniboxSellMock = vi.fn(async () => undefined);
vi.mock('@/features/sales/useOmniboxSell', () => ({
  useOmniboxSell: () => omniboxSellMock,
}));

vi.mock('@/features/modules', () => ({
  useModulesSnapshot: () => ({
    modules: {
      'operations-center': true,
      quotations: true,
    },
    isLoading: false,
    isPlaceholder: false,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      products: { lookupByBarcode: { fetch: vi.fn(async () => null) } },
    }),
    products: {
      search: {
        useQuery: () => ({ data: { items: [] }, isFetching: false }),
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

beforeEach(() => {
  mockIsAuthenticated = true;
  mockRole = 'admin';
  omniboxSellMock.mockClear();
  // Spoof a non-mac platform so the listener interprets `Mod` as
  // `Ctrl` and the dispatched KeyboardEvent below matches.
  Object.defineProperty(navigator, 'platform', {
    value: 'Linux x86_64',
    configurable: true,
  });
});

afterEach(() => {
  delete document.body.dataset.commandPaletteOpen;
  document.querySelector('[data-test-owned-dialog]')?.remove();
  document.querySelector('[data-test-detached-opener]')?.remove();
  window.history.pushState({}, '', '/');
});

function dispatchKey(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', init));
  });
}

function dispatchKeyFrom(element: HTMLElement, init: KeyboardEventInit) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true }));
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

  it('does not open while unauthenticated', () => {
    mockIsAuthenticated = false;
    render(
      <CommandPaletteProvider>
        <div>login shell</div>
      </CommandPaletteProvider>
    );
    dispatchKey({ key: 'k', ctrlKey: true });
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });

  it('does not stack on top of another open modal', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('data-test-owned-dialog', 'true');
    document.body.append(dialog);
    render(
      <CommandPaletteProvider>
        <div>app shell</div>
      </CommandPaletteProvider>
    );
    dispatchKey({ key: 'k', ctrlKey: true });
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });

  it('does not steal Mod+K from editable fields', () => {
    render(
      <CommandPaletteProvider>
        <input data-testid="editable-field" />
      </CommandPaletteProvider>
    );
    const input = screen.getByTestId('editable-field');
    input.focus();
    dispatchKeyFrom(input, { key: 'k', ctrlKey: true });
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(input);
  });

  it('preserves the POS Mod+K contract from the sales product search', async () => {
    render(
      <CommandPaletteProvider>
        <input id="sales-product-search-input" data-testid="sales-search" />
      </CommandPaletteProvider>
    );
    const input = screen.getByTestId('sales-search');
    input.focus();
    dispatchKeyFrom(input, { key: 'k', ctrlKey: true });
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument();
  });

  it('prefers the sales search target after a cross-route palette action', async () => {
    window.history.pushState({}, '', '/sales');
    render(
      <CommandPaletteProvider>
        <button type="button" data-testid="connected-opener">
          Open
        </button>
        <input id="sales-product-search-input" data-testid="sales-search" />
      </CommandPaletteProvider>
    );
    screen.getByTestId('connected-opener').focus();

    dispatchKey({ key: 'k', ctrlKey: true });
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument();
    dispatchKey({ key: 'k', ctrlKey: true });

    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('sales-search')));
  });

  it('falls back to the sales search input when the opener detached before close', async () => {
    window.history.pushState({}, '', '/sales');
    const opener = document.createElement('button');
    opener.textContent = 'Detached opener';
    opener.dataset.testDetachedOpener = 'true';
    document.body.append(opener);
    render(
      <CommandPaletteProvider>
        <input id="sales-product-search-input" data-testid="sales-search" />
      </CommandPaletteProvider>
    );
    opener.focus();

    dispatchKey({ key: 'k', ctrlKey: true });
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument();
    opener.remove();
    dispatchKey({ key: 'k', ctrlKey: true });

    const salesSearch = screen.getByTestId('sales-search');
    await waitFor(() => expect(document.activeElement).toBe(salesSearch));
  });

  it('useCommandPalette throws outside the provider', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useCommandPalette())).toThrow(/CommandPaletteProvider/);
    errSpy.mockRestore();
  });
});

describe('omnibox sell row (ENG-203)', () => {
  async function openPaletteAndType(query: string) {
    render(
      <CommandPaletteProvider>
        <div />
      </CommandPaletteProvider>
    );
    dispatchKey({ key: 'k', ctrlKey: true });
    const search = await screen.findByTestId('command-palette-search');
    act(() => {
      (search as HTMLInputElement).focus();
    });
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().type(search, query);
    return search;
  }

  it('appends the sell row last and fires the omnibox handler on activation', async () => {
    await openPaletteAndType('7702001');

    const sellRow = await screen.findByTestId('command-palette-item-sales.sellQuery');
    expect(sellRow).toHaveTextContent('Sell 7702001');
    const options = screen.getAllByRole('option');
    expect(options[options.length - 1]).toBe(sellRow);

    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(sellRow);
    expect(omniboxSellMock).toHaveBeenCalledWith('7702001', expect.anything());
    // The palette closes on activation.
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });

  it('does not offer the sell row to viewers', async () => {
    mockRole = 'viewer';
    await openPaletteAndType('7702001');

    expect(
      screen.queryByTestId('command-palette-item-sales.sellQuery')
    ).not.toBeInTheDocument();
  });

  it('does not offer the sell row while the query is empty', async () => {
    render(
      <CommandPaletteProvider>
        <div />
      </CommandPaletteProvider>
    );
    dispatchKey({ key: 'k', ctrlKey: true });
    await screen.findByTestId('command-palette');

    expect(
      screen.queryByTestId('command-palette-item-sales.sellQuery')
    ).not.toBeInTheDocument();
  });
});
