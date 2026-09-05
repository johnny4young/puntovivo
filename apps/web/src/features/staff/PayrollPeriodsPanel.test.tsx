import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@/test/utils';
import i18next from '@/i18n';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  close: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  data: { items: [], nextCursor: null } as {
    items: Array<Record<string, unknown>>;
    nextCursor: null | { fromDate: string; id: string };
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      workforce: {
        payroll: Object.assign(vi.fn(), {
          invalidate: mocks.invalidate,
          periods: { invalidate: mocks.invalidate },
        }),
      },
      auditLogs: { invalidate: mocks.invalidate },
    }),
    workforce: {
      payroll: {
        periods: {
          list: {
            useQuery: () => ({
              data: mocks.data,
              isPending: false,
              isFetching: false,
              error: null,
              refetch: mocks.refetch,
            }),
          },
        },
      },
    },
  },
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    mutateAsync:
      path === 'workforce.payroll.periods.create'
        ? mocks.create
        : path === 'workforce.payroll.periods.close'
          ? mocks.close
          : vi.fn(),
    isPending: false,
  }),
}));

import { PayrollPeriodsPanel } from './PayrollPeriodsPanel';

beforeEach(async () => {
  await i18next.changeLanguage('en');
  mocks.create.mockReset().mockResolvedValue({ id: 'period-1', status: 'open', version: 1 });
  mocks.close.mockReset().mockResolvedValue({ id: 'period-1', status: 'closed', version: 2 });
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.refetch.mockReset().mockResolvedValue(undefined);
  mocks.data = { items: [], nextCursor: null };
});

describe('PayrollPeriodsPanel', () => {
  it('creates a Colombia COP period with explicit half-open dates and evidence', async () => {
    const user = userEvent.setup();
    render(<PayrollPeriodsPanel onOpenRuns={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Create period' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('First covered date'), '2026-08-01');
    await user.type(within(dialog).getByLabelText('Exclusive end date'), '2026-09-01');
    await user.type(within(dialog).getByLabelText('Pay date'), '2026-09-05');
    await user.type(
      within(dialog).getByLabelText('Private review reason'),
      'Reviewed August payroll period evidence'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mocks.create).toHaveBeenCalledWith({
      countryCode: 'CO',
      currencyCode: 'COP',
      frequency: 'monthly',
      fromDate: '2026-08-01',
      untilDate: '2026-09-01',
      payDate: '2026-09-05',
      reason: 'Reviewed August payroll period evidence',
    });
  });

  it('closes the exact optimistic version only after an explicit private reason', async () => {
    mocks.data = {
      items: [
        {
          id: 'period-1',
          tenantId: 'tenant-1',
          countryCode: 'CO',
          frequency: 'monthly',
          fromDate: '2026-08-01',
          untilDate: '2026-09-01',
          payDate: '2026-09-05',
          currencyCode: 'COP',
          status: 'open',
          version: 4,
          createdReason: 'Reviewed creation',
          closedReason: null,
          createdByUserId: 'admin-1',
          closedByUserId: null,
          closedAt: null,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    };
    const user = userEvent.setup();
    render(<PayrollPeriodsPanel onOpenRuns={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Close period' }));
    const dialog = screen.getByRole('dialog');
    const closeButton = within(dialog).getByRole('button', { name: 'Close period' });
    expect(closeButton).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText('Private review reason'),
      'Reconciled approved payroll evidence'
    );
    await user.click(closeButton);
    expect(mocks.close).toHaveBeenCalledWith({
      id: 'period-1',
      expectedVersion: 4,
      reason: 'Reconciled approved payroll evidence',
    });
  });

  it('rejects an overlong period before calling the server', async () => {
    const user = userEvent.setup();
    render(<PayrollPeriodsPanel onOpenRuns={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Create period' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('First covered date'), '2026-08-01');
    await user.type(within(dialog).getByLabelText('Exclusive end date'), '2026-09-02');
    await user.type(within(dialog).getByLabelText('Pay date'), '2026-09-05');
    await user.type(
      within(dialog).getByLabelText('Private review reason'),
      'Reviewed invalid payroll period evidence'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      within(dialog).getByText('A pre-payroll period cannot exceed 31 calendar days.')
    ).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
