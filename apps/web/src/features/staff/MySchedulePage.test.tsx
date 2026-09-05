import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { render, screen, waitFor, within } from '@/test/utils';

const mocks = vi.hoisted(() => ({
  role: 'cashier' as 'admin' | 'manager' | 'cashier' | 'viewer',
  userId: 'cashier',
  mine: vi.fn(),
  myShifts: vi.fn(),
  candidates: vi.fn(),
  events: vi.fn(),
  create: vi.fn(),
  respond: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: mocks.userId, tenantId: 'tenant', role: mocks.role },
  }),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: mocks.success }),
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    isPending: false,
    mutateAsync: path.endsWith('.create') ? mocks.create : mocks.respond,
  }),
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
        mine: { useQuery: mocks.mine },
        myShifts: { useQuery: mocks.myShifts },
        candidates: { useQuery: mocks.candidates },
        events: { useQuery: mocks.events },
      },
    },
  },
}));

import { MySchedulePage } from './MySchedulePage';
import { formatSwapShift } from './shiftSwapFormat';

const query = (data: unknown) => ({
  data,
  isPending: false,
  isFetching: false,
  error: null,
  refetch: mocks.refetch,
});
const offered = {
  id: 'offered',
  userId: 'cashier',
  userName: 'Ana',
  siteId: 'site',
  siteName: 'Central',
  startsAt: '2026-10-10T14:00:00.000Z',
  endsAt: '2026-10-10T22:00:00.000Z',
  timeZone: 'America/Bogota',
  version: 4,
};
const requested = {
  id: 'requested',
  userId: 'viewer',
  userName: 'Luis',
  siteId: 'site',
  siteName: 'Central',
  startsAt: '2026-10-11T14:00:00.000Z',
  endsAt: '2026-10-11T22:00:00.000Z',
  timeZone: 'America/Bogota',
  version: 7,
};
function request(overrides: Record<string, unknown> = {}) {
  return {
    id: 'swap',
    status: 'requested' as const,
    version: 1,
    createdAt: '2026-09-04T12:00:00.000Z',
    updatedAt: '2026-09-04T12:00:00.000Z',
    requester: { id: 'cashier', name: 'Ana', isActive: true },
    recipient: { id: 'viewer', name: 'Luis', isActive: true },
    offered: { ...offered, siteActive: true },
    requested: { ...requested, siteActive: true },
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.role = 'cashier';
  mocks.userId = 'cashier';
  mocks.mine.mockReturnValue(query({ items: [], nextCursor: null }));
  mocks.myShifts.mockReturnValue(query({ items: [offered], nextCursor: null }));
  mocks.candidates.mockReturnValue(query({ items: [requested], nextCursor: null }));
  mocks.events.mockReturnValue(query({ items: [], nextBeforeVersion: null }));
  mocks.create.mockResolvedValue({ id: 'swap', version: 1, status: 'requested' });
  mocks.respond.mockResolvedValue({ id: 'swap', version: 2, status: 'accepted' });
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue({ data: null });
  await i18next.changeLanguage('en');
});

describe('MySchedulePage shift exchange self-service', () => {
  it('falls back to the frozen ISO range instead of crashing on a legacy time zone', () => {
    expect(formatSwapShift({ ...offered, timeZone: 'Invalid/Legacy' }, 'en')).toBe(
      'Central · 2026-10-10T14:00:00.000Z – 2026-10-10T22:00:00.000Z'
    );
  });

  it('creates one request with the explicitly reviewed shift versions and trimmed reason', async () => {
    const user = userEvent.setup();
    render(<MySchedulePage />);
    await user.click(screen.getByRole('button', { name: 'Request an exchange' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('radio', { name: /Central/ }));
    expect(mocks.candidates).toHaveBeenLastCalledWith(
      { offeredShiftId: 'offered', offeredVersion: 4, limit: 20 },
      { enabled: true, gcTime: 0, staleTime: 0 }
    );
    await user.click(dialog.getByRole('radio', { name: /Luis/ }));
    await user.type(
      dialog.getByLabelText('Private operational reason'),
      '  Family schedule coverage  '
    );
    await user.click(dialog.getByRole('checkbox', { name: /reviewed these exact two shifts/i }));
    await user.click(dialog.getByRole('button', { name: 'Send exact request' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
        offeredShiftId: 'offered',
        offeredVersion: 4,
        requestedShiftId: 'requested',
        requestedVersion: 7,
        reason: 'Family schedule coverage',
      })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.invalidate).toHaveBeenCalledTimes(3);
  });

  it('records recipient consent against the displayed request version only after acknowledgement', async () => {
    mocks.userId = 'viewer';
    mocks.mine.mockReturnValue(query({ items: [request()], nextCursor: null }));
    const user = userEvent.setup();
    render(<MySchedulePage />);
    await user.click(screen.getByRole('button', { name: 'Accept exact exchange' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Confirm acceptance' })).toBeDisabled();
    await user.click(dialog.getByRole('checkbox'));
    await user.click(dialog.getByRole('button', { name: 'Confirm acceptance' }));
    await waitFor(() =>
      expect(mocks.respond).toHaveBeenCalledExactlyOnceWith({
        id: 'swap',
        expectedVersion: 1,
        status: 'accepted',
      })
    );
  });

  it('keeps the captured version and private reason after a safe stale failure', async () => {
    mocks.mine.mockReturnValue(query({ items: [request()], nextCursor: null }));
    mocks.respond.mockRejectedValue({
      data: { errorCode: 'STALE_VERSION' },
      message: 'SQLITE PRIVATE INTERNAL',
    });
    const user = userEvent.setup();
    render(<MySchedulePage />);
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(
      dialog.getByLabelText('Private operational reason'),
      'Keep the original reason'
    );
    await user.click(dialog.getByRole('button', { name: 'Confirm cancellation' }));
    await waitFor(() =>
      expect(mocks.respond).toHaveBeenCalledExactlyOnceWith({
        id: 'swap',
        expectedVersion: 1,
        status: 'cancelled',
        reason: 'Keep the original reason',
      })
    );
    expect(await dialog.findByRole('alert')).not.toHaveTextContent(/SQLITE|PRIVATE|INTERNAL/);
    expect(dialog.getByLabelText('Private operational reason')).toHaveValue(
      'Keep the original reason'
    );
  });

  it('loads private reasons only after history is opened and renders them as text', async () => {
    mocks.mine.mockReturnValue(query({ items: [request()], nextCursor: null }));
    mocks.events.mockReturnValue(
      query({
        items: [
          {
            id: 'event',
            version: 1,
            status: 'requested',
            actorId: 'cashier',
            actorName: 'Ana',
            reason: '<script>privateReason()</script>',
            createdAt: '2026-09-04T12:00:00.000Z',
          },
        ],
        nextBeforeVersion: null,
      })
    );
    const user = userEvent.setup();
    render(<MySchedulePage />);
    expect(mocks.events).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Private history' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('<script>privateReason()</script>')).toBeVisible();
    expect(dialog.querySelector('script')).toBeNull();
  });

  it('discards an open private request when the authenticated employee changes', async () => {
    const user = userEvent.setup();
    const view = render(<MySchedulePage />);
    await user.click(screen.getByRole('button', { name: 'Request an exchange' }));
    await user.type(screen.getByLabelText('Private operational reason'), 'Private handoff reason');
    mocks.userId = 'viewer';
    mocks.role = 'viewer';
    view.rerender(<MySchedulePage />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByDisplayValue('Private handoff reason')).toBeNull();
  });
});
