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

function attendanceResult() {
  return {
    timeZone: 'America/Bogota',
    generatedAt: '2026-07-14T22:00:00.000Z',
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
});
