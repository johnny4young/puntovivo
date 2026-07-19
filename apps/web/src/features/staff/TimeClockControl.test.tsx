import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';

const {
  clockInMock,
  clockOutMock,
  startBreakMock,
  endBreakMock,
  queryResult,
  breakQueryResult,
  invalidateMock,
} = vi.hoisted(() => ({
  clockInMock: vi.fn(),
  clockOutMock: vi.fn(),
  startBreakMock: vi.fn(),
  endBreakMock: vi.fn(),
  invalidateMock: vi.fn(),
  queryResult: {
    data: null as null | {
      id: string;
      siteId: string;
      siteName: string;
      clockedInAt: string;
      activeCashSession: null | {
        id: string;
        registerName: string;
        openedAt: string;
      };
    },
    isLoading: false,
    error: null as Error | null,
  },
  breakQueryResult: {
    data: null as null | {
      id: string;
      employeeShiftId: string;
      startedAt: string;
      endedAt: null;
    },
    isLoading: false,
    error: null as Error | null,
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      employeeShifts: {
        current: { invalidate: invalidateMock },
        breaks: { current: { invalidate: invalidateMock } },
        attendance: { list: { invalidate: invalidateMock } },
      },
    }),
    employeeShifts: {
      current: { useQuery: () => queryResult },
      breaks: { current: { useQuery: () => breakQueryResult } },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    mutate:
      path === 'employeeShifts.clockIn'
        ? clockInMock
        : path === 'employeeShifts.clockOut'
          ? clockOutMock
          : path === 'employeeShifts.breaks.start'
            ? startBreakMock
            : endBreakMock,
    isPending: false,
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

import { TimeClockControl } from './TimeClockControl';

describe('TimeClockControl', () => {
  beforeEach(() => {
    clockInMock.mockReset();
    clockOutMock.mockReset();
    startBreakMock.mockReset();
    endBreakMock.mockReset();
    invalidateMock.mockReset();
    queryResult.data = null;
    queryResult.isLoading = false;
    queryResult.error = null;
    breakQueryResult.data = null;
    breakQueryResult.isLoading = false;
    breakQueryResult.error = null;
  });

  it('clocks in at the selected active site', async () => {
    const user = userEvent.setup();
    render(<TimeClockControl site={{ id: 'site-1', name: 'Central' }} />);

    expect(screen.getByText('Site: Central')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clock in' }));

    expect(clockInMock).toHaveBeenCalledWith({ siteId: 'site-1' });
    expect(clockOutMock).not.toHaveBeenCalled();
  });

  it('shows the persisted shift site and clocks out without using current site selection', async () => {
    const user = userEvent.setup();
    queryResult.data = {
      id: 'shift-1',
      siteId: 'site-original',
      siteName: 'North store',
      clockedInAt: '2026-07-14T14:30:00.000Z',
      activeCashSession: null,
    };
    render(<TimeClockControl site={{ id: 'site-current', name: 'South store' }} />);

    expect(screen.getByText('Site: North store')).toBeInTheDocument();
    expect(screen.queryByText('Site: South store')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clock out' }));

    expect(clockOutMock).toHaveBeenCalledWith({});
    expect(clockInMock).not.toHaveBeenCalled();
  });

  it('starts an explicit break while keeping the shift open', async () => {
    const user = userEvent.setup();
    queryResult.data = {
      id: 'shift-1',
      siteId: 'site-1',
      siteName: 'Central',
      clockedInAt: '2026-07-14T14:30:00.000Z',
      activeCashSession: null,
    };
    render(<TimeClockControl site={{ id: 'site-1', name: 'Central' }} />);

    await user.click(screen.getByRole('button', { name: 'Start break' }));

    expect(startBreakMock).toHaveBeenCalledWith({});
    expect(clockOutMock).not.toHaveBeenCalled();
  });

  it('requires ending an active break before clock-out', async () => {
    const user = userEvent.setup();
    queryResult.data = {
      id: 'shift-1',
      siteId: 'site-1',
      siteName: 'Central',
      clockedInAt: '2026-07-14T14:30:00.000Z',
      activeCashSession: null,
    };
    breakQueryResult.data = {
      id: 'break-1',
      employeeShiftId: 'shift-1',
      startedAt: '2026-07-14T17:00:00.000Z',
      endedAt: null,
    };
    render(<TimeClockControl site={{ id: 'site-1', name: 'Central' }} />);

    expect(screen.getByTestId('active-employee-break')).toHaveTextContent('On break since');
    expect(screen.getByText('End the break before clocking out.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clock out' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'End break' }));

    expect(endBreakMock).toHaveBeenCalledWith({});
    expect(clockOutMock).not.toHaveBeenCalled();
  });

  it('shows the active register guard and disables clock-out until cash close', () => {
    queryResult.data = {
      id: 'shift-1',
      siteId: 'site-1',
      siteName: 'Central',
      clockedInAt: '2026-07-14T14:30:00.000Z',
      activeCashSession: {
        id: 'cash-1',
        registerName: 'Register 1',
        openedAt: '2026-07-14T14:31:00.000Z',
      },
    };
    render(<TimeClockControl site={{ id: 'site-1', name: 'Central' }} />);

    expect(screen.getByTestId('active-cash-session-shift-guard')).toHaveTextContent(
      'Close Register 1 before clocking out. Your attendance keeps running until then.'
    );
    expect(screen.getByRole('button', { name: 'Clock out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start break' })).toBeEnabled();
  });

  it('fails closed while the active-break state cannot be verified', () => {
    queryResult.data = {
      id: 'shift-1',
      siteId: 'site-1',
      siteName: 'Central',
      clockedInAt: '2026-07-14T14:30:00.000Z',
      activeCashSession: null,
    };
    breakQueryResult.error = new Error('network');
    render(<TimeClockControl site={{ id: 'site-1', name: 'Central' }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Break status is unavailable');
    expect(screen.getByRole('button', { name: 'Clock out' })).toBeDisabled();
  });

  it('requires a selected site before clocking in', () => {
    render(<TimeClockControl site={null} />);

    expect(screen.getByText('Select a site to clock in.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clock in' })).toBeDisabled();
  });
});
