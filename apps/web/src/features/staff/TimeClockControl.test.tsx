import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';

const { clockInMock, clockOutMock, queryResult, invalidateMock } = vi.hoisted(() => ({
  clockInMock: vi.fn(),
  clockOutMock: vi.fn(),
  invalidateMock: vi.fn(),
  queryResult: {
    data: null as null | {
      id: string;
      siteId: string;
      siteName: string;
      clockedInAt: string;
    },
    isLoading: false,
    error: null as Error | null,
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      employeeShifts: { current: { invalidate: invalidateMock } },
    }),
    employeeShifts: {
      current: { useQuery: () => queryResult },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    mutate: path === 'employeeShifts.clockIn' ? clockInMock : clockOutMock,
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
    invalidateMock.mockReset();
    queryResult.data = null;
    queryResult.isLoading = false;
    queryResult.error = null;
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
    };
    render(<TimeClockControl site={{ id: 'site-current', name: 'South store' }} />);

    expect(screen.getByText('Site: North store')).toBeInTheDocument();
    expect(screen.queryByText('Site: South store')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clock out' }));

    expect(clockOutMock).toHaveBeenCalledWith({});
    expect(clockInMock).not.toHaveBeenCalled();
  });

  it('requires a selected site before clocking in', () => {
    render(<TimeClockControl site={null} />);

    expect(screen.getByText('Select a site to clock in.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clock in' })).toBeDisabled();
  });
});
