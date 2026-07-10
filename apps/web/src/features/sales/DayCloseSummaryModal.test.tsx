/**
 * ENG-198 — DayCloseSummaryModal render contract.
 *
 * The payload arrives pre-gated from the server, so the component contract
 * is purely presentational: render what the payload carries, hide the margin
 * tile when `margin` is null (cashier view), celebrate the streak only when
 * it is positive, and keep the single "Done" exit.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { DayCloseSummaryModal } from './DayCloseSummaryModal';

interface MockQueryState {
  data: unknown;
  isPending: boolean;
  isError: boolean;
}

let mockQueryState: MockQueryState;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    cashSessions: {
      dayCloseSummary: {
        useQuery: () => mockQueryState,
      },
    },
  },
}));

const adminSummary = {
  session: {
    registerName: 'Front register',
    closedAt: '2026-07-10T22:15:00.000Z',
    actualCount: 350,
    overShort: 0,
    balanced: true,
  },
  day: { date: '2026-07-10', salesCount: 12, revenue: 950 },
  topProducts: [
    {
      productId: 'p1',
      name: 'Café 500g',
      sku: 'CAFE',
      revenue: 400,
      grossProfit: 180,
      grossMarginPct: 45,
    },
    {
      productId: 'p2',
      name: 'Pan artesanal',
      sku: 'PAN',
      revenue: 300,
      grossProfit: 120,
      grossMarginPct: 40,
    },
  ],
  margin: { grossProfit: 420, grossMarginPct: 44.21 },
  streakDays: 5,
};

const cashierSummary = {
  ...adminSummary,
  margin: null,
  topProducts: adminSummary.topProducts.map(product => ({
    ...product,
    grossProfit: null,
    grossMarginPct: null,
  })),
};

describe('DayCloseSummaryModal (ENG-198)', () => {
  beforeEach(async () => {
    mockQueryState = { data: adminSummary, isPending: false, isError: false };
    await i18n.changeLanguage('en');
  });

  it('renders the full owner view: sales, balance, margin, streak, top products', () => {
    render(<DayCloseSummaryModal sessionId="cs-1" onClose={vi.fn()} />);

    expect(screen.getByText('Day closed')).toBeInTheDocument();
    expect(screen.getByText(/Front register/)).toBeInTheDocument();
    expect(screen.getByText('$950.00')).toBeInTheDocument();
    expect(screen.getByText('12 sales')).toBeInTheDocument();
    expect(screen.getByText('Balanced')).toBeInTheDocument();
    expect(screen.getByText('Counted: $350.00')).toBeInTheDocument();
    expect(screen.getByTestId('day-close-margin')).toBeInTheDocument();
    expect(screen.getByText('$420.00')).toBeInTheDocument();
    expect(screen.getByText('44.2% gross margin')).toBeInTheDocument();
    expect(screen.getByText('5 days balancing')).toBeInTheDocument();
    expect(screen.getByText('Café 500g')).toBeInTheDocument();
    expect(screen.getByText('+$180.00')).toBeInTheDocument();
  });

  it('hides owner data for the cashier payload', () => {
    mockQueryState = { data: cashierSummary, isPending: false, isError: false };
    render(<DayCloseSummaryModal sessionId="cs-1" onClose={vi.fn()} />);

    expect(screen.queryByTestId('day-close-margin')).not.toBeInTheDocument();
    expect(screen.queryByText(/^\+\$/)).not.toBeInTheDocument();
    // Revenue-only rows still list the products.
    expect(screen.getByText('Café 500g')).toBeInTheDocument();
    expect(screen.getByText('$400.00')).toBeInTheDocument();
  });

  it('shows the short semaphore with the absolute amount', () => {
    mockQueryState = {
      data: {
        ...adminSummary,
        session: { ...adminSummary.session, overShort: -5.5, balanced: false },
      },
      isPending: false,
      isError: false,
    };
    render(<DayCloseSummaryModal sessionId="cs-1" onClose={vi.fn()} />);

    expect(screen.getByText('Short by $5.50')).toBeInTheDocument();
  });

  it('renders the neutral zero-streak copy without the flame', () => {
    mockQueryState = {
      data: { ...adminSummary, streakDays: 0 },
      isPending: false,
      isError: false,
    };
    render(<DayCloseSummaryModal sessionId="cs-1" onClose={vi.fn()} />);

    expect(screen.getByText('A new streak starts tomorrow.')).toBeInTheDocument();
    expect(screen.queryByText(/🔥/)).not.toBeInTheDocument();
  });

  it('shows the loading state while the summary is pending', () => {
    mockQueryState = { data: undefined, isPending: true, isError: false };
    render(<DayCloseSummaryModal sessionId="cs-1" onClose={vi.fn()} />);

    expect(screen.getByText('Preparing your day summary…')).toBeInTheDocument();
  });

  it('shows the reassurance error copy when the query fails', () => {
    mockQueryState = { data: undefined, isPending: false, isError: true };
    render(<DayCloseSummaryModal sessionId="cs-1" onClose={vi.fn()} />);

    expect(
      screen.getByText('We could not load the day summary. Your register was closed correctly.')
    ).toBeInTheDocument();
  });

  it('closes through the single Done button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DayCloseSummaryModal sessionId="cs-1" onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
