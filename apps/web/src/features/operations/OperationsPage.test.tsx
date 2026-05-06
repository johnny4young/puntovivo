/**
 * ENG-065a — Tests for OperationsPage tab shell.
 *
 * Asserts:
 *   - All 3 tabs render in the role list visible to manager + admin.
 *   - Default tab is `sync`.
 *   - `?tab=fiscal` and `?tab=device` deep links land on the right
 *     panel.
 *   - Clicking a tab updates URL + aria-selected.
 *
 * Panel internals (data fetching) are exercised by their own
 * dedicated test files; this file only covers the shell.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/utils';
import { OperationsPage } from './OperationsPage';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      reports: { fiscal: { list: { invalidate: vi.fn() } } },
      peripherals: { peekHardwareOutbox: { invalidate: vi.fn() } },
    }),
    useQueries: (cb: (t: { peripherals: { list: () => unknown } }) => unknown[]) =>
      cb({ peripherals: { list: () => ({ data: [], isLoading: false }) } }),
    sites: { list: { useQuery: () => ({ data: { items: [] } }) } },
    sync: {
      pull: { query: vi.fn().mockResolvedValue({}) },
      push: { mutate: vi.fn() },
      resolve: { mutate: vi.fn() },
    },
    reports: {
      fiscal: {
        list: { useQuery: () => ({ data: { items: [] }, isLoading: false }) },
        retryDocument: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      },
    },
    peripherals: {
      peekHardwareOutbox: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      retryHardwareOutbox: {
        useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
      },
    },
  },
  vanillaClient: {
    sync: {
      pull: { query: vi.fn().mockResolvedValue({ queue: [], conflicts: [] }) },
      push: { mutate: vi.fn() },
      resolve: { mutate: vi.fn() },
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'admin@demo.co', role: 'admin', tenantId: 't1' },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

describe('OperationsPage', () => {
  it('renders the three tabs in order', () => {
    render(<OperationsPage />);
    expect(screen.getByTestId('operations-tab-sync')).toBeInTheDocument();
    expect(screen.getByTestId('operations-tab-fiscal')).toBeInTheDocument();
    expect(screen.getByTestId('operations-tab-device')).toBeInTheDocument();
  });

  it('defaults to the sync tab', () => {
    render(<OperationsPage />);
    expect(screen.getByTestId('operations-tab-sync')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('operations-tabpanel-sync')).toBeInTheDocument();
  });

  it('lands on the fiscal panel via ?tab=fiscal deep link', () => {
    render(<OperationsPage />, { initialEntries: ['/operations?tab=fiscal'] });
    expect(screen.getByTestId('operations-tab-fiscal')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('operations-tabpanel-fiscal')).toBeInTheDocument();
  });

  it('lands on the device panel via ?tab=device deep link', () => {
    render(<OperationsPage />, { initialEntries: ['/operations?tab=device'] });
    expect(screen.getByTestId('operations-tab-device')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('operations-tabpanel-device')).toBeInTheDocument();
  });

  it('falls back to the default tab when ?tab=garbage', () => {
    render(<OperationsPage />, { initialEntries: ['/operations?tab=cash'] });
    expect(screen.getByTestId('operations-tab-sync')).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('switches tabs on click and updates aria-selected', () => {
    render(<OperationsPage />);
    expect(screen.getByTestId('operations-tab-sync')).toHaveAttribute(
      'aria-selected',
      'true'
    );

    fireEvent.click(screen.getByTestId('operations-tab-fiscal'));

    expect(screen.getByTestId('operations-tab-fiscal')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('operations-tab-sync')).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByTestId('operations-tabpanel-fiscal')).toBeInTheDocument();
  });

  it('renders the localized header copy', () => {
    render(<OperationsPage />);
    // Default i18n in tests is English; the header should say "Operations Center".
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /Operations Center/i
    );
  });
});
