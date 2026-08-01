/**
 * Tests for the progressive Operations shell.
 *
 * Asserts:
 * - Store status is the dominant landing for both allowed roles.
 * - Administrators can progressively disclose every technical destination.
 * - Existing administrator deep links remain stable.
 * - Managers cannot open support tools, including through a deep link.
 *
 * Panel internals (data fetching) are exercised by their own
 * dedicated test files; this file only covers the shell.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router';
import { act, render, screen, fireEvent } from '@/test/utils';
import { OperationsPage } from './OperationsPage';

let mockRole: 'admin' | 'manager' = 'admin';
let mockAttentionAreas: Array<{
  area: 'sync' | 'fiscal' | 'device' | 'payments';
  severity: 'danger' | 'warning';
  count: number;
}> = [];

const taskMeasurement = vi.hoisted(() => {
  const state: { activeTask: 'recover_operation' | null } = { activeTask: null };
  const controller = {
    get activeTask() {
      return state.activeTask;
    },
    ensure: vi.fn((task: 'recover_operation') => {
      state.activeTask = task;
    }),
    markUsableControl: vi.fn(),
    recordInteraction: vi.fn(),
    markFirstProgress: vi.fn(),
    recordBacktrack: vi.fn(),
    recordRecoveryAttempt: vi.fn(),
    recordRecoveryOutcome: vi.fn(),
    finish: vi.fn(() => {
      state.activeTask = null;
    }),
  };
  return { controller, state };
});

vi.mock('@/lib/taskMeasurement', () => ({
  useTaskMeasurementController: () => taskMeasurement.controller,
}));

vi.mock('./SupportHealthPanel', () => ({
  SupportHealthPanel: () => <div data-testid="support-health-panel" />,
}));

vi.mock('./OperationalReadinessBoard', () => ({
  OperationalReadinessBoard: () => <div data-testid="operational-readiness-board" />,
}));

vi.mock('./WebhookHealthPanel', () => ({
  WebhookHealthPanel: () => <div data-testid="webhook-health-panel" />,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      reports: {
        fiscal: { list: { invalidate: vi.fn() } },
      },
      peripherals: { peekHardwareOutbox: { invalidate: vi.fn() } },
      authority: { status: { invalidate: vi.fn() } },
      payments: {
        peekOutbox: { invalidate: vi.fn() },
        reconciliation: { invalidate: vi.fn() },
        methodBreakdown: { invalidate: vi.fn() },
      },
      operations: { needsAttention: { invalidate: vi.fn() } },
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
    operations: {
      needsAttention: {
        useQuery: () => ({
          data: {
            areas: mockAttentionAreas,
            totalCount: mockAttentionAreas.reduce((sum, area) => sum + area.count, 0),
            highestSeverity: mockAttentionAreas.some(area => area.severity === 'danger')
              ? 'danger'
              : mockAttentionAreas.length > 0
                ? 'warning'
                : null,
          },
          isLoading: false,
          isError: false,
          isSuccess: true,
          error: null,
          refetch: vi.fn(),
        }),
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
    user: { id: 'user-1', email: 'operator@demo.co', role: mockRole, tenantId: 't1' },
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

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>;
}

async function renderOperationsPage(initialEntries?: string[]): Promise<void> {
  await act(async () => {
    render(
      <>
        <OperationsPage />
        <LocationProbe />
      </>,
      { initialEntries: initialEntries ?? ['/operations'] }
    );
    // These surfaces are production-lazy. Resolve their module promises inside
    // this test transaction so React never completes Suspense after teardown.
    await Promise.all([
      import('./OperationsNavigation'),
      import('./SupportHealthPanel'),
      import('./OperationalReadinessBoard'),
    ]);
  });
}

describe('OperationsPage', () => {
  beforeEach(() => {
    mockRole = 'admin';
    mockAttentionAreas = [];
    taskMeasurement.state.activeTask = null;
    for (const mock of Object.values(taskMeasurement.controller)) {
      if (typeof mock === 'function' && 'mockClear' in mock) {
        mock.mockClear();
      }
    }
  });

  it('renders store status as the only visible administrator landing', async () => {
    await renderOperationsPage();
    expect(screen.getByTestId('operations-tab-attention')).toBeInTheDocument();
    expect(screen.getByTestId('operations-tab-attention')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('operations-support-toggle')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.queryByTestId('operations-tab-support')).not.toBeInTheDocument();
    expect(screen.getByTestId('operations-tabpanel-attention')).toBeInTheDocument();
    expect(screen.getByTestId('needs-attention-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('operational-readiness-board')).not.toBeInTheDocument();
  });

  it('measures only a visible, actionable payment recovery', async () => {
    mockAttentionAreas = [{ area: 'payments', severity: 'danger', count: 1 }];
    await renderOperationsPage();

    await vi.waitFor(() => {
      expect(taskMeasurement.controller.ensure).toHaveBeenCalledWith('recover_operation');
      expect(taskMeasurement.controller.markUsableControl).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('needs-attention-cta-payments'));

    expect(taskMeasurement.controller.recordInteraction).toHaveBeenCalledTimes(1);
    expect(taskMeasurement.controller.markFirstProgress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/operations?tab=payments');
  });

  it('reveals every technical destination only after explicit disclosure', async () => {
    await renderOperationsPage();
    fireEvent.click(screen.getByTestId('operations-support-toggle'));
    expect(screen.getByTestId('operations-support-tools')).toBeInTheDocument();
    for (const tab of [
      'support',
      'sync',
      'fiscal',
      'device',
      'cash',
      'payments',
      'webhooks',
      'diagnostics',
      'authority',
    ]) {
      expect(screen.getByTestId(`operations-tab-${tab}`)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId('operations-tab-fiscal'));
    expect(screen.getByTestId('operations-tab-fiscal')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('operations-tabpanel-fiscal')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/operations?tab=fiscal');
  });

  it.each([
    ['support', 'support-health-panel'],
    ['sync', 'operations-tabpanel-sync'],
    ['fiscal', 'operations-tabpanel-fiscal'],
    ['device', 'operations-tabpanel-device'],
    ['cash', 'operations-tabpanel-cash'],
    ['payments', 'operations-tabpanel-payments'],
    ['webhooks', 'webhook-health-panel'],
    ['diagnostics', 'operations-tabpanel-diagnostics'],
    ['authority', 'operations-tabpanel-authority'],
  ])('preserves the administrator ?tab=%s deep link', async (tab, panelTestId) => {
    await renderOperationsPage([`/operations?tab=${tab}`]);
    expect(screen.getByTestId(`operations-tab-${tab}`)).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByTestId(panelTestId)).toBeInTheDocument();
    expect(screen.getByTestId('operations-support-toggle')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('focuses the exact registered-device surface and clears the intent on tab change', async () => {
    await renderOperationsPage(['/operations?tab=authority&focus=registered-devices']);

    const target = await screen.findByTestId('authority-registered-devices-target');
    expect(target).toHaveFocus();
    expect(target).toHaveAccessibleName('Registered devices');

    fireEvent.click(screen.getByTestId('operations-tab-fiscal'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/operations?tab=fiscal');
  });

  it('returns to store status when support tools are collapsed', async () => {
    await renderOperationsPage(['/operations?tab=payments']);
    fireEvent.click(screen.getByTestId('operations-support-toggle'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/operations');
    expect(screen.getByTestId('operations-tabpanel-attention')).toBeInTheDocument();
    expect(screen.queryByTestId('operations-support-tools')).not.toBeInTheDocument();
  });

  it('falls back to store status for an invalid administrator deep link', async () => {
    await renderOperationsPage(['/operations?tab=inventory']);
    expect(screen.getByTestId('operations-tab-attention')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTestId('operations-tab-inventory')).not.toBeInTheDocument();
  });

  it('keeps managers on store status without exposing support tools', async () => {
    mockRole = 'manager';
    await renderOperationsPage();
    expect(screen.getByTestId('operations-tabpanel-attention')).toBeInTheDocument();
    expect(screen.queryByTestId('operations-tab-attention')).not.toBeInTheDocument();
    expect(screen.queryByTestId('operations-support-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('operational-readiness-board')).not.toBeInTheDocument();
  });

  it('canonicalizes a manager technical deep link back to store status', async () => {
    mockRole = 'manager';
    await renderOperationsPage(['/operations?tab=payments']);
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/operations');
    expect(screen.queryByTestId('operations-tabpanel-payments')).not.toBeInTheDocument();
    expect(screen.queryByTestId('operations-support-toggle')).not.toBeInTheDocument();
  });

  it('renders the localized operator-first header copy', async () => {
    await renderOperationsPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Store status/i);
  });
});
