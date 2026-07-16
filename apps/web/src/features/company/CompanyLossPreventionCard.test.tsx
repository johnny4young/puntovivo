import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { fireEvent } from '@testing-library/react';
import { render, screen } from '@/test/utils';
import { CompanyLossPreventionCard } from './CompanyLossPreventionCard';

const queryState = vi.hoisted(() => ({
  data: {
    version: 1 as const,
    roles: {
      cashier: {
        maxDiscountPercent: 0,
        afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
      },
      manager: {
        maxDiscountPercent: 100,
        afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
      },
    },
  },
  isLoading: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));
const setData = vi.hoisted(() => vi.fn());
const mutate = vi.hoisted(() => vi.fn());
const criticalState = vi.hoisted(() => ({ isPending: false }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      lossPrevention: { getSettings: { setData } },
    }),
    lossPrevention: {
      getSettings: { useQuery: () => queryState },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutate, isPending: criticalState.isPending }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

describe('CompanyLossPreventionCard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage('en');
    queryState.isLoading = false;
    queryState.error = null;
    criticalState.isPending = false;
  });

  it('renders both role policies and keeps save disabled until a change', () => {
    render(<CompanyLossPreventionCard />);

    expect(screen.getByRole('heading', { name: 'Loss prevention' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Cashier policy' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Manager policy' })).toBeInTheDocument();
    expect(screen.getAllByLabelText('Maximum discount without approval')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save checkout controls' })).toBeDisabled();
  });

  it('submits a complete policy snapshot after editing the cashier controls', async () => {
    const user = userEvent.setup();
    render(<CompanyLossPreventionCard />);

    const cashierCard = screen.getByTestId('loss-prevention-role-cashier');
    const discount = cashierCard.querySelector('input[type="number"]');
    if (!discount) throw new Error('Expected cashier discount input');
    await user.clear(discount);
    await user.type(discount, '7.5');
    await user.click(
      screen.getAllByRole('checkbox', {
        name: /Require approval during blocked hours/,
      })[0]!
    );
    await user.click(screen.getByRole('button', { name: 'Save checkout controls' }));

    expect(mutate).toHaveBeenCalledWith({
      roles: {
        cashier: {
          maxDiscountPercent: 7.5,
          afterHoursSale: { enabled: true, blockedFrom: '22:00', blockedUntil: '06:00' },
        },
        manager: {
          maxDiscountPercent: 100,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
        },
      },
    });
  });

  it('blocks an enabled zero-length time window', async () => {
    const user = userEvent.setup();
    render(<CompanyLossPreventionCard />);

    const cashierCard = screen.getByTestId('loss-prevention-role-cashier');
    await user.click(
      screen.getAllByRole('checkbox', {
        name: /Require approval during blocked hours/,
      })[0]!
    );
    const times = cashierCard.querySelectorAll<HTMLInputElement>('input[type="time"]');
    fireEvent.change(times[1]!, { target: { value: '22:00' } });

    expect(screen.getByRole('alert')).toHaveTextContent('different start and end times');
    expect(screen.getByRole('button', { name: 'Save checkout controls' })).toBeDisabled();
  });

  it('blocks a policy snapshot with an empty time boundary', () => {
    render(<CompanyLossPreventionCard />);

    const cashierCard = screen.getByTestId('loss-prevention-role-cashier');
    const times = cashierCard.querySelectorAll<HTMLInputElement>('input[type="time"]');
    fireEvent.change(times[0]!, { target: { value: '' } });

    expect(screen.getByRole('alert')).toHaveTextContent('different start and end times');
    expect(screen.getByRole('button', { name: 'Save checkout controls' })).toBeDisabled();
  });

  it('shows a retryable error state', async () => {
    queryState.error = new Error('offline');
    render(<CompanyLossPreventionCard />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(queryState.refetch).toHaveBeenCalledOnce();
  });
});
