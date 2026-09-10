import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render, screen, within, waitFor, fireEvent } from '@/test/utils';
import type { TimeOffRecord } from './timeOffTypes';
const mocks = vi.hoisted(() => ({
  role: 'manager' as 'admin' | 'manager' | 'viewer' | 'cashier',
  list: vi.fn(),
  history: vi.fn(),
  employees: vi.fn(),
  sites: vi.fn(),
  create: vi.fn(),
  advance: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  success: vi.fn(),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'operator', tenantId: 'tenant', role: mocks.role } }),
}));
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: { id: 'site' } }),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: mocks.success }),
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    isPending: false,
    mutateAsync: path.endsWith('.create') ? mocks.create : mocks.advance,
  }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      workforce: { timeOff: { invalidate: mocks.invalidate } },
      employeeShifts: { schedule: { invalidate: mocks.invalidate } },
      auditLogs: { invalidate: mocks.invalidate },
    }),
    sites: { list: { useQuery: mocks.sites } },
    workforce: {
      timeOff: {
        list: { useQuery: mocks.list },
        events: { useQuery: mocks.history },
        employees: { useQuery: mocks.employees },
      },
    },
  },
}));
import { TimeOffPanel } from './TimeOffPanel';
function row(): TimeOffRecord {
  return {
    id: 'absence',
    userId: 'worker',
    userName: 'Ana',
    userActive: true,
    siteId: 'site',
    siteName: 'Central',
    siteActive: true,
    kind: 'vacation',
    status: 'pending',
    fromDate: '2026-09-07',
    untilDate: '2026-09-09',
    timeZone: 'America/Bogota',
    version: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    approvedAt: null,
    approvedByUserId: null,
  };
}
const query = (data: unknown) => ({
  data,
  isPending: false,
  isFetching: false,
  error: null,
  refetch: mocks.refetch,
});
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.role = 'manager';
  mocks.list.mockReturnValue(query({ items: [row()], nextCursor: null }));
  mocks.history.mockReturnValue(query({ items: [], nextBeforeVersion: null }));
  mocks.sites.mockReturnValue(query({ items: [{ id: 'site', name: 'Central', isActive: true }] }));
  mocks.employees.mockReturnValue(
    query({
      items: [{ id: 'worker', name: 'Ana', role: 'viewer' }],
      nextCursor: null,
    })
  );
  mocks.create.mockResolvedValue({ id: 'absence', siteId: 'site', version: 1 });
  mocks.advance.mockResolvedValue({ id: 'absence', siteId: 'site', version: 2 });
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue({ data: null });
  await i18next.changeLanguage('en');
});
async function openCreate() {
  const user = userEvent.setup();
  render(<TimeOffPanel />);
  await user.click(screen.getByRole('button', { name: 'Request absence' }));
  return { user, dialog: within(screen.getByRole('dialog')) };
}
describe('TimeOffPanel operational decisions', () => {
  it.each(['cashier', 'viewer'] as const)('never mounts private requests for %s', role => {
    mocks.role = role;
    render(<TimeOffPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Only managers');
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.sites).not.toHaveBeenCalled();
  });
  it('creates an explicit pending request with bounded picker and half-open dates', async () => {
    const { user, dialog } = await openCreate();
    expect(dialog.queryByRole('option', { name: /Administrator/ })).toBeNull();
    expect(mocks.employees).toHaveBeenCalledWith(
      { search: '', limit: 20 },
      { gcTime: 0, staleTime: 0 }
    );
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Employee' }), 'worker');
    fireEvent.change(dialog.getByLabelText('First day absent'), {
      target: { value: '2026-09-07' },
    });
    fireEvent.change(dialog.getByLabelText('Return date (not included)'), {
      target: { value: '2026-09-09' },
    });
    await user.type(dialog.getByLabelText('Private operational reason'), 'Explicit absence reason');
    await user.click(dialog.getByRole('button', { name: 'Confirm decision' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
        userId: 'worker',
        siteId: 'site',
        kind: 'vacation',
        fromDate: '2026-09-07',
        untilDate: '2026-09-09',
        reason: 'Explicit absence reason',
      })
    );
    expect(mocks.advance).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.invalidate).toHaveBeenCalledTimes(3);
  });
  it('validates dates and private reason without a server mutation', async () => {
    const { user, dialog } = await openCreate();
    await user.click(dialog.getByRole('button', { name: 'Confirm decision' }));
    expect(await dialog.findByText(/Choose valid dates/)).toBeVisible();
    expect(dialog.getByText('Enter a reason between 10 and 500 characters.')).toBeVisible();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('keeps the original version and safe error after a stale decision', async () => {
    mocks.advance.mockRejectedValue({
      data: { errorCode: 'STALE_VERSION' },
      message: 'SQLITE PRIVATE',
    });
    const user = userEvent.setup();
    const view = render(<TimeOffPanel />);
    await user.click(screen.getByRole('button', { name: 'Approve absence' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(
      dialog.getByLabelText('Private operational reason'),
      'Explicit approval reason'
    );
    mocks.list.mockReturnValue(
      query({ items: [{ ...row(), version: 2, status: 'approved' }], nextCursor: null })
    );
    view.rerender(<TimeOffPanel />);
    await user.click(dialog.getByRole('button', { name: 'Confirm decision' }));
    await waitFor(() =>
      expect(mocks.advance).toHaveBeenCalledExactlyOnceWith({
        id: 'absence',
        siteId: 'site',
        expectedVersion: 1,
        status: 'approved',
        reason: 'Explicit approval reason',
      })
    );
    expect(await dialog.findByRole('alert')).not.toHaveTextContent('SQLITE');
    expect(dialog.getByLabelText('Private operational reason')).toHaveValue(
      'Explicit approval reason'
    );
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it('disables own approval and archived approval, but keeps explicit cancellation and history', () => {
    mocks.list.mockReturnValue(
      query({
        items: [
          { ...row(), userId: 'operator' },
          { ...row(), id: 'archived', userActive: false },
        ],
        nextCursor: null,
      })
    );
    render(<TimeOffPanel />);
    for (const button of screen.getAllByRole('button', { name: 'Approve absence' }))
      expect(button).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Cancel absence' }))
      expect(button).toBeEnabled();
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it('follows bounded pages and resets the cursor when filters change', async () => {
    const cursor = { createdAt: row().createdAt, id: row().id };
    mocks.list.mockReturnValue(query({ items: [row()], nextCursor: cursor }));
    const user = userEvent.setup();
    render(<TimeOffPanel />);
    await user.click(screen.getByRole('button', { name: 'Next requests' }));
    expect(mocks.list).toHaveBeenLastCalledWith({ limit: 20, cursor }, { gcTime: 0, staleTime: 0 });
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'approved');
    expect(mocks.list).toHaveBeenLastCalledWith(
      { limit: 20, status: 'approved' },
      { gcTime: 0, staleTime: 0 }
    );
  });
  it('renders private explanations only inside history as text, including original approval after cancellation', async () => {
    const current = row();
    const after = {
      ...current,
      status: 'cancelled',
      startsAt: '2026-09-07T05:00:00.000Z',
      endsAt: '2026-09-09T05:00:00.000Z',
      approvedByUserId: 'manager',
      approvedAt: '2026-09-01T13:00:00.000Z',
    };
    mocks.history.mockReturnValue(
      query({
        items: [
          {
            id: 'event',
            version: 3,
            kind: 'cancelled',
            createdAt: current.createdAt,
            actorId: 'manager',
            reason: '<script>privateReason()</script>',
            before: { ...after, status: 'approved' },
            after,
          },
        ],
        nextBeforeVersion: null,
      })
    );
    const user = userEvent.setup();
    render(<TimeOffPanel />);
    expect(mocks.history).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Private history' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('<script>privateReason()</script>')).toBeVisible();
    expect(dialog.getByText(/Approved by manager at/)).toBeVisible();
    expect(screen.getByRole('dialog').querySelector('script')).toBeNull();
  });
  it('preserves entered data and focus when closing a dirty form', async () => {
    const { user, dialog } = await openCreate();
    await user.type(
      dialog.getByLabelText('Private operational reason'),
      'Keep this operational reason'
    );
    await user.click(dialog.getByRole('button', { name: 'Close' }));
    const keep = screen.getByRole('button', { name: 'Keep editing' });
    expect(keep).toHaveFocus();
    await user.click(keep);
    expect(screen.getByLabelText('Private operational reason')).toHaveValue(
      'Keep this operational reason'
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('renders Spanish operational copy without raw namespace keys', async () => {
    await i18next.changeLanguage('es');
    render(<TimeOffPanel />);
    expect(
      screen.getByRole('heading', { name: 'Vacaciones, licencias y ausencias' })
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Aprobar ausencia' })).toBeEnabled();
    expect(screen.getByTestId('time-off-panel')).not.toHaveTextContent('timeOff:');
  });
});
