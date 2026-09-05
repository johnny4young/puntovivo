import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render, screen, within, waitFor, fireEvent } from '@/test/utils';
import type { AvailabilityRecord } from './availabilityTypes';

const mocks = vi.hoisted(() => ({
  role: 'manager',
  userId: 'operator',
  tenantId: 'tenant',
  list: vi.fn(),
  history: vi.fn(),
  employees: vi.fn(),
  create: vi.fn(),
  replace: vi.fn(),
  voidPolicy: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  success: vi.fn(),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: mocks.userId, tenantId: mocks.tenantId, role: mocks.role } }),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: mocks.success }),
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    isPending: false,
    mutateAsync: path.endsWith('.create')
      ? mocks.create
      : path.endsWith('.replace')
        ? mocks.replace
        : mocks.voidPolicy,
  }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      workforce: { availability: { invalidate: mocks.invalidate } },
      employeeShifts: { schedule: { invalidate: mocks.invalidate } },
      auditLogs: { invalidate: mocks.invalidate },
    }),
    workforce: {
      availability: {
        list: { useQuery: mocks.list },
        events: { useQuery: mocks.history },
        employees: { useQuery: mocks.employees },
      },
    },
  },
}));
import { AvailabilityPanel } from './AvailabilityPanel';

function row(): AvailabilityRecord {
  return {
    id: 'policy',
    userId: 'worker',
    userName: 'Ana',
    userActive: true,
    status: 'active',
    fromDate: '2026-09-07',
    untilDate: '2026-10-01',
    timeZone: 'America/Bogota',
    slots: [{ weekday: 1, startMinute: 540, endMinute: 1440 }],
    replacesId: null,
    version: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
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
  // RHF field arrays need unique identities; the global crypto fixture is constant.
  let id = 0;
  vi.mocked(crypto.randomUUID).mockImplementation(
    () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`
  );

  mocks.role = 'manager';
  mocks.userId = 'operator';
  mocks.tenantId = 'tenant';
  mocks.list.mockReturnValue(query({ items: [row()], nextCursor: null }));
  mocks.history.mockReturnValue(query({ items: [], nextBeforeVersion: null }));
  mocks.employees.mockReturnValue(
    query({ items: [{ id: 'worker', name: 'Ana', role: 'viewer' }], nextCursor: null })
  );
  mocks.create.mockResolvedValue({ id: 'policy', version: 1 });
  mocks.replace.mockResolvedValue({ id: 'successor', version: 1 });
  mocks.voidPolicy.mockResolvedValue({ id: 'policy', version: 2 });
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue({ data: null });
  await i18next.changeLanguage('en');
});
async function openCreate() {
  const user = userEvent.setup();
  const view = render(<AvailabilityPanel />);
  await user.click(screen.getByRole('button', { name: 'Set availability' }));
  return { user, view, dialog: within(screen.getByRole('dialog')) };
}
async function fillIdentity(
  dialog: ReturnType<typeof within>,
  user: ReturnType<typeof userEvent.setup>
) {
  await user.selectOptions(dialog.getByRole('combobox', { name: 'Employee' }), 'worker');
  fireEvent.change(dialog.getByLabelText('Effective from'), { target: { value: '2026-09-07' } });
  await user.type(
    dialog.getByLabelText('Private operational reason'),
    '  Explicit weekly availability  '
  );
}
describe('AvailabilityPanel operational decisions', () => {
  it.each(['cashier', 'viewer', 'waiter'])('does not mount management queries for %s', role => {
    mocks.role = role;
    render(<AvailabilityPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Only managers');
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.employees).not.toHaveBeenCalled();
  });
  it('creates an explicitly overnight open-ended policy through the bounded manager picker', async () => {
    const { user, dialog } = await openCreate();
    expect(mocks.employees).toHaveBeenCalledWith(
      { search: '', limit: 20 },
      { gcTime: 0, staleTime: 0 }
    );
    await fillIdentity(dialog, user);
    await user.click(dialog.getByRole('button', { name: 'Add weekly window' }));
    await user.selectOptions(dialog.getByLabelText('Day', { exact: true }), '7');
    fireEvent.change(dialog.getByLabelText('Start time'), { target: { value: '22:00' } });
    fireEvent.change(dialog.getByLabelText('End time'), { target: { value: '02:00' } });
    await user.click(dialog.getByLabelText('Ends on the following day (up to 24 hours)'));
    await user.click(dialog.getByRole('button', { name: 'Confirm availability decision' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
        userId: 'worker',
        fromDate: '2026-09-07',
        untilDate: null,
        slots: [
          { weekday: 1, startMinute: 0, endMinute: 120 },
          { weekday: 7, startMinute: 1320, endMinute: 1440 },
        ],
        reason: 'Explicit weekly availability',
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.invalidate).toHaveBeenCalledTimes(3);
  });
  it('requires explicit all-week unavailability acknowledgement', async () => {
    const { user, dialog } = await openCreate();
    await fillIdentity(dialog, user);
    await user.click(dialog.getByRole('button', { name: 'Confirm availability decision' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('unavailable all week');
    expect(mocks.create).not.toHaveBeenCalled();
    await user.click(dialog.getByRole('checkbox', { name: /unavailable all week/ }));
    await user.click(dialog.getByRole('button', { name: 'Confirm availability decision' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ slots: [] }))
    );
  });
  it('validates employee, reason, dates and overlap without mutating', async () => {
    const { user, dialog } = await openCreate();
    await user.click(dialog.getByRole('button', { name: 'Confirm availability decision' }));
    expect(await dialog.findByText('Choose an employee.')).toBeVisible();
    expect(dialog.getByText('Enter a reason between 10 and 500 characters.')).toBeVisible();
    await fillIdentity(dialog, user);
    fireEvent.change(dialog.getByLabelText('Exclusive end date (optional)'), {
      target: { value: '2026-09-07' },
    });
    await user.click(dialog.getByRole('button', { name: 'Confirm availability decision' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Choose valid dates');
    fireEvent.change(dialog.getByLabelText('Exclusive end date (optional)'), {
      target: { value: '' },
    });
    await user.click(dialog.getByRole('button', { name: 'Add weekly window' }));
    await user.click(dialog.getByRole('button', { name: 'Add weekly window' }));
    await user.click(dialog.getByRole('button', { name: 'Confirm availability decision' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('without overlaps');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('keeps the displayed version, inherited end and entered data after a stale replacement', async () => {
    mocks.replace.mockRejectedValue({
      data: { errorCode: 'STALE_VERSION' },
      message: 'SQLITE PRIVATE',
    });
    const user = userEvent.setup();
    const view = render(<AvailabilityPanel />);
    await user.click(screen.getByRole('button', { name: 'Change from a date' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByLabelText('Exclusive end date (optional)')).toBeNull();
    expect(dialog.getByLabelText('End time')).toHaveValue('00:00');
    expect(dialog.getByRole('checkbox')).toBeChecked();
    fireEvent.change(dialog.getByLabelText('Effective from'), { target: { value: '2026-09-14' } });
    await user.type(
      dialog.getByLabelText('Private operational reason'),
      'Explicit replacement reason'
    );
    mocks.list.mockReturnValue(
      query({ items: [{ ...row(), version: 2, untilDate: '2026-09-14' }], nextCursor: null })
    );
    view.rerender(<AvailabilityPanel />);
    await user.click(dialog.getByRole('button', { name: 'Confirm availability decision' }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledExactlyOnceWith({
        id: 'policy',
        expectedVersion: 1,
        fromDate: '2026-09-14',
        slots: row().slots,
        reason: 'Explicit replacement reason',
      })
    );
    expect(await dialog.findByRole('alert')).not.toHaveTextContent('SQLITE');
    expect(dialog.getByLabelText('Private operational reason')).toHaveValue(
      'Explicit replacement reason'
    );
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it.each(['2026-09-07', '2026-10-01', '2026-10-02'])(
    'rejects replacement outside the interior: %s',
    async date => {
      const user = userEvent.setup();
      render(<AvailabilityPanel />);
      await user.click(screen.getByRole('button', { name: 'Change from a date' }));
      const dialog = within(screen.getByRole('dialog'));
      fireEvent.change(dialog.getByLabelText('Effective from'), { target: { value: date } });
      await user.type(
        dialog.getByLabelText('Private operational reason'),
        'Explicit replacement reason'
      );
      await user.click(dialog.getByRole('button', { name: 'Confirm availability decision' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('Choose valid dates');
      expect(mocks.replace).not.toHaveBeenCalled();
    }
  );
  it('allows an explicit void for an archived employee without requiring a date or slots', async () => {
    mocks.list.mockReturnValue(
      query({ items: [{ ...row(), userActive: false }], nextCursor: null })
    );
    const user = userEvent.setup();
    render(<AvailabilityPanel />);
    expect(screen.getByRole('button', { name: 'Change from a date' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Void availability' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByLabelText('Effective from')).toBeNull();
    expect(dialog.getByText(/its entire period/)).toBeVisible();
    await user.type(
      dialog.getByLabelText('Private operational reason'),
      'Explicit removal of policy'
    );
    await user.click(dialog.getByRole('button', { name: 'Confirm availability decision' }));
    await waitFor(() =>
      expect(mocks.voidPolicy).toHaveBeenCalledExactlyOnceWith({
        id: 'policy',
        expectedVersion: 1,
        reason: 'Explicit removal of policy',
      })
    );
  });
  it('follows bounded pages and resets cursor when changing the voided filter', async () => {
    const cursor = { createdAt: row().createdAt, id: row().id };
    mocks.list.mockReturnValue(query({ items: [row()], nextCursor: cursor }));
    const user = userEvent.setup();
    render(<AvailabilityPanel />);
    await user.click(screen.getByRole('button', { name: 'Next policies' }));
    expect(mocks.list).toHaveBeenLastCalledWith(
      { includeVoided: false, limit: 20, cursor },
      { gcTime: 0, staleTime: 0 }
    );
    await user.click(screen.getByLabelText('Include voided policies'));
    expect(mocks.list).toHaveBeenLastCalledWith(
      { includeVoided: true, limit: 20 },
      { gcTime: 0, staleTime: 0 }
    );
  });
  it('renders private before/after history as text and uses bounded version pages', async () => {
    mocks.history.mockReturnValue(
      query({
        items: [
          {
            id: 'event',
            version: 2,
            kind: 'voided',
            createdAt: row().createdAt,
            actorId: 'operator',
            reason: '<script>privateReason()</script>',
            before: row(),
            after: { ...row(), status: 'voided' },
          },
        ],
        nextBeforeVersion: 2,
      })
    );
    const user = userEvent.setup();
    render(<AvailabilityPanel />);
    expect(mocks.history).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Private history' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('<script>privateReason()</script>')).toBeVisible();
    expect(screen.getByRole('dialog').querySelector('script')).toBeNull();
    expect(dialog.getByText('Before this decision')).toBeVisible();
    expect(dialog.getByText('After this decision')).toBeVisible();
    expect(dialog.getAllByText('Monday · 09:00–24:00')).toHaveLength(2);
    await user.click(dialog.getByRole('button', { name: 'Older decisions' }));
    expect(mocks.history).toHaveBeenLastCalledWith(
      { id: 'policy', limit: 20, beforeVersion: 2 },
      { gcTime: 0, staleTime: 0 }
    );
  });
  it('preserves dirty data and safe focus on keep editing', async () => {
    const { user, dialog } = await openCreate();
    await fillIdentity(dialog, user);
    await user.click(dialog.getByRole('button', { name: 'Close' }));
    const keep = screen.getByRole('button', { name: 'Keep editing' });
    expect(keep).toHaveFocus();
    await user.click(keep);
    expect(screen.getByLabelText('Private operational reason')).toHaveValue(
      '  Explicit weekly availability  '
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(['userId', 'tenantId', 'role'] as const)(
    'unmounts private forms on %s handoff',
    async key => {
      const { user, dialog, view } = await openCreate();
      await fillIdentity(dialog, user);
      mocks[key] = key === 'role' ? 'cashier' : 'another';
      view.rerender(<AvailabilityPanel />);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mocks.create).not.toHaveBeenCalled();
    }
  );
  it.each(['en', 'es'])(
    'shows translated server errors without internals in %s',
    async language => {
      await i18next.changeLanguage(language);
      mocks.list.mockReturnValue({
        ...query(undefined),
        error: {
          data: { errorCode: 'AVAILABILITY_TEMPORARILY_UNAVAILABLE' },
          message: 'SQLITE private',
        },
      });
      render(<AvailabilityPanel />);
      expect(screen.getByRole('alert')).not.toHaveTextContent(
        /SQLITE|AVAILABILITY_|workforceErrors:/
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        i18next.t('workforceErrors:server.AVAILABILITY_TEMPORARILY_UNAVAILABLE')
      );
    }
  );
});
