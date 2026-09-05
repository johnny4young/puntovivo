import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { act, fireEvent, render, screen, waitFor, within } from '@/test/utils';
import type { SchedulePlanView } from './schedulePlanTypes';

const mocks = vi.hoisted(() => ({
  currentSiteId: 'site',
  role: 'manager',
  userId: 'manager',
  tenantId: 'tenant',
  list: vi.fn(),
  get: vi.fn(),
  employees: vi.fn(),
  sites: vi.fn(),
  create: vi.fn(),
  regenerate: vi.fn(),
  publish: vi.fn(),
  discard: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  success: vi.fn(),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: mocks.userId, tenantId: mocks.tenantId, role: mocks.role } }),
}));
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: { id: mocks.currentSiteId } }),
}));
vi.mock('@/features/locale/LocaleProvider', () => ({
  useResolvedLocale: () => ({ timezone: 'America/Bogota' }),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: mocks.success }),
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    isPending: false,
    mutateAsync: path.endsWith('.create')
      ? mocks.create
      : path.endsWith('.regenerate')
        ? mocks.regenerate
        : path.endsWith('.publish')
          ? mocks.publish
          : mocks.discard,
  }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      workforce: { schedulePlans: { invalidate: mocks.invalidate } },
      employeeShifts: { schedule: { invalidate: mocks.invalidate } },
      auditLogs: { invalidate: mocks.invalidate },
    }),
    sites: { list: { useQuery: mocks.sites } },
    workforce: {
      schedulePlans: {
        list: { useQuery: mocks.list },
        get: { useQuery: mocks.get },
        employees: { useQuery: mocks.employees },
      },
    },
  },
}));
import { SchedulePlansPanel } from './SchedulePlansPanel';
import { SchedulePlanOccurrences } from './SchedulePlanPreview';

function view(): SchedulePlanView {
  return {
    plan: {
      id: 'plan',
      tenantId: 'tenant',
      siteId: 'site',
      title: 'Counter coverage',
      fromDate: '2026-09-07',
      untilDate: '2026-09-09',
      anchorWeekStart: '2026-09-07',
      timeZone: 'America/Bogota',
      rules: [
        {
          id: 'rule',
          userId: 'worker',
          weekdays: [1, 2],
          intervalWeeks: 1,
          startTime: '09:00',
          endTime: '17:00',
          endDayOffset: 0,
          notes: 'Private coverage',
        },
      ],
      status: 'draft',
      version: 1,
      occurrenceCount: 2,
      createdByUserId: 'manager',
      updatedByUserId: 'manager',
      decidedAt: null,
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
    occurrences: [7, 8].map(day => ({
      id: String(day),
      tenantId: 'tenant',
      planId: 'plan',
      ruleId: 'rule',
      userId: 'worker',
      startDate: `2026-09-0${day}`,
      endDate: `2026-09-0${day}`,
      startTime: '09:00',
      endTime: '17:00',
      startsAt: `2026-09-0${day}T14:00:00.000Z`,
      endsAt: `2026-09-0${day}T22:00:00.000Z`,
      notes: 'Private coverage',
      publishedShiftId: null,
    })),
    display: {
      employees: [{ id: 'worker', name: 'Ana', isActive: true }],
      site: { id: 'site', name: 'Central', isActive: true },
    },
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
  mocks.currentSiteId = 'site';
  mocks.role = 'manager';
  mocks.userId = 'manager';
  mocks.tenantId = 'tenant';
  let id = 0;
  vi.mocked(crypto.randomUUID).mockImplementation(
    () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`
  );
  mocks.sites.mockReturnValue(
    query({ items: [{ id: 'site', name: 'Central', isActive: true }], activeSiteId: 'site' })
  );
  mocks.list.mockReturnValue(query({ items: [view().plan], nextCursor: null }));
  mocks.get.mockReturnValue(query(view()));
  mocks.employees.mockReturnValue(
    query({ items: [{ id: 'worker', name: 'Ana', role: 'viewer' }], nextCursor: null })
  );
  for (const mutation of [mocks.create, mocks.regenerate, mocks.publish, mocks.discard])
    mutation.mockResolvedValue({ id: 'plan' });
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue({ data: view() });
  await i18next.changeLanguage('en');
});
async function preview() {
  const user = userEvent.setup(),
    rendered = render(<SchedulePlansPanel />);
  await user.click(screen.getByRole('button', { name: 'Review plan' }));
  await screen.findByRole('dialog', { name: 'Review plan' });
  return { user, rendered };
}
describe('recurring plan management', () => {
  it('never carries a pagination cursor across a global site change', async () => {
    const cursor = { id: 'older-plan', createdAt: '2026-09-01T00:00:00.000Z' };
    mocks.list.mockReturnValue(query({ items: [view().plan], nextCursor: cursor }));
    const rendered = render(<SchedulePlansPanel />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next' }));
    expect(mocks.list).toHaveBeenLastCalledWith(
      { siteId: 'site', limit: 20, cursor },
      expect.anything()
    );
    mocks.currentSiteId = 'second-site';
    rendered.rerender(<SchedulePlansPanel />);
    expect(mocks.list).toHaveBeenLastCalledWith(
      { siteId: 'second-site', limit: 20 },
      expect.anything()
    );
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });
  it.each(['cashier', 'viewer'])('does not query private data for %s', role => {
    mocks.role = role;
    render(<SchedulePlansPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Only a manager');
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.sites).not.toHaveBeenCalled();
  });
  it('creates only a non-operative draft, then opens the persisted preview', async () => {
    const user = userEvent.setup();
    render(<SchedulePlansPanel />);
    await user.click(screen.getByRole('button', { name: 'Create recurring draft' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Plan name'), 'Counter coverage');
    fireEvent.change(dialog.getByLabelText('First starting date'), {
      target: { value: '2026-09-07' },
    });
    fireEvent.change(dialog.getByLabelText('Exclusive last starting date'), {
      target: { value: '2026-09-09' },
    });
    fireEvent.change(dialog.getByLabelText('Reference Monday'), {
      target: { value: '2026-09-07' },
    });
    await user.click(dialog.getByRole('button', { name: 'Add recurrence rule' }));
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Employee' }), 'worker');
    await user.click(dialog.getByRole('checkbox', { name: 'Tuesday' }));
    await user.click(dialog.getByRole('button', { name: 'Save and preview draft' }));
    expect(mocks.create).toHaveBeenCalledWith({
      title: 'Counter coverage',
      recurrence: {
        siteId: 'site',
        fromDate: '2026-09-07',
        untilDate: '2026-09-09',
        anchorWeekStart: '2026-09-07',
        rules: [
          {
            id: expect.any(String),
            userId: 'worker',
            weekdays: [1, 2],
            intervalWeeks: 1,
            startTime: '09:00',
            endTime: '17:00',
            endDayOffset: 0,
            notes: null,
          },
        ],
      },
    });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog', { name: 'Review plan' })).toHaveTextContent(
      'Not an operational shift'
    );
    expect(mocks.get).toHaveBeenCalledWith({ id: 'plan' }, { gcTime: 0, staleTime: 0 });
  });
  it('requires publication acknowledgement and blocks dismissal and double submit until a safe rejection', async () => {
    let reject!: (error: unknown) => void;
    mocks.publish.mockReturnValue(
      new Promise((_resolve, failure) => {
        reject = failure;
      })
    );
    const { user, rendered } = await preview();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish shifts' })
    );
    const dialog = within(screen.getByRole('dialog', { name: 'Publish shifts' }));
    const confirm = dialog.getByRole('button', { name: 'Confirm publication' });
    expect(confirm).toBeDisabled();
    await user.click(dialog.getByRole('checkbox'));
    await user.click(confirm);
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith({ id: 'plan', expectedVersion: 1 });
    expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(dialog.getByRole('button', { name: 'Close' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toHaveTextContent('Version 1');
    const replacement = view();
    replacement.plan.version = 2;
    mocks.get.mockReturnValue(query(replacement));
    rendered.rerender(<SchedulePlansPanel />);
    await act(async () => {
      reject({ data: { errorCode: 'SCHEDULE_PLAN_CHANGED' }, message: 'PRIVATE_SQLITE_DETAIL' });
    });
    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'The draft or scheduling policy changed'
    );
    expect(screen.getByRole('dialog')).not.toHaveTextContent('PRIVATE_SQLITE_DETAIL');
    expect(screen.getByRole('dialog')).toHaveTextContent('Version 1');
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });
  it('regenerates from captured intent with an explicit reason and no automatic publication', async () => {
    const { user } = await preview();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate draft' })
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('combobox', { name: 'Employee' })).toHaveValue('worker');
    fireEvent.change(dialog.getByLabelText('End time'), { target: { value: '16:00' } });
    await user.type(
      dialog.getByLabelText('Private operational reason'),
      'Explicit coverage adjustment'
    );
    await user.click(dialog.getByRole('button', { name: 'Save and preview draft' }));
    expect(mocks.regenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'plan',
        expectedVersion: 1,
        reason: 'Explicit coverage adjustment',
        recurrence: expect.objectContaining({
          rules: [expect.objectContaining({ id: 'rule', endTime: '16:00' })],
        }),
      })
    );
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('discards with a reason and exact version', async () => {
    const { user } = await preview();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard draft' })
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Confirm discard' })).toBeDisabled();
    await user.type(
      dialog.getByLabelText('Private operational reason'),
      'Coverage is no longer needed'
    );
    await user.click(dialog.getByRole('button', { name: 'Confirm discard' }));
    expect(mocks.discard).toHaveBeenCalledWith({
      id: 'plan',
      expectedVersion: 1,
      reason: 'Coverage is no longer needed',
    });
  });
  it('hides stale details on an authorization error', async () => {
    mocks.get.mockReturnValue({
      ...query(view()),
      error: { data: { errorCode: 'SCHEDULE_EMPLOYEE_NOT_FOUND' } },
    });
    await preview();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('alert')).toHaveTextContent('not available');
    expect(dialog.queryByText('Private coverage')).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Publish shifts' })).not.toBeInTheDocument();
  });
  it('drops the private modal on a staff handoff', async () => {
    const { rendered } = await preview();
    mocks.userId = 'cashier';
    mocks.role = 'cashier';
    rendered.rerender(<SchedulePlansPanel />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Private coverage')).not.toBeInTheDocument();
  });
  it('renders neutral Spanish without untranslated keys', async () => {
    await i18next.changeLanguage('es');
    render(<SchedulePlansPanel />);
    expect(screen.getByRole('heading', { name: 'Planes de horarios recurrentes' })).toBeVisible();
    expect(screen.getByText('2 turnos · America/Bogota')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Crear borrador recurrente' })).toBeVisible();
  });
  it('mounts at most 20 preview occurrences and preserves the last partial page', async () => {
    const data = view();
    data.occurrences = Array.from({ length: 21 }, (_, index) => ({
      ...data.occurrences[0]!,
      id: String(index),
    }));
    render(<SchedulePlanOccurrences view={data} />);
    expect(screen.getAllByTestId('plan-occurrence')).toHaveLength(20);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getAllByTestId('plan-occurrence')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
  it('preserves dirty form values after validation and unsaved-close cancellation', async () => {
    const user = userEvent.setup();
    render(<SchedulePlansPanel />);
    await user.click(screen.getByRole('button', { name: 'Create recurring draft' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Plan name'), 'Unsaved draft');
    await user.click(dialog.getByRole('button', { name: 'Save and preview draft' }));
    expect(dialog.getByRole('alert')).toBeVisible();
    expect(mocks.create).not.toHaveBeenCalled();
    await user.click(dialog.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: /keep editing/i }));
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getByLabelText('Plan name')).toHaveValue(
        'Unsaved draft'
      )
    );
  });
});
