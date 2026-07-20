/**
 * (slice A) — CommandPalette component tests.
 *
 * Pins:
 * - Renders with the search input auto-focused.
 * - Typing filters the action list in real time.
 * - ArrowUp / ArrowDown move the selection.
 * - Enter on a selected item calls navigate.
 * - Click on an item calls navigate.
 * - Role filtering hides admin destinations from a cashier.
 * - Empty-result state surfaces the no-results hint.
 *
 * @module components/feedback/__tests__/CommandPalette.test
 */
import { fireEvent, render, screen, waitFor } from '@/test/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../CommandPalette';

const navigateMock = vi.fn();
const logoutMock = vi.fn(async () => undefined);
let mockUserRole: 'admin' | 'manager' | 'cashier' | 'viewer' = 'admin';
let mockModules = {
  'operations-center': true,
  quotations: true,
} as Record<string, boolean>;
let mockModulesPlaceholder = false;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: `${mockUserRole}@example.com`,
      role: mockUserRole,
      tenantId: 'tenant-1',
    },
    logout: logoutMock,
  }),
}));

vi.mock('@/features/modules', () => ({
  useModulesSnapshot: () => ({
    modules: mockModules,
    isLoading: mockModulesPlaceholder,
    isPlaceholder: mockModulesPlaceholder,
  }),
}));

// the palette body wires the omnibox sell handler (trpc + cart
// store underneath); mock it so this suite stays network-free. Its behavior
// is pinned in CommandPaletteProvider.test.tsx and useOmniboxSell.test.ts.
vi.mock('@/features/sales/useOmniboxSell', () => ({
  useOmniboxSell: () => vi.fn(async () => undefined),
}));

beforeEach(() => {
  navigateMock.mockReset();
  logoutMock.mockClear();
  mockUserRole = 'admin';
  mockModules = {
    'operations-center': true,
    quotations: true,
  };
  mockModulesPlaceholder = false;
});

afterEach(() => {
  // Reset any body dataset side-effect just in case.
  delete document.body.dataset.commandPaletteOpen;
});

describe('CommandPalette', () => {
  it('renders with the search input present and the action listbox visible', async () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
    const input = await screen.findByTestId('command-palette-search');
    expect(input).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('command-palette-item-navigate.dashboard')).toBeInTheDocument();
    });
  });

  it('filters the list as the user types', async () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    const input = await screen.findByTestId('command-palette-search');
    fireEvent.change(input, { target: { value: 'audit' } });
    expect(screen.queryByTestId('command-palette-item-navigate.auditLogs')).toBeInTheDocument();
    expect(screen.queryByTestId('command-palette-item-navigate.products')).not.toBeInTheDocument();
  });

  it('offers the omnibox sell row instead of an empty state for selling roles', async () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    const input = await screen.findByTestId('command-palette-search');
    fireEvent.change(input, { target: { value: 'xyzqq' } });
    expect(screen.queryByTestId('command-palette-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('command-palette-item-sales.sellQuery')).toBeInTheDocument();
  });

  it('shows the empty state for a zero-match query when the viewer cannot sell', async () => {
    mockUserRole = 'viewer';
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    const input = await screen.findByTestId('command-palette-search');
    fireEvent.change(input, { target: { value: 'xyzqq' } });
    expect(screen.getByTestId('command-palette-empty')).toBeInTheDocument();
  });

  it('ArrowDown advances the aria-selected option', async () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    const container = await screen.findByTestId('command-palette');
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    // The first three items by registration order are dashboard, sales, products.
    const products = screen.getByTestId('command-palette-item-navigate.products');
    expect(products.getAttribute('aria-selected')).toBe('true');
  });

  it('Enter on the highlighted item calls navigate and closes via onClose', async () => {
    const onClose = vi.fn();
    render(<CommandPalette isOpen onClose={onClose} />);
    const container = await screen.findByTestId('command-palette');
    const input = screen.getByTestId('command-palette-search');
    fireEvent.change(input, { target: { value: 'audit' } });
    fireEvent.keyDown(container, { key: 'Enter' });
    expect(navigateMock).toHaveBeenCalledWith('/audit-logs');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('click on an item fires its perform() and closes the palette', async () => {
    const onClose = vi.fn();
    render(<CommandPalette isOpen onClose={onClose} />);
    const dashboardItem = await screen.findByTestId('command-palette-item-navigate.dashboard');
    fireEvent.click(dashboardItem);
    expect(navigateMock).toHaveBeenCalledWith('/dashboard');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides admin-only destinations when the user is a cashier', async () => {
    mockUserRole = 'cashier';
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    await screen.findByTestId('command-palette-search');
    expect(screen.queryByTestId('command-palette-item-navigate.sales')).toBeInTheDocument();
    expect(screen.queryByTestId('command-palette-item-navigate.auditLogs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('command-palette-item-navigate.company')).not.toBeInTheDocument();
    expect(screen.queryByTestId('command-palette-item-navigate.users')).not.toBeInTheDocument();
  });

  it('hides module-gated destinations when the tenant module is disabled', async () => {
    mockModules = {
      'operations-center': false,
      quotations: false,
    };
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    await screen.findByTestId('command-palette-search');
    expect(
      screen.queryByTestId('command-palette-item-navigate.operations')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('command-palette-item-navigate.quotations')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('command-palette-item-navigate.products')).toBeInTheDocument();
  });

  it('hides module-gated destinations while the module snapshot is still hydrating', async () => {
    mockModulesPlaceholder = true;
    mockModules = {
      'operations-center': true,
      quotations: true,
      copilot: true,
    };
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    await screen.findByTestId('command-palette-search');
    expect(screen.queryByTestId('command-palette-item-navigate.coPilot')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('command-palette-item-navigate.operations')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('command-palette-item-navigate.quotations')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('command-palette-item-navigate.products')).toBeInTheDocument();
  });

  // wrap-around navigation.
  describe(' wrap-around', () => {
    it('ArrowDown from the last item wraps back to the first', async () => {
      render(<CommandPalette isOpen onClose={vi.fn()} />);
      const container = await screen.findByTestId('command-palette');
      // Walk to the last item via End — the absolute-jump path stays
      // intact and gives us a stable anchor to test wrap-around from.
      fireEvent.keyDown(container, { key: 'End' });
      const list = screen.getByRole('listbox');
      const lastItem = list.querySelectorAll('[role="option"]')[
        list.querySelectorAll('[role="option"]').length - 1
      ] as HTMLElement;
      expect(lastItem.getAttribute('aria-selected')).toBe('true');

      // One more ArrowDown wraps back to the first item.
      fireEvent.keyDown(container, { key: 'ArrowDown' });
      const firstItem = list.querySelector('[role="option"]') as HTMLElement;
      expect(firstItem.getAttribute('aria-selected')).toBe('true');
    });

    it('ArrowUp from the first item wraps to the last', async () => {
      render(<CommandPalette isOpen onClose={vi.fn()} />);
      const container = await screen.findByTestId('command-palette');
      // First item is selected on mount (index 0). ArrowUp must wrap.
      fireEvent.keyDown(container, { key: 'ArrowUp' });
      const list = screen.getByRole('listbox');
      const items = list.querySelectorAll('[role="option"]');
      const lastItem = items[items.length - 1] as HTMLElement;
      expect(lastItem.getAttribute('aria-selected')).toBe('true');
    });

    it('Home/End remain absolute jumps after wrap-around lands on edges', async () => {
      render(<CommandPalette isOpen onClose={vi.fn()} />);
      const container = await screen.findByTestId('command-palette');
      // Hit ArrowUp once so the highlight wraps to the last item …
      fireEvent.keyDown(container, { key: 'ArrowUp' });
      // … then Home jumps back to the first item (NOT a wrap-around
      // step but the legacy absolute behaviour).
      fireEvent.keyDown(container, { key: 'Home' });
      const list = screen.getByRole('listbox');
      const firstItem = list.querySelector('[role="option"]') as HTMLElement;
      expect(firstItem.getAttribute('aria-selected')).toBe('true');
    });
  });

  // Surface Switcher additions. Each surface action is
  // module-gated to mirror the route's RequireModule + role-gated
  // exactly like the matching sidebar item.
  describe(' Surface Switcher', () => {
    function enableSurfaceModules() {
      mockModules = {
        ...mockModules,
        'pos-touch': true,
        kds: true,
        'customer-display': true,
        'mobile-waiter': true,
      };
    }

    it('lists all 5 surface actions for an admin with surface modules enabled', async () => {
      enableSurfaceModules();
      render(<CommandPalette isOpen onClose={vi.fn()} />);
      await screen.findByTestId('command-palette-search');

      expect(screen.getByTestId('command-palette-item-navigate.posTouch')).toBeInTheDocument();
      expect(screen.getByTestId('command-palette-item-navigate.kds')).toBeInTheDocument();
      expect(
        screen.getByTestId('command-palette-item-navigate.customerDisplay')
      ).toBeInTheDocument();
      expect(screen.getByTestId('command-palette-item-navigate.mobileWaiter')).toBeInTheDocument();
      expect(
        screen.getByTestId('command-palette-item-navigate.restaurantTables')
      ).toBeInTheDocument();
    });

    it('hides restaurantTables for a cashier (admin-only gate) while keeping the 4 cashier surfaces', async () => {
      mockUserRole = 'cashier';
      enableSurfaceModules();
      render(<CommandPalette isOpen onClose={vi.fn()} />);
      await screen.findByTestId('command-palette-search');

      expect(screen.getByTestId('command-palette-item-navigate.posTouch')).toBeInTheDocument();
      expect(screen.getByTestId('command-palette-item-navigate.kds')).toBeInTheDocument();
      expect(
        screen.getByTestId('command-palette-item-navigate.customerDisplay')
      ).toBeInTheDocument();
      expect(screen.getByTestId('command-palette-item-navigate.mobileWaiter')).toBeInTheDocument();
      expect(
        screen.queryByTestId('command-palette-item-navigate.restaurantTables')
      ).not.toBeInTheDocument();
    });

    it('hides posTouch when the pos-touch module is disabled', async () => {
      mockModules = {
        ...mockModules,
        'pos-touch': false,
        kds: true,
      };
      render(<CommandPalette isOpen onClose={vi.fn()} />);
      await screen.findByTestId('command-palette-search');

      expect(
        screen.queryByTestId('command-palette-item-navigate.posTouch')
      ).not.toBeInTheDocument();
      // restaurantTables shares the pos-touch module gate, so it
      // hides alongside posTouch — verified here so a regression of
      // the shared gate is caught.
      expect(
        screen.queryByTestId('command-palette-item-navigate.restaurantTables')
      ).not.toBeInTheDocument();
      // kds stays visible because it has its own module flag.
      expect(screen.getByTestId('command-palette-item-navigate.kds')).toBeInTheDocument();
    });

    it('substring filter "touch" narrows to POS Touch only', async () => {
      enableSurfaceModules();
      render(<CommandPalette isOpen onClose={vi.fn()} />);
      const input = await screen.findByTestId('command-palette-search');
      fireEvent.change(input, { target: { value: 'touch' } });

      expect(screen.getByTestId('command-palette-item-navigate.posTouch')).toBeInTheDocument();
      // KDS / Customer Display / Mobile Waiter labels do not include
      // the substring, so they fall out of the filter.
      expect(screen.queryByTestId('command-palette-item-navigate.kds')).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('command-palette-item-navigate.customerDisplay')
      ).not.toBeInTheDocument();
    });

    it('Enter on the posTouch action navigates to /touch and closes the palette', async () => {
      enableSurfaceModules();
      const onClose = vi.fn();
      render(<CommandPalette isOpen onClose={onClose} />);
      const container = await screen.findByTestId('command-palette');
      const input = screen.getByTestId('command-palette-search');
      fireEvent.change(input, { target: { value: 'touch' } });
      fireEvent.keyDown(container, { key: 'Enter' });

      expect(navigateMock).toHaveBeenCalledWith('/touch');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // most-used / recent ordering. The Recent section only
  // exists when usage was recorded for THIS tenant; a clean storage
  // renders the exact pre- catalogue order (pinned below).
  describe('recent ordering', () => {
    const USAGE_KEY = 'palette_usage:tenant-1';

    const seedUsage = (usage: Record<string, { count: number; lastUsedAt: number }>) => {
      window.localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
    };

    beforeEach(() => {
      window.localStorage.removeItem(USAGE_KEY);
    });

    it('renders no Recent section and the original first item with a clean storage', async () => {
      render(<CommandPalette isOpen onClose={vi.fn()} />);
      await screen.findByTestId('command-palette');

      expect(screen.queryByTestId('command-palette-recent-header')).not.toBeInTheDocument();
      // The catalogue-order contract from  stays intact: the
      // first option is still the dashboard.
      const listbox = screen.getByRole('listbox');
      const firstOption = listbox.querySelector('[data-palette-item]');
      expect(firstOption?.id).toBe('command-palette-item-navigate.dashboard');
    });

    it('surfaces used actions in a Recent section ordered by count then recency, without duplicates', async () => {
      seedUsage({
        'navigate.products': { count: 5, lastUsedAt: 100 },
        'navigate.customers': { count: 2, lastUsedAt: 300 },
        'navigate.sales': { count: 2, lastUsedAt: 200 },
      });
      render(<CommandPalette isOpen onClose={vi.fn()} />);
      await screen.findByTestId('command-palette');

      expect(screen.getByTestId('command-palette-recent-header')).toBeInTheDocument();
      const listbox = screen.getByRole('listbox');
      const optionIds = Array.from(listbox.querySelectorAll('[data-palette-item]')).map(
        el => el.id
      );
      expect(optionIds.slice(0, 3)).toEqual([
        'command-palette-item-navigate.products',
        'command-palette-item-navigate.customers',
        'command-palette-item-navigate.sales',
      ]);
      // No duplicates: each used action appears exactly once.
      expect(optionIds.filter(id => id === 'command-palette-item-navigate.products')).toHaveLength(
        1
      );
      // The divider separates the section from the catalogue.
      expect(screen.getByTestId('command-palette-catalogue-divider')).toBeInTheDocument();
    });

    it('hides the Recent section while a query is active', async () => {
      seedUsage({ 'navigate.products': { count: 5, lastUsedAt: 100 } });
      render(<CommandPalette isOpen onClose={vi.fn()} />);
      await screen.findByTestId('command-palette');
      const input = screen.getByTestId('command-palette-search');

      fireEvent.change(input, { target: { value: 'prod' } });
      expect(screen.queryByTestId('command-palette-recent-header')).not.toBeInTheDocument();
    });

    it('caps the Recent section at five actions', async () => {
      seedUsage({
        'navigate.dashboard': { count: 9, lastUsedAt: 1 },
        'navigate.sales': { count: 8, lastUsedAt: 2 },
        'navigate.products': { count: 7, lastUsedAt: 3 },
        'navigate.customers': { count: 6, lastUsedAt: 4 },
        'navigate.inventory': { count: 5, lastUsedAt: 5 },
        'navigate.orders': { count: 4, lastUsedAt: 6 },
      });
      render(<CommandPalette isOpen onClose={vi.fn()} />);
      await screen.findByTestId('command-palette');

      const listbox = screen.getByRole('listbox');
      const optionIds = Array.from(listbox.querySelectorAll('[data-palette-item]')).map(
        el => el.id
      );
      // The sixth most-used action ranks below the divider, in its
      // normal catalogue position — not as a sixth recent entry.
      expect(optionIds[5]).not.toBe('command-palette-item-navigate.orders');
    });

    it('excludes role-gated actions from Recent even when usage exists (ranking runs after the gate)', async () => {
      mockUserRole = 'cashier';
      seedUsage({
        // Admin-only destination a previous admin session used on
        // this same device+tenant.
        'navigate.auditLogs': { count: 9, lastUsedAt: 100 },
        'navigate.sales': { count: 1, lastUsedAt: 1 },
      });
      render(<CommandPalette isOpen onClose={vi.fn()} />);
      await screen.findByTestId('command-palette');

      expect(
        screen.queryByTestId('command-palette-item-navigate.auditLogs')
      ).not.toBeInTheDocument();
      const listbox = screen.getByRole('listbox');
      const firstOption = listbox.querySelector('[data-palette-item]');
      expect(firstOption?.id).toBe('command-palette-item-navigate.sales');
    });

    it('records usage when an action is performed so the next open ranks it', async () => {
      const onClose = vi.fn();
      render(<CommandPalette isOpen onClose={onClose} />);
      const container = await screen.findByTestId('command-palette');

      // Activate the second item (sales) with the keyboard.
      fireEvent.keyDown(container, { key: 'ArrowDown' });
      fireEvent.keyDown(container, { key: 'Enter' });

      expect(navigateMock).toHaveBeenCalledWith('/sales');
      const stored = JSON.parse(window.localStorage.getItem(USAGE_KEY) ?? '{}') as Record<
        string,
        { count: number }
      >;
      expect(stored['navigate.sales']?.count).toBe(1);
    });
  });
});
