import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@/test/utils';

const mocks = vi.hoisted(() => ({
  input: null as unknown,
  refetch: vi.fn(),
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
          }>;
        },
    isPending: false,
    isFetching: false,
    error: null as Error | null,
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    employeeShifts: {
      attendance: {
        list: {
          useQuery: (input: unknown) => {
            mocks.input = input;
            return { ...mocks.query, refetch: mocks.refetch };
          },
        },
      },
    },
  },
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
      },
    ],
  };
}

beforeEach(() => {
  mocks.refetch.mockReset();
  mocks.input = null;
  mocks.query.data = attendanceResult();
  mocks.query.isPending = false;
  mocks.query.isFetching = false;
  mocks.query.error = null;
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
});
