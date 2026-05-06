/**
 * ENG-065a — Tests for DeviceHealthPanel.
 *
 * Asserts:
 *   - Both sections render (peripherals + outbox).
 *   - Default outbox view filters to "problems only" status set.
 *   - "Show all" toggle reveals queued/printed rows.
 *   - Admin retry button fires the mutation.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/utils';
import { DeviceHealthPanel } from './DeviceHealthPanel';

const retryMutate = vi.fn(async () => undefined);
const peekInvalidate = vi.fn(async () => undefined);
let mockUserRole: 'admin' | 'manager' = 'admin';
let mockOutboxRows: Array<Record<string, unknown>> = [];

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      peripherals: { peekHardwareOutbox: { invalidate: peekInvalidate } },
    }),
    sites: {
      list: {
        useQuery: () => ({
          data: { items: [{ id: 'site-1', name: 'Sede Norte' }] },
        }),
      },
    },
    useQueries: (cb: (t: unknown) => unknown[]) => {
      const trpcLike = {
        peripherals: {
          list: () => ({
            data: [
              {
                id: 'p-1',
                kind: 'printer',
                driver: 'escpos',
                displayName: 'Caja Norte',
                lastTestedAt: '2026-05-05T10:00:00.000Z',
                lastTestResult: 'ok',
              },
            ],
            isLoading: false,
          }),
        },
      };
      return cb(trpcLike);
    },
    peripherals: {
      peekHardwareOutbox: {
        useQuery: () => ({
          data: mockOutboxRows,
          isLoading: false,
          error: null,
        }),
      },
      retryHardwareOutbox: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: retryMutate,
          variables: undefined,
        }),
      },
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'demo@test', role: mockUserRole, tenantId: 't1' },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

beforeEach(() => {
  retryMutate.mockClear();
  peekInvalidate.mockClear();
  mockUserRole = 'admin';
  mockOutboxRows = [];
});

describe('DeviceHealthPanel', () => {
  it('renders the peripherals section grouped by kind', () => {
    render(<DeviceHealthPanel />);
    expect(screen.getByText(/Receipt printer/i)).toBeInTheDocument();
    expect(screen.getByText('Caja Norte')).toBeInTheDocument();
    expect(screen.getByText('Sede Norte')).toBeInTheDocument();
  });

  it('shows the empty state when no problem rows are present', () => {
    mockOutboxRows = [
      {
        id: 'h-1',
        kind: 'print-receipt',
        status: 'printed',
        attempts: 0,
        peripheralId: 'p-1',
        lastError: null,
        createdAt: '2026-05-05T11:00:00.000Z',
        updatedAt: '2026-05-05T11:00:00.000Z',
      },
    ];

    render(<DeviceHealthPanel />);
    expect(
      screen.getByText(/No hardware jobs are currently failing/i)
    ).toBeInTheDocument();
  });

  it('toggles "show all" to surface non-problem rows', () => {
    mockOutboxRows = [
      {
        id: 'h-2',
        kind: 'print-receipt',
        status: 'printed',
        attempts: 0,
        peripheralId: 'p-1',
        lastError: null,
        createdAt: '2026-05-05T11:00:00.000Z',
        updatedAt: '2026-05-05T11:00:00.000Z',
      },
    ];

    render(<DeviceHealthPanel />);
    expect(
      screen.getByText(/No hardware jobs are currently failing/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('device-outbox-toggle'));

    // After the toggle, the printed row is visible.
    expect(screen.getByText(/print-receipt/)).toBeInTheDocument();
  });

  it('fires the admin retry mutation', () => {
    mockOutboxRows = [
      {
        id: 'h-3',
        kind: 'print-receipt',
        status: 'dead_letter',
        attempts: 5,
        peripheralId: 'p-1',
        lastError: {
          errorCode: 'DEVICE_OFFLINE',
          providerMessage: 'printer unreachable',
          recoverable: true,
        },
        createdAt: '2026-05-05T11:00:00.000Z',
        updatedAt: '2026-05-05T11:00:00.000Z',
      },
    ];

    render(<DeviceHealthPanel />);
    expect(screen.getByText('printer unreachable')).toBeInTheDocument();
    const button = screen.getByTestId('device-retry-h-3');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(retryMutate).toHaveBeenCalledWith({ id: 'h-3' });
  });

  it('disables the retry button for manager role', () => {
    mockUserRole = 'manager';
    mockOutboxRows = [
      {
        id: 'h-4',
        kind: 'print-receipt',
        status: 'retrying',
        attempts: 2,
        peripheralId: 'p-1',
        lastError: { kind: 'DEVICE_TIMEOUT', message: 'timed out' },
        createdAt: '2026-05-05T11:00:00.000Z',
        updatedAt: '2026-05-05T11:00:00.000Z',
      },
    ];

    render(<DeviceHealthPanel />);
    const button = screen.getByTestId('device-retry-h-4');
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/admin/i);
  });
});
