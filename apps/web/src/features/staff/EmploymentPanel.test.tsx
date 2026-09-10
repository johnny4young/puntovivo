import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render, screen, within, waitFor } from '@/test/utils';
import type { EmploymentContract, EmploymentSnapshot } from './employmentTypes';

const mocks = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'manager' | 'cashier' | 'viewer',
  contracts: vi.fn(),
  assignments: vi.fn(),
  context: vi.fn(),
  history: vi.fn(),
  employees: vi.fn(),
  create: vi.fn(),
  replace: vi.fn(),
  end: vi.fn(),
  voidCommand: vi.fn(),
  critical: vi.fn(),
  refetch: vi.fn(),
  invalidate: vi.fn(),
  auditInvalidate: vi.fn(),
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
  useCriticalMutation: (path: string) => {
    mocks.critical(path);
    return {
      isPending: false,
      mutateAsync: path.endsWith('.create')
        ? mocks.create
        : path.endsWith('.replace')
          ? mocks.replace
          : path.endsWith('.end')
            ? mocks.end
            : mocks.voidCommand,
    };
  },
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      workforce: { invalidate: mocks.invalidate },
      auditLogs: { invalidate: mocks.auditInvalidate },
    }),
    sites: {
      list: {
        useQuery: () => ({
          data: {
            items: [
              { id: 'site', name: 'Central', isActive: true },
              { id: 'second', name: 'Second', isActive: true },
              { id: 'archived', name: 'Old site', isActive: false },
            ],
          },
          error: null,
          refetch: mocks.refetch,
        }),
      },
    },
    users: { list: { useQuery: mocks.employees } },
    workforce: {
      assignments: { useQuery: mocks.assignments },
      contracts: {
        list: { useQuery: mocks.contracts },
        context: { useQuery: mocks.context },
        events: { useQuery: mocks.history },
      },
    },
  },
}));
import { EmploymentPanel } from './EmploymentPanel';

function row(): EmploymentContract {
  return {
    id: 'terms',
    userId: 'worker',
    userName: 'Ana',
    userActive: true,
    siteId: 'site',
    siteName: 'Central',
    siteActive: true,
    position: 'Supervisor',
    effectiveFrom: '2026-01-01',
    effectiveUntil: '2027-01-01',
    timeZone: 'America/Bogota',
    version: 2,
    currencyCode: 'COP',
    payBasis: 'monthly',
    payAmount: 2500000,
    costingHourlyRate: null,
    predecessorId: null,
    voidedAt: null,
  };
}
function query(data: unknown) {
  return { data, error: null, isPending: false, isFetching: false, refetch: mocks.refetch };
}
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.role = 'admin';
  mocks.contracts.mockReturnValue(query({ items: [row()], nextCursor: null }));
  const contract = row();
  const assignment = {
    id: contract.id,
    userId: contract.userId,
    userName: contract.userName,
    userActive: contract.userActive,
    siteId: contract.siteId,
    siteName: contract.siteName,
    siteActive: contract.siteActive,
    position: contract.position,
    effectiveFrom: contract.effectiveFrom,
    effectiveUntil: contract.effectiveUntil,
    timeZone: contract.timeZone,
    version: contract.version,
  };
  mocks.assignments.mockReturnValue(query({ items: [assignment], nextCursor: null }));
  mocks.context.mockReturnValue(query({ currencyCode: 'COP', timeZone: 'America/Bogota' }));
  mocks.history.mockReturnValue(query({ items: [], nextBeforeVersion: null }));
  mocks.employees.mockReturnValue(
    query({
      items: [{ id: 'viewer-worker', name: 'Viewer Worker', role: 'viewer' }],
      totalPages: 2,
    })
  );
  for (const action of [mocks.create, mocks.replace, mocks.end, mocks.voidCommand])
    action.mockResolvedValue({ id: 'new', siteId: 'site', version: 1 });
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.auditInvalidate.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue({ data: null });
  await i18next.changeLanguage('en');
});

async function openCreate() {
  const user = userEvent.setup();
  const view = render(<EmploymentPanel />);
  await user.click(screen.getByRole('button', { name: 'Add employment terms' }));
  const dialog = within(await screen.findByRole('dialog'));
  return { user, dialog, view };
}

describe('EmploymentPanel privacy and lifecycle', () => {
  it('shows exact agreed cents independently of currency catalog defaults', () => {
    mocks.contracts.mockReturnValue(
      query({
        items: [{ ...row(), payAmount: 12345.67, costingHourlyRate: 12.34 }],
        nextCursor: null,
      })
    );
    render(<EmploymentPanel />);
    expect(screen.getByText(/12,345\.67/)).toBeVisible();
    expect(screen.getByText(/12\.34/)).toBeVisible();
  });
  it('renders frozen private history safely and follows bounded version pages', async () => {
    const evidence: EmploymentSnapshot = {
      terms: {
        userId: 'worker',
        siteId: 'site',
        position: 'Original position',
        effectiveFrom: '2026-01-01',
        effectiveUntil: null,
        currencyCode: 'COP',
        pay: { basis: 'monthly', amount: 2000000.67, costingHourlyRate: null },
      },
      timeZone: 'America/Bogota',
      version: 1,
      voidedAt: null,
    };
    mocks.history.mockReturnValue(
      query({
        items: [
          {
            id: 'event',
            kind: 'ended',
            version: 2,
            actorId: 'admin',
            createdAt: '2026-09-04T10:00:00Z',
            reason: '<img src=x onerror=alert(1)>',
            before: evidence,
            after: {
              ...evidence,
              version: 2,
              terms: { ...evidence.terms, effectiveUntil: '2027-01-01' },
            },
          },
        ],
        nextBeforeVersion: 2,
      })
    );
    const user = userEvent.setup();
    const { container } = render(<EmploymentPanel />);
    await user.click(screen.getByRole('button', { name: 'Private history' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
    await user.click(dialog.getByText('Before change'));
    expect(dialog.getAllByText('Original position')[0]).toBeVisible();
    expect(dialog.getAllByText(/2,000,000\.67/)[0]).toBeVisible();
    expect(
      dialog.getAllByText('Operational hourly cost unknown — not treated as zero')[0]
    ).toBeVisible();
    expect(dialog.getByRole('button', { name: 'Newer changes' })).toBeDisabled();
    await user.click(dialog.getByRole('button', { name: 'Older changes' }));
    expect(mocks.history).toHaveBeenLastCalledWith(
      { id: 'terms', siteId: 'site', limit: 20, beforeVersion: 2 },
      { gcTime: 0, staleTime: 0 }
    );
    await user.click(dialog.getByRole('button', { name: 'Newer changes' }));
    expect(mocks.history).toHaveBeenLastCalledWith(
      { id: 'terms', siteId: 'site', limit: 20 },
      { gcTime: 0, staleTime: 0 }
    );
  });
  it('ignores hidden monthly costing when switching to hourly terms', async () => {
    const { user, dialog } = await openCreate();
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Employee' }), 'viewer-worker');
    await user.type(dialog.getByLabelText('Position'), 'Warehouse support');
    await user.type(dialog.getByLabelText('Effective from'), '2026-09-04');
    await user.type(dialog.getByLabelText('Agreed amount (COP)'), '12500');
    await user.type(
      dialog.getByLabelText('Private reason and supporting context'),
      'Approved hourly agreement'
    );
    await user.selectOptions(dialog.getByLabelText('Pay basis'), 'monthly');
    await user.type(dialog.getByLabelText(/^Operational hourly cost \(COP,/), '-5');
    await user.click(dialog.getByRole('button', { name: 'Save terms' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Check the marked fields');
    expect(mocks.create).not.toHaveBeenCalled();
    await user.selectOptions(dialog.getByLabelText('Pay basis'), 'hourly');
    await user.click(dialog.getByRole('button', { name: 'Save terms' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          terms: expect.objectContaining({ pay: { basis: 'hourly', amount: 12500 } }),
        })
      )
    );
  });
  it('keeps a dirty form and its currency snapshot during background context failures', async () => {
    const { user, dialog, view } = await openCreate();
    await user.type(dialog.getByLabelText('Position'), 'Unfinished agreement');
    await user.type(dialog.getByLabelText('Agreed amount (COP)'), '12500');
    await user.type(
      dialog.getByLabelText('Private reason and supporting context'),
      'Review pending in this form'
    );
    mocks.context.mockReturnValue({
      ...query({ currencyCode: 'COP', timeZone: 'America/Bogota' }),
      error: { data: { errorCode: 'EMPLOYMENT_CONTRACT_TEMPORARILY_UNAVAILABLE' } },
    });
    view.rerender(<EmploymentPanel />);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByLabelText('Position')).toHaveValue('Unfinished agreement');
    mocks.context.mockReturnValue(query({ currencyCode: 'USD', timeZone: 'America/Bogota' }));
    view.rerender(<EmploymentPanel />);
    expect(screen.getByLabelText('Agreed amount (COP)')).toHaveValue(12500);
    expect(screen.getByLabelText('Private reason and supporting context')).toHaveValue(
      'Review pending in this form'
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('requests only safe assignments for managers, including on user handoff', () => {
    const view = render(<EmploymentPanel />);
    expect(screen.getByText('Operational hourly cost unknown — not treated as zero')).toBeVisible();
    mocks.contracts.mockClear();
    mocks.context.mockClear();
    mocks.critical.mockClear();
    mocks.role = 'manager';
    view.rerender(<EmploymentPanel />);
    expect(mocks.assignments).toHaveBeenCalled();
    expect(mocks.contracts).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.critical).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Operational hourly cost unknown — not treated as zero')
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Private history' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add employment terms' })).not.toBeInTheDocument();
  });
  it.each(['cashier', 'viewer'] as const)('makes no employment requests for %s', role => {
    mocks.role = role;
    render(<EmploymentPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Only administrators and managers');
    expect(mocks.contracts).not.toHaveBeenCalled();
    expect(mocks.assignments).not.toHaveBeenCalled();
  });
  it('rejects blank terms rather than creating a zero wage', async () => {
    const { user, dialog } = await openCreate();
    await user.click(dialog.getByRole('button', { name: 'Save terms' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Check the marked fields');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('creates monthly terms for a viewer worker with unknown costing, then invalidates read sides', async () => {
    const { user, dialog } = await openCreate();
    await user.selectOptions(dialog.getByRole('combobox', { name: 'Employee' }), 'viewer-worker');
    await user.type(dialog.getByLabelText('Position'), 'Warehouse support');
    await user.type(dialog.getByLabelText('Effective from'), '2026-09-04');
    await user.selectOptions(dialog.getByLabelText('Pay basis'), 'monthly');
    await user.type(dialog.getByLabelText('Agreed amount (COP)'), '1900000');
    await user.type(
      dialog.getByLabelText('Private reason and supporting context'),
      'Approved employment terms'
    );
    await user.click(dialog.getByRole('button', { name: 'Save terms' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        terms: {
          userId: 'viewer-worker',
          siteId: 'site',
          position: 'Warehouse support',
          effectiveFrom: '2026-09-04',
          effectiveUntil: null,
          currencyCode: 'COP',
          pay: { basis: 'monthly', amount: 1900000, costingHourlyRate: null },
        },
        reason: 'Approved employment terms',
      })
    );
    expect(mocks.invalidate).toHaveBeenCalled();
    expect(mocks.auditInvalidate).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('keeps employee identity and original end when replacing site and salary', async () => {
    const user = userEvent.setup();
    render(<EmploymentPanel />);
    await user.click(screen.getByRole('button', { name: 'Change terms from a date' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.queryByRole('combobox', { name: 'Employee' })).not.toBeInTheDocument();
    expect(dialog.getByLabelText(/^First day no longer effective/)).toBeDisabled();
    await user.type(dialog.getByLabelText('Effective from'), '2026-09-04');
    await user.selectOptions(dialog.getByLabelText('Site', { exact: true }), 'second');
    await user.clear(dialog.getByLabelText('Agreed amount (COP)'));
    await user.type(dialog.getByLabelText('Agreed amount (COP)'), '3000000');
    await user.type(
      dialog.getByLabelText('Private reason and supporting context'),
      'Agreed change of site and wage'
    );
    await user.click(dialog.getByRole('button', { name: 'Save terms' }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'terms',
          siteId: 'site',
          expectedVersion: 2,
          terms: expect.objectContaining({
            userId: 'worker',
            siteId: 'second',
            effectiveUntil: '2027-01-01',
            pay: { basis: 'monthly', amount: 3000000, costingHourlyRate: null },
          }),
        })
      )
    );
  });
  it('preserves entered values and the selected version after a stale response', async () => {
    mocks.end.mockRejectedValue({ data: { errorCode: 'STALE_VERSION' } });
    const user = userEvent.setup();
    render(<EmploymentPanel />);
    await user.click(screen.getByRole('button', { name: 'End terms' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.clear(dialog.getByLabelText(/^First day no longer effective/));
    await user.type(dialog.getByLabelText(/^First day no longer effective/), '2026-10-01');
    await user.type(
      dialog.getByLabelText('Private reason and supporting context'),
      'Actual agreed end date'
    );
    await user.click(dialog.getByRole('button', { name: 'Save terms' }));
    expect(await dialog.findByRole('alert')).not.toHaveTextContent('STALE_VERSION');
    expect(dialog.getByLabelText(/^First day no longer effective/)).toHaveValue('2026-10-01');
    await user.click(dialog.getByRole('button', { name: 'Save terms' }));
    expect(mocks.end).toHaveBeenCalledTimes(2);
    expect(mocks.end.mock.calls.every(([input]) => input.expectedVersion === 2)).toBe(true);
  });
  it('does not duplicate a pending void on double confirmation', async () => {
    let finish!: (value: { id: string; siteId: string; version: number }) => void;
    mocks.voidCommand.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    const user = userEvent.setup();
    render(<EmploymentPanel />);
    await user.click(screen.getByRole('button', { name: 'Void incorrect terms' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(
      dialog.getByLabelText('Private reason and supporting context'),
      'This record was entered in error'
    );
    await user.dblClick(dialog.getByRole('button', { name: 'Save terms' }));
    expect(mocks.voidCommand).toHaveBeenCalledTimes(1);
    finish({ id: 'terms', siteId: 'site', version: 3 });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('offers a discard confirmation without losing an unfinished form', async () => {
    const { user, dialog } = await openCreate();
    await user.type(dialog.getByLabelText('Position'), 'Incomplete position');
    await user.click(dialog.getAllByRole('button', { name: 'Close' }).at(-1)!);
    await user.click(await screen.findByRole('button', { name: /keep editing/i }));
    expect(screen.getByLabelText('Position')).toHaveValue('Incomplete position');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('paginates employee choices instead of truncating the catalog', async () => {
    const { user, dialog } = await openCreate();
    await user.click(dialog.getByRole('button', { name: 'Next employees' }));
    expect(mocks.employees).toHaveBeenLastCalledWith(
      { page: 2, perPage: 20, search: '', isActive: true },
      { gcTime: 0 }
    );
  });
  it('resets keyset pagination on a site or effective-date change', async () => {
    mocks.contracts.mockReturnValue(
      query({ items: [row()], nextCursor: { effectiveFrom: '2026-01-01', id: 'terms' } })
    );
    const user = userEvent.setup();
    render(<EmploymentPanel />);
    await user.click(screen.getByRole('button', { name: 'Next assignments' }));
    expect(mocks.contracts.mock.lastCall?.[0].cursor).toEqual({
      effectiveFrom: '2026-01-01',
      id: 'terms',
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Site' }), 'second');
    expect(mocks.contracts.mock.lastCall?.[0]).toEqual({
      limit: 20,
      includeVoided: false,
      siteId: 'second',
    });
  });
  it('requires explicit new amounts when the business currency changed', async () => {
    mocks.context.mockReturnValue(query({ currencyCode: 'USD', timeZone: 'America/Bogota' }));
    const user = userEvent.setup();
    render(<EmploymentPanel />);
    await user.click(screen.getByRole('button', { name: 'Change terms from a date' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('alert')).toHaveTextContent('no currency conversion');
    expect(dialog.getByLabelText('Agreed amount (USD)')).toHaveValue(null);
  });
});
