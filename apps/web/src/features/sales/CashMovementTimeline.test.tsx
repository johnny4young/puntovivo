import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { CashMovementTimeline } from './CashMovementTimeline';

const h = vi.hoisted(() => ({
  data: [] as Array<Record<string, unknown>>,
  isLoading: false,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    cashSessions: {
      movements: { useQuery: () => ({ data: h.data, isLoading: h.isLoading }) },
    },
  },
}));

describe('CashMovementTimeline', () => {
  it('lists each movement with its effect on the expected balance', () => {
    h.data = [
      { id: 'm-1', type: 'skim', signedAmount: -50, createdAt: '2026-11-04T15:00:00.000Z' },
      { id: 'm-2', type: 'paid_in', signedAmount: 20, createdAt: '2026-11-04T14:00:00.000Z' },
    ];
    render(<CashMovementTimeline sessionId="s-1" enabled />);

    const timeline = screen.getByTestId('close-session-timeline');
    expect(timeline).toHaveTextContent('Skim');
    expect(timeline).toHaveTextContent(/-.*50/);
    expect(timeline).toHaveTextContent('Paid in');
    expect(timeline).toHaveTextContent(/\+.*20/);
  });

  it('says so when the shift has no movements', () => {
    h.data = [];
    render(<CashMovementTimeline sessionId="s-1" enabled />);

    expect(screen.getByTestId('close-session-timeline')).toHaveTextContent(
      'No cash movements have been recorded'
    );
  });
});
