import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@/test/utils';

const mocks = vi.hoisted(() => ({
  input: null as unknown,
  historyInput: null as unknown,
  exportInput: null as unknown,
  refetch: vi.fn(),
  exportRefetch: vi.fn(),
  invalidate: vi.fn(),
  correctionMutate: vi.fn(),
  buildCsv: vi.fn(() => '\uFEFFcsv-data'),
  buildWorkbook: vi.fn(async () => new Uint8Array([1, 2, 3])),
  downloadFile: vi.fn(),
  toastSuccess: vi.fn(),
  correctionMutation: { isPending: false },
  historyQuery: {
    data: [] as Array<{
      id: string;
      version: number;
      clockedInAt: string;
      clockedOutAt: string;
      breaks: Array<{ id: string; startedAt: string; endedAt: string }>;
      reason: string;
      createdByUserId: string;
      createdByName: string;
      createdAt: string;
    }>,
    isPending: false,
    error: null as Error | null,
  },
  query: {
    data: undefined as
      | undefined
      | {
          timeZone: string;
          generatedAt: string;
          overtimePolicy: {
            supported: boolean;
            countryCode: string;
            calculationFromDate: string;
            calculationToDate: string;
            profiles: Array<{
              id: string;
              effectiveFrom: string | null;
              weeklyRegularSeconds: number;
              dailyRegularSeconds: number | null;
            }>;
            limitations: string[];
            sourceUrls: string[];
          };
          page: number;
          perPage: number;
          total: number;
          rows: Array<{
            id: string;
            userId: string;
            userName: string;
            userRole: 'cashier';
            siteId: string;
            siteName: string;
            clockedInAt: string;
            clockedOutAt: string | null;
            status: 'active' | 'closed';
            elapsedSeconds: number;
            breakSeconds: number;
            workedSeconds: number;
            overtime: null | {
              regularSeconds: number;
              overtimeSeconds: number;
              premiums: Array<{
                code:
                  | 'co_day_overtime'
                  | 'co_night_overtime'
                  | 'mx_double_overtime'
                  | 'mx_triple_overtime'
                  | 'cl_overtime'
                  | 'pe_first_two_overtime'
                  | 'pe_additional_overtime'
                  | 'ar_ordinary_overtime'
                  | 'ar_rest_day_overtime';
                multiplier: number;
                seconds: number;
              }>;
              policyIds: string[];
            };
            breaks: Array<{
              id: string;
              employeeShiftId: string;
              startedAt: string;
              endedAt: string | null;
            }>;
            original: {
              clockedInAt: string;
              clockedOutAt: string | null;
              breaks: Array<{
                id: string;
                employeeShiftId: string;
                startedAt: string;
                endedAt: string | null;
              }>;
            };
            correction: null | {
              id: string;
              version: number;
              reason: string;
              createdByUserId: string;
              createdByName: string;
              createdAt: string;
            };
          }>;
        },
    isPending: false,
    isFetching: false,
    error: null as Error | null,
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      employeeShifts: { attendance: { list: { invalidate: mocks.invalidate } } },
    }),
    employeeShifts: {
      attendance: {
        list: {
          useQuery: (input: unknown) => {
            mocks.input = input;
            return { ...mocks.query, refetch: mocks.refetch };
          },
        },
        export: {
          useQuery: (input: unknown) => {
            mocks.exportInput = input;
            return { refetch: mocks.exportRefetch };
          },
        },
        corrections: {
          list: {
            useQuery: (input: unknown) => {
              mocks.historyInput = input;
              return mocks.historyQuery;
            },
          },
        },
      },
    },
  },
}));

vi.mock('@/services/export/exportService', () => ({
  buildSemanticFilename: (spec: { name: string; date: string }, extension: string) =>
    `${spec.name}-${spec.date}.${extension}`,
  downloadFile: mocks.downloadFile,
  mimeTypeForExtension: (extension: string) =>
    extension === 'csv'
      ? 'text/csv;charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}));

vi.mock('./attendanceExport', () => ({
  buildAttendancePayrollCsv: mocks.buildCsv,
  buildAttendanceAccountingWorkbook: mocks.buildWorkbook,
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({
    mutate: mocks.correctionMutate,
    isPending: mocks.correctionMutation.isPending,
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: mocks.toastSuccess, error: vi.fn() }),
}));

import { TeamAttendancePanel } from './TeamAttendancePanel';

function attendanceResult(): NonNullable<typeof mocks.query.data> {
  return {
    timeZone: 'America/Bogota',
    generatedAt: '2026-07-14T22:00:00.000Z',
    overtimePolicy: {
      supported: true,
      countryCode: 'CO',
      calculationFromDate: '2026-07-13',
      calculationToDate: '2026-07-20',
      profiles: [
        {
          id: 'CO-2025-44H-NIGHT-19',
          effectiveFrom: '2025-12-25',
          weeklyRegularSeconds: 44 * 60 * 60,
          dailyRegularSeconds: 9 * 60 * 60,
        },
      ],
      limitations: ['contracted_schedule', 'holiday_calendar'],
      sourceUrls: ['https://example.test/official'],
    },
    page: 1,
    perPage: 10,
    total: 11,
    rows: [
      {
        id: 'shift-1',
        userId: 'cashier-1',
        userName: 'Ana Torres',
        userRole: 'cashier' as const,
        siteId: 'site-1',
        siteName: 'Sede Centro',
        clockedInAt: '2026-07-14T13:00:00.000Z',
        clockedOutAt: '2026-07-14T22:00:00.000Z',
        status: 'closed' as const,
        elapsedSeconds: 32_400,
        breakSeconds: 1_800,
        workedSeconds: 30_600,
        overtime: {
          regularSeconds: 27_000,
          overtimeSeconds: 3_600,
          premiums: [
            {
              code: 'co_day_overtime' as const,
              multiplier: 1.25,
              seconds: 3_600,
            },
          ],
          policyIds: ['CO-2025-44H-NIGHT-19'],
        },
        breaks: [
          {
            id: 'break-1',
            employeeShiftId: 'shift-1',
            startedAt: '2026-07-14T17:00:00.000Z',
            endedAt: '2026-07-14T17:30:00.000Z',
          },
        ],
        original: {
          clockedInAt: '2026-07-14T13:00:00.000Z',
          clockedOutAt: '2026-07-14T22:00:00.000Z',
          breaks: [
            {
              id: 'break-1',
              employeeShiftId: 'shift-1',
              startedAt: '2026-07-14T17:00:00.000Z',
              endedAt: '2026-07-14T17:30:00.000Z',
            },
          ],
        },
        correction: null,
      },
    ],
  };
}

beforeEach(() => {
  mocks.refetch.mockReset();
  mocks.exportRefetch.mockReset();
  mocks.invalidate.mockReset();
  mocks.correctionMutate.mockReset();
  mocks.buildCsv.mockClear();
  mocks.buildWorkbook.mockClear();
  mocks.downloadFile.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.input = null;
  mocks.exportInput = null;
  mocks.historyInput = null;
  mocks.query.data = attendanceResult();
  mocks.query.isPending = false;
  mocks.query.isFetching = false;
  mocks.query.error = null;
  mocks.exportRefetch.mockImplementation(async () => ({ data: attendanceResult() }));
  mocks.historyQuery.data = [];
  mocks.historyQuery.isPending = false;
  mocks.historyQuery.error = null;
});

describe('TeamAttendancePanel (ENG-140b)', () => {
  it('shows worked time and explicit break evidence in the tenant timezone', async () => {
    const user = userEvent.setup();
    render(
      <TeamAttendancePanel fromDate="2026-07-13" toDate="2026-07-20" siteId="site-1" enabled />
    );

    expect(mocks.input).toEqual({
      fromDate: '2026-07-13',
      toDate: '2026-07-20',
      siteId: 'site-1',
      page: 1,
      perPage: 10,
    });
    const card = screen.getByTestId('attendance-shift-shift-1');
    expect(card).toHaveTextContent('Ana Torres');
    expect(card).toHaveTextContent('Sede Centro');
    expect(card).toHaveTextContent('8h 30m');
    expect(card).toHaveTextContent('30m');
    expect(card).toHaveTextContent('7h 30m');
    expect(card).toHaveTextContent('Day overtime · 1h · 1.25×');
    expect(screen.getByTestId('overtime-policy')).toHaveTextContent(
      '44 regular hours per week · effective Dec 25, 2025 · CO-2025-44H-NIGHT-19'
    );
    await user.click(within(card).getByText('Break detail (1)'));
    expect(card).toHaveTextContent(/12:00 PM.*12:30 PM/);
  });

  it('paginates the weekly attendance query', async () => {
    const user = userEvent.setup();
    render(<TeamAttendancePanel fromDate="2026-07-13" toDate="2026-07-20" siteId="" enabled />);

    await user.click(screen.getByRole('button', { name: 'Next attendance page' }));

    expect(mocks.input).toEqual({
      fromDate: '2026-07-13',
      toDate: '2026-07-20',
      page: 2,
      perPage: 10,
    });
  });

  it('anchors an active break duration to the server report snapshot', () => {
    const active: NonNullable<typeof mocks.query.data> = attendanceResult();
    active.generatedAt = '2026-07-14T17:30:00.000Z';
    active.rows[0] = {
      ...active.rows[0]!,
      clockedOutAt: null,
      status: 'active',
      elapsedSeconds: 16_200,
      breakSeconds: 1_800,
      workedSeconds: 14_400,
      breaks: [{ ...active.rows[0]!.breaks[0]!, endedAt: null }],
    };
    mocks.query.data = active;
    render(<TeamAttendancePanel fromDate="2026-07-13" toDate="2026-07-20" siteId="" enabled />);

    const card = screen.getByTestId('attendance-shift-shift-1');
    fireEvent.click(within(card).getByText('Break detail (1)'));

    expect(within(card).getByRole('listitem')).toHaveTextContent('30m');
  });

  it('renders an explicit empty state', () => {
    mocks.query.data = { ...attendanceResult(), total: 0, rows: [] };
    render(<TeamAttendancePanel fromDate="2026-07-13" toDate="2026-07-20" siteId="" enabled />);

    expect(screen.getByText('No attendance in this week')).toBeInTheDocument();
  });

  it('keeps worked evidence visible when the tenant country is unsupported', () => {
    const unsupported = attendanceResult();
    unsupported.overtimePolicy = {
      supported: false,
      countryCode: 'US',
      calculationFromDate: '2026-07-12',
      calculationToDate: '2026-07-19',
      profiles: [],
      limitations: [],
      sourceUrls: [],
    };
    unsupported.rows[0]!.overtime = null;
    mocks.query.data = unsupported;

    render(<TeamAttendancePanel fromDate="2026-07-13" toDate="2026-07-20" siteId="" enabled />);

    expect(screen.getByTestId('overtime-policy')).toHaveTextContent(
      'Overtime is not classified for US'
    );
    expect(screen.getByTestId('attendance-shift-shift-1')).toHaveTextContent('Not classified');
  });

  it('shows every policy profile when the labor week crosses an effective date', () => {
    const transition = attendanceResult();
    transition.overtimePolicy.profiles.unshift({
      id: 'CO-2025-44H',
      effectiveFrom: '2025-07-15',
      weeklyRegularSeconds: 44 * 60 * 60,
      dailyRegularSeconds: 9 * 60 * 60,
    });
    mocks.query.data = transition;

    render(<TeamAttendancePanel fromDate="2026-07-13" toDate="2026-07-20" siteId="" enabled />);

    const policy = screen.getByTestId('overtime-policy');
    expect(policy).toHaveTextContent('CO-2025-44H');
    expect(policy).toHaveTextContent('CO-2025-44H-NIGHT-19');
  });

  it('authors a complete correction snapshot from the effective attendance card', async () => {
    const user = userEvent.setup();
    render(<TeamAttendancePanel fromDate="2026-07-13" toDate="2026-07-20" siteId="" enabled />);

    await user.click(screen.getByRole('button', { name: 'Correct attendance' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Original clock and break evidence is never overwritten.');
    expect(within(dialog).getByLabelText('Start time')).toHaveValue('08:00');
    expect(within(dialog).getByLabelText('Break start time')).toHaveValue('12:00');

    await user.type(
      within(dialog).getByLabelText('Correction reason'),
      'Verified against the signed register log.'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save correction' }));

    expect(mocks.correctionMutate).toHaveBeenCalledWith({
      employeeShiftId: 'shift-1',
      expectedVersion: 0,
      startDate: '2026-07-14',
      startTime: '08:00',
      endDate: '2026-07-14',
      endTime: '17:00',
      breaks: [
        {
          id: 'break-1',
          startDate: '2026-07-14',
          startTime: '12:00',
          endDate: '2026-07-14',
          endTime: '12:30',
        },
      ],
      reason: 'Verified against the signed register log.',
    });
  });

  it('shows corrected provenance and loads the append-only history', async () => {
    const user = userEvent.setup();
    const corrected = attendanceResult();
    corrected.rows[0]!.correction = {
      id: 'correction-1',
      version: 2,
      reason: 'Second review aligned the signed attendance note.',
      createdByUserId: 'manager-1',
      createdByName: 'María López',
      createdAt: '2026-07-15T14:00:00.000Z',
    };
    corrected.rows[0]!.clockedInAt = '2026-07-14T13:15:00.000Z';
    mocks.query.data = corrected;
    mocks.historyQuery.data = [
      {
        id: 'correction-2',
        version: 2,
        clockedInAt: '2026-07-14T13:15:00.000Z',
        clockedOutAt: '2026-07-14T22:00:00.000Z',
        breaks: [],
        reason: 'Second review aligned the signed attendance note.',
        createdByUserId: 'manager-1',
        createdByName: 'María López',
        createdAt: '2026-07-15T14:00:00.000Z',
      },
    ];

    render(<TeamAttendancePanel fromDate="2026-07-13" toDate="2026-07-20" siteId="" enabled />);

    const card = screen.getByTestId('attendance-shift-shift-1');
    expect(card).toHaveTextContent('Corrected · v2');
    expect(card).toHaveTextContent('Second review aligned the signed attendance note.');
    await user.click(within(card).getByRole('button', { name: 'View correction history' }));

    expect(mocks.historyInput).toEqual({ employeeShiftId: 'shift-1' });
    expect(card).toHaveTextContent('Version 2 · María López');
  });

  it('downloads complete-range payroll CSV and accounting XLSX handoffs', async () => {
    const user = userEvent.setup();
    render(
      <TeamAttendancePanel fromDate="2026-07-13" toDate="2026-07-20" siteId="site-1" enabled />
    );

    expect(screen.getByTestId('attendance-export-notice')).toHaveTextContent(
      'not only the visible page'
    );
    expect(mocks.exportInput).toEqual({
      fromDate: '2026-07-13',
      toDate: '2026-07-20',
      siteId: 'site-1',
    });

    await user.click(screen.getByRole('button', { name: 'Payroll CSV' }));
    await waitFor(() => expect(mocks.buildCsv).toHaveBeenCalledTimes(1));
    expect(mocks.downloadFile).toHaveBeenLastCalledWith(
      expect.any(Blob),
      'payroll-attendance-2026-07-13-2026-07-20.csv'
    );

    await user.click(screen.getByRole('button', { name: 'Accounting XLSX' }));
    await waitFor(() => expect(mocks.buildWorkbook).toHaveBeenCalledTimes(1));
    expect(mocks.downloadFile).toHaveBeenLastCalledWith(
      expect.any(Blob),
      'accounting-attendance-handoff-2026-07-13-2026-07-20.xlsx'
    );
    expect(mocks.exportRefetch).toHaveBeenCalledTimes(2);
  });
});
