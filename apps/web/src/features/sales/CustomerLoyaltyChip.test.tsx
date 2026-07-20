/**
 * the checkout loyalty chip only speaks when it has something to
 * say: a picked customer WITH points. Walk-ins, point-less customers, and
 * the in-flight read stay silent so the payment surface is untouched for
 * every tenant that never enabled the program.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import i18n from '@/i18n';
import { render } from '@/test/utils';
import { CustomerLoyaltyChip } from './CustomerLoyaltyChip';

let mockData: { points: number; movements: unknown[] } | undefined;
const useQuerySpy = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    loyalty: {
      forCustomer: {
        useQuery: (input: unknown, opts: unknown) => {
          useQuerySpy(input, opts);
          return { data: mockData, isLoading: false, error: null };
        },
      },
    },
  },
}));

describe('CustomerLoyaltyChip', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
    mockData = { points: 120, movements: [] };
  });

  it('shows the balance for a customer with points', () => {
    render(<CustomerLoyaltyChip customerId="cust-1" />);
    expect(screen.getByTestId('customer-loyalty-chip')).toHaveTextContent('120 points');
  });

  it('stays silent for a walk-in and never fires the query', () => {
    render(<CustomerLoyaltyChip customerId={null} />);
    expect(screen.queryByTestId('customer-loyalty-chip')).not.toBeInTheDocument();
    // The query is mounted but disabled — no request for a walk-in.
    expect(useQuerySpy).toHaveBeenCalledWith(
      { customerId: '', limit: 1 },
      expect.objectContaining({ enabled: false })
    );
  });

  it('stays silent for a customer without points', () => {
    mockData = { points: 0, movements: [] };
    render(<CustomerLoyaltyChip customerId="cust-1" />);
    expect(screen.queryByTestId('customer-loyalty-chip')).not.toBeInTheDocument();
  });

  it('does not leak a cached balance to a walk-in', () => {
    // `enabled: false` still serves cached data from the previous customer;
    // the component must gate on the flag too ( lesson).
    mockData = { points: 500, movements: [] };
    render(<CustomerLoyaltyChip customerId={null} />);
    expect(screen.queryByTestId('customer-loyalty-chip')).not.toBeInTheDocument();
  });

  it('renders the singular form for exactly one point', () => {
    mockData = { points: 1, movements: [] };
    render(<CustomerLoyaltyChip customerId="cust-1" />);
    expect(screen.getByTestId('customer-loyalty-chip')).toHaveTextContent('1 point');
  });
});
