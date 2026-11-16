import { render, screen, within } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { todayFixture } from './fixtures';

const { todayData, resolveMutate, signoffData } = vi.hoisted(() => ({
  todayData: { current: null as unknown },
  resolveMutate: vi.fn(),
  signoffData: { current: null as unknown },
}));

vi.mock('@/features/day-close-guide/DayCloseGuide', () => ({
  DayCloseGuide: ({ onClose }: { onClose: () => void }) => (
    <button type="button" data-testid="close-guide-mock" onClick={onClose}>
      guide
    </button>
  ),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'm-1', role: 'manager' } }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/features/approvals/ManagerApprovalQueue', () => ({
  ApprovalDecisionForm: ({ decision }: { decision: string }) => (
    <div data-testid="approval-form">{decision}</div>
  ),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ operations: { today: { invalidate: vi.fn() } } }),
    operations: {
      today: { useQuery: () => ({ data: todayData.current, isLoading: false }) },
    },
    managerApprovals: {
      queue: { useQuery: () => ({ data: { approver: { hasPin: true } } }) },
    },
    registerIncidents: {
      resolve: { useMutation: () => ({ mutate: resolveMutate, isPending: false }) },
    },
    reports: {
      dayClose: {
        signoffMetadata: { useQuery: () => ({ data: signoffData.current }) },
      },
    },
  },
}));

import { TodayOverview } from './TodayOverview';

const formatCurrency = (value: number) => `$ ${value}`;

beforeEach(() => {
  todayData.current = todayFixture();
  resolveMutate.mockReset();
  signoffData.current = null;
  localStorage.clear();
});

describe('TodayOverview', () => {
  it('leads with the sales total, the change against last week and the day band', () => {
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-sales-total')).toHaveTextContent('$ 40000');
    expect(screen.getByTestId('today-sales-context')).toHaveTextContent('100 %');
    expect(screen.getByTestId('today-band-today')).toBeInTheDocument();
    expect(screen.getByTestId('today-band-comparison')).toBeInTheDocument();
    expect(screen.getByTestId('today-status-pill')).toHaveTextContent('DIAN needs a fix');
  });

  it('orders the queue by severity and outlines only the first blocking row', () => {
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-pending-count')).toHaveTextContent('4');
    const rows = within(screen.getByTestId('today-pending')).getAllByRole('listitem');
    expect(rows.map(row => row.getAttribute('data-testid'))).toEqual([
      'today-pending-row-staleSession',
      'today-pending-row-approval',
      'today-pending-row-incident',
      'today-pending-row-attention',
    ]);
    expect(rows[0]).toHaveClass('border-danger-500');
    expect(rows[1]).not.toHaveClass('border-danger-500');
  });

  it('filters to items reported by cashiers', async () => {
    const user = userEvent.setup();
    render(<TodayOverview formatCurrency={formatCurrency} />);
    await user.click(screen.getByTestId('today-pending-filter-cashiers'));
    expect(screen.queryByTestId('today-pending-row-staleSession')).not.toBeInTheDocument();
    expect(screen.getByTestId('today-pending-row-incident')).toBeInTheDocument();
  });

  it('offers approve and reject with the PIN form, and resolves incidents in place', async () => {
    const user = userEvent.setup();
    render(<TodayOverview formatCurrency={formatCurrency} />);
    await user.click(screen.getByTestId('today-approval-approve'));
    expect(screen.getByTestId('approval-form')).toHaveTextContent('approved');
    expect(screen.getByTestId('today-pending-link-incident')).toHaveTextContent('Transfer 14');
    await user.click(screen.getByTestId('today-incident-resolve'));
    expect(resolveMutate).toHaveBeenCalledWith({ id: 'i-1' });
  });

  it('shows open registers, the stale one, and the next handoff', () => {
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-register')).toHaveTextContent('waits on 2');
    expect(screen.getByTestId('today-register-stale')).toHaveTextContent('is item 1');
    expect(screen.getByTestId('today-next-handoff')).toHaveTextContent('2 h 36 min');
  });

  it('lists the day handoffs, done and still waiting', () => {
    todayData.current = todayFixture({
      handoffs: [
        ...todayFixture().handoffs,
        {
          id: 'h-2',
          registerName: 'Caja 4',
          fromUserName: 'Laura',
          toUserName: null,
          createdAt: '2026-11-11T17:00:00.000Z',
          receivedAt: null,
        },
      ],
    });
    render(<TodayOverview formatCurrency={formatCurrency} />);
    const entries = screen.getAllByTestId('today-handoff');
    expect(entries[0]).toHaveTextContent(/Caja 2 handoff done, 9:06/);
    expect(entries[1]).toHaveTextContent(/Caja 4 waits to be received since/);
  });

  it('queues an unexplained drawer difference and opens the guided close to note it', async () => {
    const user = userEvent.setup();
    todayData.current = todayFixture({
      pending: [
        {
          kind: 'cashDifference',
          id: 'cs-9',
          severity: 'beforeClose',
          origin: 'system',
          at: '2026-11-11T15:00:00.000Z',
          registerName: 'Caja 1',
          cashierName: 'Laura',
          overShort: -12300,
        },
      ],
    });
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-pending-row-cashDifference')).toHaveTextContent(
      'Unexplained difference in Caja 1 · $ -12300'
    );
    await user.click(screen.getByTestId('today-difference-explain'));
    expect(await screen.findByTestId('close-guide-mock')).toBeInTheDocument();
    await user.click(screen.getByTestId('close-guide-mock'));
    expect(screen.queryByTestId('close-guide-mock')).not.toBeInTheDocument();
  });

  it('offers the close until the day is signed, then the sealed day', async () => {
    const { unmount } = render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-close-day')).toHaveTextContent('Close the day');
    unmount();
    signoffData.current = { id: 'so-1' };
    render(<TodayOverview formatCurrency={formatCurrency} />);
    expect(screen.getByTestId('today-close-day')).toHaveTextContent('Day closed · view');
  });

  it('remembers the expanded day per viewer', async () => {
    const user = userEvent.setup();
    render(<TodayOverview formatCurrency={formatCurrency} />);
    const toggle = screen.getByTestId('today-expand');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(localStorage.getItem('puntovivo.today.expanded')).toBe('1');
  });
});
