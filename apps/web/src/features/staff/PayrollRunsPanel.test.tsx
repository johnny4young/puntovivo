import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@/test/utils';
import i18next from '@/i18n';
import type { PayrollPeriod } from './payrollTypes';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  review: vi.fn(),
  approve: vi.fn(),
  recalculate: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  items: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      workforce: { payroll: { runs: { invalidate: mocks.invalidate } } },
      auditLogs: { invalidate: mocks.invalidate },
    }),
    workforce: {
      payroll: {
        runs: {
          list: {
            useQuery: (_input: unknown, options?: { enabled?: boolean }) => ({
              data:
                options?.enabled === false ? undefined : { items: mocks.items, nextCursor: null },
              isPending: false,
              isFetching: false,
              error: null,
              refetch: mocks.refetch,
            }),
          },
          get: { useQuery: () => ({ data: undefined, isPending: false, error: null }) },
          revision: {
            useQuery: () => ({ data: undefined, isPending: false, isFetching: false, error: null }),
          },
        },
      },
    },
  },
}));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    mutateAsync:
      path === 'workforce.payroll.runs.create'
        ? mocks.create
        : path === 'workforce.payroll.runs.recalculate'
          ? mocks.recalculate
          : path === 'workforce.payroll.runs.review'
            ? mocks.review
            : mocks.approve,
    isPending: false,
  }),
}));
vi.mock('./PayrollRecalculationForm', () => ({
  PayrollRecalculationForm: () => <p>recalculate-form</p>,
}));

import { PayrollRunsPanel } from './PayrollRunsPanel';

const period = {
  id: 'period-1',
  fromDate: '2026-08-01',
  untilDate: '2026-09-01',
  payDate: '2026-09-05',
  currencyCode: 'COP',
  status: 'open',
  version: 1,
} as PayrollPeriod;

beforeEach(async () => {
  await i18next.changeLanguage('en');
  for (const mock of [
    mocks.create,
    mocks.review,
    mocks.approve,
    mocks.recalculate,
    mocks.invalidate,
    mocks.refetch,
  ])
    mock.mockReset().mockResolvedValue(undefined);
  mocks.items = [];
});

describe('PayrollRunsPanel', () => {
  it('creates a regular run with an explicit private reason and no invented source run', async () => {
    const user = userEvent.setup();
    render(<PayrollRunsPanel period={period} onBack={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Create run' }));
    const dialog = screen.getByRole('dialog');
    await user.type(
      within(dialog).getByLabelText('Private review reason'),
      'Created regular August payroll run'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mocks.create).toHaveBeenCalledWith({
      periodId: 'period-1',
      kind: 'regular',
      originalRunId: null,
      reason: 'Created regular August payroll run',
    });
  });

  it('reviews only the exact visible version and calculation revision', async () => {
    mocks.items = [
      {
        id: 'run-1',
        tenantId: 'tenant-1',
        periodId: 'period-1',
        kind: 'regular',
        originalRunId: null,
        status: 'draft',
        currentRevision: 3,
        reviewedRevision: null,
        approvedRevision: null,
        version: 7,
        createdByUserId: 'admin-1',
        reviewedByUserId: null,
        approvedByUserId: null,
        reviewedAt: null,
        approvedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
        periodFromDate: '2026-08-01',
        periodUntilDate: '2026-09-01',
        periodPayDate: '2026-09-05',
        currencyCode: 'COP',
      },
    ];
    const user = userEvent.setup();
    render(<PayrollRunsPanel period={period} onBack={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    const dialog = screen.getByRole('dialog');
    await user.type(
      within(dialog).getByLabelText('Private review reason'),
      'Reviewed exact complete employee revision'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Mark reviewed' }));
    expect(mocks.review).toHaveBeenCalledWith({
      runId: 'run-1',
      expectedVersion: 7,
      expectedRevision: 3,
      reason: 'Reviewed exact complete employee revision',
    });
  });
});
