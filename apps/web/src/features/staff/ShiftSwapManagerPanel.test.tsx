import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { render, screen, waitFor, within } from '@/test/utils';

const mocks = vi.hoisted(() => ({
  role: 'manager' as 'admin' | 'manager' | 'cashier' | 'viewer',
  inbox: vi.fn(),
  events: vi.fn(),
  decide: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  success: vi.fn(),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'manager', tenantId: 'tenant', role: mocks.role } }),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: mocks.success }),
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ isPending: false, mutateAsync: mocks.decide }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      workforce: { shiftSwaps: { invalidate: mocks.invalidate } },
      employeeShifts: { schedule: { invalidate: mocks.invalidate } },
      auditLogs: { invalidate: mocks.invalidate },
    }),
    workforce: {
      shiftSwaps: {
        managerInbox: { useQuery: mocks.inbox },
        events: { useQuery: mocks.events },
      },
    },
  },
}));

import { ShiftSwapManagerPanel } from './ShiftSwapManagerPanel';

const query = (data: unknown) => ({
  data,
  isPending: false,
  isFetching: false,
  error: null,
  refetch: mocks.refetch,
});
function request(status: 'requested' | 'accepted' = 'accepted') {
  return {
    id: 'swap',
    status,
    version: status === 'accepted' ? 2 : 1,
    createdAt: '2026-09-04T12:00:00.000Z',
    updatedAt: '2026-09-04T13:00:00.000Z',
    requester: { id: 'cashier', name: 'Ana', isActive: true },
    recipient: { id: 'viewer', name: 'Luis', isActive: true },
    offered: {
      id: 'offered',
      userId: 'cashier',
      siteId: 'site',
      siteName: 'Central',
      siteActive: true,
      startsAt: '2026-10-10T14:00:00.000Z',
      endsAt: '2026-10-10T22:00:00.000Z',
      timeZone: 'America/Bogota',
      version: 4,
    },
    requested: {
      id: 'requested',
      userId: 'viewer',
      siteId: 'site',
      siteName: 'Central',
      siteActive: true,
      startsAt: '2026-10-11T14:00:00.000Z',
      endsAt: '2026-10-11T22:00:00.000Z',
      timeZone: 'America/Bogota',
      version: 7,
    },
  };
}

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.role = 'manager';
  mocks.inbox.mockReturnValue(query({ items: [request()], nextCursor: null }));
  mocks.events.mockReturnValue(query({ items: [], nextBeforeVersion: null }));
  mocks.decide.mockResolvedValue({ id: 'swap', version: 3, status: 'approved' });
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue({ data: null });
  await i18next.changeLanguage('en');
});

describe('ShiftSwapManagerPanel independent decisions', () => {
  it('approves the exact accepted version only after explicit pair review', async () => {
    const user = userEvent.setup();
    render(<ShiftSwapManagerPanel />);
    await user.click(screen.getByRole('button', { name: 'Approve exact exchange' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Confirm approval' })).toBeDisabled();
    await user.click(dialog.getByRole('checkbox'));
    await user.click(dialog.getByRole('button', { name: 'Confirm approval' }));
    await waitFor(() =>
      expect(mocks.decide).toHaveBeenCalledExactlyOnceWith({
        id: 'swap',
        expectedVersion: 2,
        status: 'approved',
      })
    );
    expect(mocks.invalidate).toHaveBeenCalledTimes(3);
  });

  it('does not offer approval before employee consent but permits reasoned rejection', async () => {
    mocks.inbox.mockReturnValue(query({ items: [request('requested')], nextCursor: null }));
    const user = userEvent.setup();
    render(<ShiftSwapManagerPanel />);
    expect(screen.queryByRole('button', { name: 'Approve exact exchange' })).toBeNull();
    expect(screen.getByText(/Waiting for the other employee/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Private operational reason'), 'Coverage is incomplete');
    await user.click(dialog.getByRole('button', { name: 'Confirm rejection' }));
    await waitFor(() =>
      expect(mocks.decide).toHaveBeenCalledExactlyOnceWith({
        id: 'swap',
        expectedVersion: 1,
        status: 'rejected',
        reason: 'Coverage is incomplete',
      })
    );
  });

  it.each(['cashier', 'viewer'] as const)('never mounts the manager inbox for %s', role => {
    mocks.role = role;
    render(<ShiftSwapManagerPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Only managers');
    expect(mocks.inbox).not.toHaveBeenCalled();
  });
});
