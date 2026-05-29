/**
 * ENG-131 (slice A) — Sidebar workspace-render contract tests.
 *
 * Pins the user-facing invariants of the workspace refactor:
 *
 *   - Admin sees the top-level Dashboard link plus exactly eight
 *     workspace headers.
 *   - Cashier sees only the Sell workspace (the other seven
 *     workspaces gate to manager or admin, and Dashboard is
 *     dashboardRoles which excludes cashier).
 *   - The workspace that contains the active route auto-expands.
 *   - Clicking a workspace header toggles aria-expanded.
 *   - localStorage preserves the collapsed state across mounts.
 *
 * @module components/layout/__tests__/Sidebar.test
 */
import { act, fireEvent, render, screen } from '@/test/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../Sidebar';

let mockUserRole: 'admin' | 'manager' | 'cashier' | 'viewer' = 'admin';
const allModulesOn = {
  copilot: true,
  'operations-center': true,
  quotations: true,
  delivery: true,
  'pos-touch': true,
  kds: true,
  'customer-display': true,
  'mobile-waiter': true,
  'anomaly-detection': true,
};
let mockModules: Record<string, boolean> = { ...allModulesOn };
let mockPathname = '/dashboard';
const { prefetchSalesMock } = vi.hoisted(() => ({
  prefetchSalesMock: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: `${mockUserRole}@example.com`,
      role: mockUserRole,
      tenantId: 'tenant-1',
    },
  }),
}));

vi.mock('@/features/modules', async () => {
  const actual = await vi.importActual<typeof import('@/features/modules')>(
    '@/features/modules'
  );
  return {
    ...actual,
    useModulesSnapshot: () => ({
      modules: mockModules,
      isLoading: false,
      isPlaceholder: false,
    }),
  };
});

vi.mock('@/lib/trpc', () => ({
  trpc: {
    ai: {
      anomalies: {
        list: {
          useQuery: () => ({ data: undefined, isLoading: false }),
        },
      },
    },
  },
}));

// ENG-171 — Sidebar now calls usePrefetchSales (trpc.useUtils + useTenant)
// for the /sales hover prefetch. Stub the hook to avoid wiring those
// providers; this suite pins that the visible sidebar anchors call it.
vi.mock('@/features/sales/usePrefetchSales', () => ({
  usePrefetchSales: () => prefetchSalesMock,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );
  return {
    ...actual,
    useLocation: () => ({ pathname: mockPathname, search: '', hash: '', state: null, key: 'k' }),
  };
});

const sidebarProps = {
  collapsed: false,
  mobileOpen: true,
  onToggleCollapse: () => {},
  onCloseMobile: () => {},
};

beforeEach(() => {
  mockUserRole = 'admin';
  mockModules = { ...allModulesOn };
  mockPathname = '/dashboard';
  prefetchSalesMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('Sidebar workspaces (ENG-131a)', () => {
  it('admin sees the Dashboard link plus 8 workspace headers', () => {
    render(<Sidebar {...sidebarProps} />);
    // Count every workspace header regardless of expanded state by
    // matching their stable test ids.
    const expanded = screen.queryAllByRole('button', { expanded: true });
    const collapsed = screen.queryAllByRole('button', { expanded: false });
    const headers = [...expanded, ...collapsed].filter(btn =>
      btn.getAttribute('data-testid')?.startsWith('sidebar-workspace-')
    );
    expect(headers).toHaveLength(8);
    // Dashboard link sits outside the workspace stack.
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('cashier sees only the Sell workspace and NO Dashboard link', () => {
    mockUserRole = 'cashier';
    render(<Sidebar {...sidebarProps} />);
    const sellHeader = screen.queryByTestId('sidebar-workspace-sell');
    expect(sellHeader).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-workspace-finance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-workspace-setup')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
  });

  it('auto-expands the workspace that contains the active route', () => {
    // /audit-logs lives in the Finance workspace.
    mockPathname = '/audit-logs';
    render(<Sidebar {...sidebarProps} />);
    const finance = screen.getByTestId('sidebar-workspace-finance');
    expect(finance.getAttribute('aria-expanded')).toBe('true');
    // Sell workspace is not the active one, so it stays collapsed.
    const sell = screen.getByTestId('sidebar-workspace-sell');
    expect(sell.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking a workspace header toggles aria-expanded and persists in localStorage', () => {
    render(<Sidebar {...sidebarProps} />);
    const operate = screen.getByTestId('sidebar-workspace-operate');
    expect(operate.getAttribute('aria-expanded')).toBe('false');
    act(() => {
      fireEvent.click(operate);
    });
    expect(operate.getAttribute('aria-expanded')).toBe('true');
    expect(
      window.localStorage.getItem('puntovivo:sidebar:workspace:operate:collapsed')
    ).toBe('false');
  });

  it('localStorage seed restores the collapsed state on next mount', () => {
    // The Catalog workspace would default to collapsed on /dashboard
    // (not the active workspace). Pre-seed it OPEN and check the
    // sidebar respects the seed on mount.
    window.localStorage.setItem(
      'puntovivo:sidebar:workspace:catalog:collapsed',
      'false'
    );
    render(<Sidebar {...sidebarProps} />);
    const catalog = screen.getByTestId('sidebar-workspace-catalog');
    expect(catalog.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the active workspace expanded even when localStorage says collapsed', () => {
    window.localStorage.setItem(
      'puntovivo:sidebar:workspace:finance:collapsed',
      'true'
    );
    mockPathname = '/audit-logs';
    render(<Sidebar {...sidebarProps} />);
    const finance = screen.getByTestId('sidebar-workspace-finance');
    expect(finance.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: /audit log/i })).toBeInTheDocument();
  });
});

describe('Sidebar workspace header navigation (ENG-131c)', () => {
  it('catalog, procurement, finance workspace headers render an anchor link to their landing route', () => {
    render(<Sidebar {...sidebarProps} />);
    const cases: Array<[string, string]> = [
      ['sidebar-workspace-link-catalog', '/catalog'],
      ['sidebar-workspace-link-procurement', '/procurement'],
      ['sidebar-workspace-link-finance', '/finance'],
    ];
    for (const [testId, expectedHref] of cases) {
      const link = screen.getByTestId(testId);
      expect(link.tagName).toBe('A');
      expect(link.getAttribute('href')).toBe(expectedHref);
    }
  });

  it('workspaces without a landing keep their header link pointing at the first item route', () => {
    render(<Sidebar {...sidebarProps} />);
    const cases: Array<[string, string]> = [
      ['sidebar-workspace-link-sell', '/sales'],
      ['sidebar-workspace-link-operate', '/operations'],
      ['sidebar-workspace-link-inventory', '/inventory'],
      ['sidebar-workspace-link-customers', '/customers'],
      ['sidebar-workspace-link-setup', '/company'],
    ];
    for (const [testId, expectedHref] of cases) {
      const link = screen.getByTestId(testId);
      expect(link.tagName).toBe('A');
      expect(link.getAttribute('href')).toBe(expectedHref);
    }
  });

  it('prefetches sales from the visible Sell workspace header link', () => {
    render(<Sidebar {...sidebarProps} />);

    const sellLink = screen.getByTestId('sidebar-workspace-link-sell');
    fireEvent.mouseEnter(sellLink);
    fireEvent.focus(sellLink);

    expect(prefetchSalesMock).toHaveBeenCalledTimes(2);
  });

  it('the chevron button remains the canonical aria-expanded disclosure surface', () => {
    render(<Sidebar {...sidebarProps} />);
    const chevron = screen.getByTestId('sidebar-workspace-catalog');
    expect(chevron.tagName).toBe('BUTTON');
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    expect(chevron.getAttribute('aria-controls')).toBe(
      'sidebar-workspace-panel-catalog'
    );
  });
});
