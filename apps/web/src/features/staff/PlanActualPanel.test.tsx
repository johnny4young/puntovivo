import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@/test/utils';

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  invalidate: vi.fn(),
  invalidateSchedule: vi.fn(),
  context: vi.fn(),
  list: vi.fn(),
  candidates: vi.fn(),
  costs: vi.fn(),
  role: 'manager' as 'manager' | 'admin',
}));

function query<T>(data: T) {
  return {
    data,
    error: null,
    isPending: false,
    isFetching: false,
    isSuccess: true,
    refetch: vi.fn(),
  };
}

const row = {
  scheduledShiftId: 'plan',
  scheduledShiftVersion: 1,
  userId: 'worker',
  userName: 'Ana',
  plannedSiteId: 'site',
  plannedSiteName: 'Central',
  plannedStartsAt: '2026-09-01T13:00:00.000Z',
  plannedEndsAt: '2026-09-01T21:00:00.000Z',
  plannedTimeZone: 'America/Bogota',
  plannedSeconds: 28_800,
  canConfirmNoShow: true,
  state: 'needs_review' as const,
  reconciliation: null,
  actual: null,
};

vi.mock('@/features/locale/LocaleProvider', () => ({
  useResolvedLocale: () => ({
    locale: 'en-US',
    timezone: 'America/Bogota',
    firstDayOfWeek: 1,
  }),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'actor', tenantId: 'tenant', role: mocks.role } }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      employeeShifts: {
        attendance: { planActual: { invalidate: mocks.invalidate } },
        schedule: { list: { invalidate: mocks.invalidateSchedule } },
      },
    }),
    employeeShifts: {
      schedule: { context: { useQuery: () => mocks.context() } },
      attendance: {
        costs: { useQuery: () => mocks.costs() },
        planActual: {
          list: { useQuery: () => mocks.list() },
          candidates: { useQuery: () => mocks.candidates() },
        },
      },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutateAsync: mocks.record, isPending: false }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { PlanActualPanel } from './PlanActualPanel';

describe('PlanActualPanel', () => {
  beforeEach(() => {
    mocks.record.mockReset().mockResolvedValue({
      id: 'reconciliation',
      scheduledShiftId: 'plan',
      outcome: 'attended',
      version: 1,
    });
    mocks.invalidate.mockReset().mockResolvedValue(undefined);
    mocks.invalidateSchedule.mockReset().mockResolvedValue(undefined);
    mocks.role = 'manager';
    mocks.context.mockReturnValue(
      query({
        employees: [{ id: 'worker', name: 'Ana', role: 'cashier' }],
        sites: [{ id: 'site', name: 'Central' }],
        timeZone: 'America/Bogota',
        firstDayOfWeek: 1,
      })
    );
    mocks.list.mockReturnValue(
      query({
        timeZone: 'America/Bogota',
        generatedAt: '2026-09-04T12:00:00.000Z',
        items: [row],
        nextCursor: null,
      })
    );
    mocks.candidates.mockReturnValue(
      query([
        {
          id: 'actual',
          siteId: 'site',
          siteName: 'Central',
          clockedInAt: '2026-09-01T13:10:00.000Z',
          clockedOutAt: '2026-09-01T21:00:00.000Z',
          breakSeconds: 1_800,
          workedSeconds: 27_000,
          correctionVersion: null,
          currentlyLinked: false,
        },
      ])
    );
    mocks.costs.mockReturnValue(
      query({
        kind: 'regular_operational_estimate',
        timeZone: 'America/Bogota',
        generatedAt: '2026-09-04T12:00:00.000Z',
        fromDate: '2026-09-01',
        toDate: '2026-09-08',
        workedSeconds: 28_800,
        pricedSeconds: 25_200,
        unavailableSeconds: 3_600,
        totals: [{ currencyCode: 'COP', amount: 84_000 }],
        unavailableTotalCurrencies: [],
        rows: [],
        limitations: [
          'regular_time_only',
          'not_payroll',
          'no_statutory_premiums',
          'no_benefits_or_taxes',
        ],
      })
    );
  });

  it('requires explicit evidence and reason before linking attendance', async () => {
    const user = userEvent.setup();
    render(<PlanActualPanel />);

    const card = screen.getByTestId('plan-actual-plan');
    expect(card).toHaveTextContent('Ana');
    expect(card).toHaveTextContent('Needs review');
    expect(card).toHaveTextContent('8h');
    await user.click(within(card).getByRole('button', { name: 'Review outcome' }));

    const dialog = screen.getByRole('dialog', { name: 'Reconcile attendance · Ana' });
    const save = within(dialog).getByRole('button', { name: 'Save decision' });
    expect(save).toBeDisabled();
    await user.selectOptions(within(dialog).getByRole('combobox'), 'actual');
    await user.type(
      within(dialog).getByPlaceholderText(
        'Describe the evidence you reviewed and why this outcome is correct.'
      ),
      'Reviewed signed terminal records'
    );
    await user.click(save);

    expect(mocks.record).toHaveBeenCalledWith({
      scheduledShiftId: 'plan',
      scheduledShiftVersion: 1,
      expectedVersion: 0,
      outcome: 'attended',
      employeeShiftId: 'actual',
      reason: 'Reviewed signed terminal records',
    });
    expect(mocks.invalidate).toHaveBeenCalled();
    expect(mocks.invalidateSchedule).toHaveBeenCalled();
  });

  it('sends a no-show without an attendance identity', async () => {
    const user = userEvent.setup();
    render(<PlanActualPanel />);
    await user.click(screen.getByRole('button', { name: 'Review outcome' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Confirm no-show' }));
    await user.type(
      within(dialog).getByPlaceholderText(
        'Describe the evidence you reviewed and why this outcome is correct.'
      ),
      'No arrival evidence after manager review'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save decision' }));

    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'no_show', employeeShiftId: null })
    );
  });

  it('shows operational cost only to an administrator and preserves unknown time', () => {
    mocks.role = 'admin';
    render(<PlanActualPanel />);

    expect(screen.getByRole('heading', { name: 'Regular operational labor cost' })).toBeVisible();
    expect(screen.getByText(/84[,.]000/)).toBeVisible();
    expect(screen.getByText('1h without explicit costing terms')).toBeVisible();
  });

  it('warns instead of showing a believable partial total after safe-range overflow', () => {
    mocks.role = 'admin';
    mocks.costs.mockReturnValue(
      query({
        ...mocks.costs().data,
        pricedSeconds: 3_600,
        totals: [],
        unavailableTotalCurrencies: ['COP'],
      })
    );
    render(<PlanActualPanel />);

    expect(screen.getByRole('alert')).toHaveTextContent('A safe total cannot be displayed for COP');
    expect(screen.queryByText('No worked time can be priced')).not.toBeInTheDocument();
  });
});
