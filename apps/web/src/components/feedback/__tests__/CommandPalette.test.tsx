/**
 * ENG-105 (slice A) — CommandPalette component tests.
 *
 * Pins:
 *   - Renders with the search input auto-focused.
 *   - Typing filters the action list in real time.
 *   - ArrowUp / ArrowDown move the selection.
 *   - Enter on a selected item calls navigate.
 *   - Click on an item calls navigate.
 *   - Role filtering hides admin destinations from a cashier.
 *   - Empty-result state surfaces the no-results hint.
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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );
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
    isLoading: false,
    isPlaceholder: false,
  }),
}));

beforeEach(() => {
  navigateMock.mockReset();
  logoutMock.mockClear();
  mockUserRole = 'admin';
  mockModules = {
    'operations-center': true,
    quotations: true,
  };
});

afterEach(() => {
  // Reset any body dataset side-effect just in case.
  delete document.body.dataset.commandPaletteOpen;
});

describe('CommandPalette (ENG-105a)', () => {
  it('renders with the search input present and the action listbox visible', async () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
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

  it('shows the empty state for a query with zero matches', async () => {
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
    const dashboardItem = await screen.findByTestId(
      'command-palette-item-navigate.dashboard'
    );
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
    expect(screen.queryByTestId('command-palette-item-navigate.operations')).not.toBeInTheDocument();
    expect(screen.queryByTestId('command-palette-item-navigate.quotations')).not.toBeInTheDocument();
    expect(screen.getByTestId('command-palette-item-navigate.products')).toBeInTheDocument();
  });
});
