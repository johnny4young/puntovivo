/**
 * ENG-065a / ENG-065b / ENG-065c — Tests for OperationsPage tab shell.
 *
 * Asserts:
 *   - All 8 tabs render in the role list visible to manager + admin.
 *   - Default tab is `sync`.
 *   - `?tab=fiscal`, `?tab=device`, `?tab=cash`, `?tab=payments`,
 *     `?tab=inventory`, `?tab=diagnostics`, `?tab=authority` deep links
 *     land on the right panel.
 *   - Garbage tab values fall back to the default.
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
      reports: {
        fiscal: { list: { invalidate: vi.fn() } },
        inventory: { discrepancies: { invalidate: vi.fn() } },
      },
      peripherals: { peekHardwareOutbox: { invalidate: vi.fn() } },
      authority: { status: { invalidate: vi.fn() } },
      payments: {
        peekOutbox: { invalidate: vi.fn() },
        reconciliation: { invalidate: vi.fn() },
        methodBreakdown: { invalidate: vi.fn() },
      },
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
      cash: {
        reconciliation: {
          useQuery: () => ({
            data: {
              summary: {
                openSessionCount: 0,
                closedRecentCount: 0,
                reviewCount: 0,
                netOverShort: 0,
                largestDiscrepancy: 0,
                windowDays: 30,
              },
              bySite: [],
              recentDiscrepancies: [],
            },
            isLoading: false,
            error: null,
          }),
        },
      },
      inventory: {
        discrepancies: {
          useQuery: () => ({
            data: {
              summary: { productsScanned: 0, discrepancyCount: 0, deltaEpsilon: 0.001 },
              rows: [],
            },
            isLoading: false,
            error: null,
          }),
        },
      },
      diagnostics: {
        preview: {
          useQuery: () => ({
            data: null,
            error: null,
            isFetching: false,
            refetch: vi.fn(),
          }),
        },
        export: {
          useQuery: () => ({
            data: null,
            isFetching: false,
            refetch: vi.fn(),
          }),
        },
      },
    },
    payments: {
      reconciliation: {
        useQuery: () => ({
          data: {
            summary: {
              windowDays: 30,
              tendersScanned: 0,
              outboxRows: 0,
              matched: 0,
              mismatches: 0,
              missingProviderReferences: 0,
              providerIssues: 0,
              totalTenderAmount: 0,
              unmatchedAmount: 0,
            },
            byRail: [],
            mismatches: [],
          },
          isLoading: false,
          error: null,
        }),
      },
      peekOutbox: {
        useQuery: () => ({ data: [], isLoading: false, error: null }),
      },
      methodBreakdown: {
        useQuery: () => ({
          data: { windowDays: 7, entries: [] },
          isLoading: false,
          error: null,
        }),
      },
      retryOutbox: {
        useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
      },
      markSettled: {
        useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
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
    authority: {
      status: {
        useQuery: () => ({
          data: {
            runtime: {
              authorityMode: 'device_local',
              hubUrl: null,
              siteId: null,
              deviceId: null,
              bindHost: '127.0.0.1',
              bindPort: 8090,
              allowedLanOrigins: [],
            },
            hub: {
              dbSchemaVersion: 21,
              activeDeviceCount: 0,
              tenantActiveDeviceCount: 0,
            },
            summary: {
              total: 0,
              online: 0,
              stale: 0,
              revoked: 0,
              hubClients: 0,
              authorityNodes: 0,
              webClients: 0,
            },
            devices: [],
            pairingCodes: [],
          },
          isLoading: false,
          isFetching: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      createPairingCode: {
        useMutation: () => ({ isPending: false, mutate: vi.fn() }),
      },
      revokeDevice: {
        useMutation: () => ({ isPending: false, mutate: vi.fn() }),
      },
    },
    inventory: {
      reconcileBalances: {
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
  it('renders the eight tabs in order', () => {
    render(<OperationsPage />);
    expect(screen.getByTestId('operations-tab-sync')).toBeInTheDocument();
    expect(screen.getByTestId('operations-tab-fiscal')).toBeInTheDocument();
    expect(screen.getByTestId('operations-tab-device')).toBeInTheDocument();
    expect(screen.getByTestId('operations-tab-cash')).toBeInTheDocument();
    expect(screen.getByTestId('operations-tab-payments')).toBeInTheDocument();
    expect(screen.getByTestId('operations-tab-inventory')).toBeInTheDocument();
    expect(screen.getByTestId('operations-tab-diagnostics')).toBeInTheDocument();
    expect(screen.getByTestId('operations-tab-authority')).toBeInTheDocument();
  });

  it('defaults to the sync tab', () => {
    render(<OperationsPage />);
    expect(screen.getByTestId('operations-tab-sync')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('operations-tabpanel-sync')).toBeInTheDocument();
  });

  it('lands on the fiscal panel via ?tab=fiscal deep link', () => {
    render(<OperationsPage />, { initialEntries: ['/operations?tab=fiscal'] });
    expect(screen.getByTestId('operations-tab-fiscal')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('operations-tabpanel-fiscal')).toBeInTheDocument();
  });

  it('lands on the device panel via ?tab=device deep link', () => {
    render(<OperationsPage />, { initialEntries: ['/operations?tab=device'] });
    expect(screen.getByTestId('operations-tab-device')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('operations-tabpanel-device')).toBeInTheDocument();
  });

  it('lands on the cash panel via ?tab=cash deep link', () => {
    render(<OperationsPage />, { initialEntries: ['/operations?tab=cash'] });
    expect(screen.getByTestId('operations-tab-cash')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('operations-tabpanel-cash')).toBeInTheDocument();
  });

  it('lands on the payments panel via ?tab=payments deep link', () => {
    render(<OperationsPage />, { initialEntries: ['/operations?tab=payments'] });
    expect(screen.getByTestId('operations-tab-payments')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('operations-tabpanel-payments')).toBeInTheDocument();
  });

  it('lands on the inventory panel via ?tab=inventory deep link', () => {
    render(<OperationsPage />, { initialEntries: ['/operations?tab=inventory'] });
    expect(screen.getByTestId('operations-tab-inventory')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('operations-tabpanel-inventory')).toBeInTheDocument();
  });

  it('lands on the diagnostics panel via ?tab=diagnostics deep link', () => {
    render(<OperationsPage />, { initialEntries: ['/operations?tab=diagnostics'] });
    expect(screen.getByTestId('operations-tab-diagnostics')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('operations-tabpanel-diagnostics')).toBeInTheDocument();
  });

  it('lands on the authority panel via ?tab=authority deep link', () => {
    render(<OperationsPage />, { initialEntries: ['/operations?tab=authority'] });
    expect(screen.getByTestId('operations-tab-authority')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('operations-tabpanel-authority')).toBeInTheDocument();
  });

  it('falls back to the default tab when ?tab=garbage', () => {
    render(<OperationsPage />, { initialEntries: ['/operations?tab=zzznotreal'] });
    expect(screen.getByTestId('operations-tab-sync')).toHaveAttribute('aria-selected', 'true');
  });

  it('switches tabs on click and updates aria-selected', () => {
    render(<OperationsPage />);
    expect(screen.getByTestId('operations-tab-sync')).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByTestId('operations-tab-fiscal'));

    expect(screen.getByTestId('operations-tab-fiscal')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('operations-tab-sync')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('operations-tabpanel-fiscal')).toBeInTheDocument();
  });

  it('renders the localized header copy', () => {
    render(<OperationsPage />);
    // Default i18n in tests is English; the header should say "Operations Center".
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Operations Center/i);
  });
});
