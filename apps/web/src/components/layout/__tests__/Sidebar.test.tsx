/**
 * Task-first sidebar and advanced workspace contract tests.
 *
 * Pins the user-facing invariants of the workspace refactor:
 *
 * - Every role sees at most five frequent tasks.
 * - The full workspace taxonomy stays behind progressive disclosure.
 * - The workspace that contains the active route auto-expands.
 * - Direct advanced routes open the tools layer automatically.
 * - Module hydration can correct the selected mobile workspace.
 * - Clicking a workspace header toggles aria-expanded.
 * - localStorage preserves the collapsed state across mounts.
 *
 * @module components/layout/__tests__/Sidebar.test
 */
import { act, fireEvent, render, screen, waitFor, within } from '@/test/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertNoA11yViolations } from '@/test/a11y';
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
let mockModulesPlaceholder = false;
let mockPathname = '/dashboard';
let desktopSidebar = true;
const { anomalyQueryState, prefetchSalesMock } = vi.hoisted(() => ({
  anomalyQueryState: { high: 0 },
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
  const actual = await vi.importActual<typeof import('@/features/modules')>('@/features/modules');
  return {
    ...actual,
    useModulesSnapshot: () => ({
      modules: mockModules,
      isLoading: mockModulesPlaceholder,
      isPlaceholder: mockModulesPlaceholder,
    }),
  };
});

vi.mock('@/lib/trpc', () => ({
  trpc: {
    ai: {
      anomalies: {
        list: {
          useQuery: () => ({
            data: { severityCounts: { high: anomalyQueryState.high } },
            isLoading: false,
          }),
        },
      },
    },
  },
}));

// Sidebar now calls usePrefetchSales (trpc.useUtils + useTenant)
// for the /sales hover prefetch. Stub the hook to avoid wiring those
// providers; this suite pins that the visible sidebar anchors call it.
vi.mock('@/features/sales/usePrefetchSales', () => ({
  usePrefetchSales: () => prefetchSalesMock,
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
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
  mockModulesPlaceholder = false;
  mockPathname = '/dashboard';
  desktopSidebar = true;
  anomalyQueryState.high = 0;
  prefetchSalesMock.mockReset();
  window.localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(min-width: 1280px)' ? desktopSidebar : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  window.localStorage.clear();
});

function openDesktopMoreTools(): void {
  fireEvent.click(screen.getByTestId('sidebar-more-tools-toggle'));
}

function openMobileMoreTools(): void {
  fireEvent.click(screen.getByTestId('mobile-more-tools-toggle'));
}

describe('Sidebar workspaces', () => {
  it('uses the shared 44px shell control for rail collapse', () => {
    render(<Sidebar {...sidebarProps} />);

    const collapse = screen.getByRole('button', { name: 'Collapse rail' });
    expect(collapse).toHaveAttribute('type', 'button');
    expect(collapse).toHaveClass('btn-outline', 'btn-icon', 'h-11', 'w-11');
  });

  it('admin starts with five frequent tasks and can reveal eight tool groups', () => {
    render(<Sidebar {...sidebarProps} />);
    expect(screen.getAllByTestId(/^sidebar-primary-task-/)).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'See what matters today' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Make a sale' })).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-more-tools-toggle')).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    openDesktopMoreTools();

    // Count every workspace header regardless of expanded state by
    // matching their stable test ids.
    const expanded = screen.queryAllByRole('button', { expanded: true });
    const collapsed = screen.queryAllByRole('button', { expanded: false });
    const headers = [...expanded, ...collapsed].filter(btn =>
      btn.getAttribute('data-testid')?.startsWith('sidebar-workspace-')
    );
    expect(headers).toHaveLength(8);
    expect(screen.getByTestId('sidebar-workspace-operate')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('cashier starts with one sale task and reveals only selling tools', () => {
    mockUserRole = 'cashier';
    mockPathname = '/sales';
    render(<Sidebar {...sidebarProps} />);

    expect(screen.getAllByTestId(/^sidebar-primary-task-/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Make a sale' })).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-more-tools-toggle')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.queryByRole('link', { name: 'See what matters today' })).not.toBeInTheDocument();

    openDesktopMoreTools();

    expect(screen.getByTestId('sidebar-workspace-sell')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-workspace-finance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-workspace-setup')).not.toBeInTheDocument();
  });

  it('viewer gets only the today task and can reveal its read-only tool group', () => {
    mockUserRole = 'viewer';
    render(<Sidebar {...sidebarProps} />);

    expect(screen.getAllByTestId(/^sidebar-primary-task-/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'See what matters today' })).toBeInTheDocument();
    openDesktopMoreTools();

    expect(screen.getByTestId('sidebar-workspace-operate')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /system support/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-workspace-sell')).not.toBeInTheDocument();
  });

  it('keeps the anomaly badge and accessible count on the today task', () => {
    anomalyQueryState.high = 12;
    render(<Sidebar {...sidebarProps} />);

    expect(
      screen.getByRole('link', {
        name: 'See what matters today (12 high-severity anomalies pending review)',
      })
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('sidebar-primary-task-today')).getByText('9+')).toBeVisible();
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
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to all Billing and control tools' })
    ).toHaveAttribute('href', '/finance');
    expect(screen.queryByRole('link', { name: 'Fiscal reports' })).not.toBeInTheDocument();
  });

  it('auto-expands the workspace that owns an active landing route', () => {
    mockPathname = '/catalog';
    render(<Sidebar {...sidebarProps} />);

    expect(screen.getByTestId('sidebar-workspace-catalog')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByRole('link', { name: 'See all Products tools' })).toHaveAttribute(
      'href',
      '/catalog'
    );
    expect(screen.queryByRole('link', { name: 'Categories' })).not.toBeInTheDocument();
  });

  it('clicking a workspace header toggles aria-expanded and persists in localStorage', () => {
    render(<Sidebar {...sidebarProps} />);
    openDesktopMoreTools();
    // /dashboard now belongs to Operate (), so use an inactive
    // workspace to keep this test focused on disclosure persistence.
    const catalog = screen.getByTestId('sidebar-workspace-catalog');
    expect(catalog.getAttribute('aria-expanded')).toBe('false');
    act(() => {
      fireEvent.click(catalog);
    });
    expect(catalog.getAttribute('aria-expanded')).toBe('true');
    expect(window.localStorage.getItem('puntovivo:sidebar:workspace:catalog:collapsed')).toBe(
      'false'
    );
  });

  it('localStorage seed restores the collapsed state on next mount', () => {
    // The Catalog workspace would default to collapsed on /dashboard
    // (not the active workspace). Pre-seed it OPEN and check the
    // sidebar respects the seed on mount.
    window.localStorage.setItem('puntovivo:sidebar:workspace:catalog:collapsed', 'false');
    render(<Sidebar {...sidebarProps} />);
    openDesktopMoreTools();
    const catalog = screen.getByTestId('sidebar-workspace-catalog');
    expect(catalog.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the active workspace expanded even when localStorage says collapsed', () => {
    window.localStorage.setItem('puntovivo:sidebar:workspace:finance:collapsed', 'true');
    mockPathname = '/audit-logs';
    render(<Sidebar {...sidebarProps} />);
    const finance = screen.getByTestId('sidebar-workspace-finance');
    expect(finance.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: /audit log/i })).toBeInTheDocument();
  });
});

describe('Sidebar workspace header navigation', () => {
  it('catalog, procurement, finance workspace headers render an anchor link to their landing route', () => {
    render(<Sidebar {...sidebarProps} />);
    openDesktopMoreTools();
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

  it('workspaces without a dedicated directory keep their header link pointing at the first item route', () => {
    render(<Sidebar {...sidebarProps} />);
    openDesktopMoreTools();
    const cases: Array<[string, string]> = [
      ['sidebar-workspace-link-sell', '/sales'],
      ['sidebar-workspace-link-operate', '/dashboard'],
      ['sidebar-workspace-link-inventory', '/inventory'],
      ['sidebar-workspace-link-customers', '/customers'],
    ];
    for (const [testId, expectedHref] of cases) {
      const link = screen.getByTestId(testId);
      expect(link.tagName).toBe('A');
      expect(link.getAttribute('href')).toBe(expectedHref);
    }
  });

  it('setup header opens its task directory instead of the first settings page', () => {
    render(<Sidebar {...sidebarProps} />);
    openDesktopMoreTools();

    expect(screen.getByTestId('sidebar-workspace-link-setup')).toHaveAttribute('href', '/setup');
  });

  it('a direct advanced route shows only the current page and a clear path back', () => {
    mockPathname = '/geography';
    render(<Sidebar {...sidebarProps} />);

    expect(screen.getByText('Current page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Geography' })).toHaveAttribute('href', '/geography');
    expect(screen.getByRole('link', { name: 'Back to all Products tools' })).toHaveAttribute(
      'href',
      '/catalog'
    );
    expect(screen.queryByRole('link', { name: 'VAT Rates' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Receipt templates' })).not.toBeInTheDocument();
  });

  it('prefetches sales from the visible primary sale task', () => {
    render(<Sidebar {...sidebarProps} />);

    const sellLink = screen.getByTestId('sidebar-primary-task-sell');
    fireEvent.mouseEnter(sellLink);
    fireEvent.focus(sellLink);

    expect(prefetchSalesMock).toHaveBeenCalledTimes(2);
  });

  it('the chevron button remains the canonical aria-expanded disclosure surface', () => {
    render(<Sidebar {...sidebarProps} />);
    openDesktopMoreTools();
    const chevron = screen.getByTestId('sidebar-workspace-catalog');
    expect(chevron.tagName).toBe('BUTTON');
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    expect(chevron.getAttribute('aria-controls')).toBe('sidebar-workspace-panel-catalog');
    expect(chevron).toHaveAccessibleName('Expand Products');
  });
});

describe('responsive workspace navigation', () => {
  beforeEach(() => {
    desktopSidebar = false;
  });

  it('starts with five tasks and reveals one tool group at a time for an admin', () => {
    render(<Sidebar {...sidebarProps} />);

    expect(screen.getAllByTestId(/^mobile-primary-task-/)).toHaveLength(5);
    expect(screen.getByTestId('mobile-primary-task-today')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();

    openMobileMoreTools();

    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(8);
    expect(screen.getByRole('radio', { name: 'Today and close' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'System support' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Products' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Products' }));

    expect(screen.getByRole('radio', { name: 'Products' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('link', { name: 'See all Products tools' })).toHaveAttribute(
      'href',
      '/catalog'
    );
    expect(screen.queryByRole('link', { name: 'Products' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sales' })).not.toBeInTheDocument();
  });

  it('keeps the today anomaly badge accessible in the mobile task list', () => {
    anomalyQueryState.high = 3;
    render(<Sidebar {...sidebarProps} />);

    expect(
      screen.getByRole('link', {
        name: 'See what matters today (3 high-severity anomalies pending review)',
      })
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('mobile-primary-task-today')).getByText('3')).toBeVisible();
  });

  it('selects the workspace that owns a direct landing route', () => {
    mockPathname = '/catalog';
    render(<Sidebar {...sidebarProps} />);

    expect(screen.getByRole('radio', { name: 'Products' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('link', { name: 'See all Products tools' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sales' })).not.toBeInTheDocument();
  });

  it('keeps direct advanced routes understandable without showing the full directory', () => {
    mockPathname = '/geography';
    render(<Sidebar {...sidebarProps} />);

    expect(screen.getByRole('radio', { name: 'Products' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Current page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Geography' })).toHaveAttribute('href', '/geography');
    expect(screen.getByRole('link', { name: 'Back to all Products tools' })).toHaveAttribute(
      'href',
      '/catalog'
    );
    expect(screen.queryByRole('link', { name: 'Receipt templates' })).not.toBeInTheDocument();
  });

  it('keeps the cashier focused on selling until more tools are requested', () => {
    mockUserRole = 'cashier';
    mockPathname = '/sales';
    render(<Sidebar {...sidebarProps} />);

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.getByTestId('mobile-primary-task-sell')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sell tools' })).not.toBeInTheDocument();

    openMobileMoreTools();

    expect(screen.getByRole('region', { name: 'Sell tools' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Today' })).not.toBeInTheDocument();
  });

  it('supports roving arrow-key selection across workspace options', async () => {
    render(<Sidebar {...sidebarProps} />);
    openMobileMoreTools();
    const operate = screen.getByRole('radio', { name: 'Today and close' });
    operate.focus();

    fireEvent.keyDown(operate, { key: 'ArrowRight' });

    const catalog = screen.getByRole('radio', { name: 'Products' });
    expect(catalog).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(catalog).toHaveFocus());
    expect(screen.getByRole('link', { name: 'See all Products tools' })).toBeInTheDocument();
  });

  it('exposes a modal drawer contract and closes on Escape', () => {
    const onCloseMobile = vi.fn();
    render(<Sidebar {...sidebarProps} onCloseMobile={onCloseMobile} />);

    const dialog = screen.getByRole('dialog', {
      name: 'Task and tools navigation',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveClass(
      'btn-outline',
      'btn-icon',
      'h-11',
      'w-11'
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseMobile).toHaveBeenCalledTimes(1);
  });

  it('isolates application siblings from assistive technology while open', () => {
    render(
      <>
        <Sidebar {...sidebarProps} />
        <main data-testid="background-content">Background page</main>
      </>
    );

    const background = screen.getByTestId('background-content');
    expect(background).toHaveAttribute('aria-hidden', 'true');
    expect(background).toHaveProperty('inert', true);
  });

  it('closes when the backdrop is activated', () => {
    const onCloseMobile = vi.fn();
    render(<Sidebar {...sidebarProps} onCloseMobile={onCloseMobile} />);

    fireEvent.click(screen.getByTestId('mobile-navigation-backdrop'));
    expect(onCloseMobile).toHaveBeenCalledTimes(1);
  });

  it('removes the closed drawer from the accessibility tree and tab order', () => {
    const { container } = render(<Sidebar {...sidebarProps} mobileOpen={false} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const aside = container.querySelector('aside');
    expect(aside).toHaveAttribute('aria-hidden', 'true');
    expect(aside).toHaveAttribute('inert');
  });

  it('has no serious accessibility violations while open', async () => {
    render(<Sidebar {...sidebarProps} />);
    await assertNoA11yViolations(document.body);
  });

  it('updates the selected tool group after module hydration resolves the active route', () => {
    mockPathname = '/operations';
    mockModulesPlaceholder = true;
    const { rerender } = render(<Sidebar {...sidebarProps} />);

    expect(screen.getByRole('radio', { name: 'Sell' })).toHaveAttribute('aria-checked', 'true');

    mockModulesPlaceholder = false;
    rerender(<Sidebar {...sidebarProps} />);

    expect(screen.getByRole('radio', { name: 'Today and close' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('link', { name: 'System support' })).toBeInTheDocument();
  });
});

describe('responsive breakpoint ownership', () => {
  it('clears stale mobile-open state after crossing into desktop', async () => {
    const onCloseMobile = vi.fn();
    render(<Sidebar {...sidebarProps} onCloseMobile={onCloseMobile} />);

    await waitFor(() => expect(onCloseMobile).toHaveBeenCalledTimes(1));
  });
});
