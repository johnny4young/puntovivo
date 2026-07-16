import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { fireEvent } from '@testing-library/react';
import { render, screen } from '@/test/utils';
import { CompanyLossPreventionCard } from './CompanyLossPreventionCard';

const queryState = vi.hoisted(() => ({
  data: {
    version: 4 as const,
    roles: {
      cashier: {
        maxDiscountPercent: 0,
        afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
        shift: {
          refunds: { enabled: false, maxCount: 0, maxAmount: 0 },
          voids: { enabled: false, maxCount: 0, maxAmount: 0 },
          noSale: { enabled: false, maxCount: 0 },
        },
        dualApproval: { enabled: false, thresholdAmount: 0 },
      },
      manager: {
        maxDiscountPercent: 100,
        afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
        shift: {
          refunds: { enabled: false, maxCount: 0, maxAmount: 0 },
          voids: { enabled: false, maxCount: 0, maxAmount: 0 },
          noSale: { enabled: false, maxCount: 0 },
        },
        dualApproval: { enabled: false, thresholdAmount: 0 },
      },
    },
    alerts: {
      whatsappHandoff: { enabled: false, recipientPhone: '' },
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
    expect(
      screen.getAllByRole('spinbutton', {
        name: 'Limit refunds per shift Maximum actions',
      })
    ).toHaveLength(2);
    expect(
      screen.getAllByRole('spinbutton', {
        name: 'Limit voids per shift Maximum total amount',
      })
    ).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save checkout controls' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Alert delivery' })).toBeInTheDocument();
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
      alerts: {
        whatsappHandoff: { enabled: false, recipientPhone: '' },
      },
      roles: {
        cashier: {
          maxDiscountPercent: 7.5,
          afterHoursSale: { enabled: true, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: {
            refunds: { enabled: false, maxCount: 0, maxAmount: 0 },
            voids: { enabled: false, maxCount: 0, maxAmount: 0 },
            noSale: { enabled: false, maxCount: 0 },
          },
          dualApproval: { enabled: false, thresholdAmount: 0 },
        },
        manager: {
          maxDiscountPercent: 100,
          afterHoursSale: { enabled: false, blockedFrom: '22:00', blockedUntil: '06:00' },
          shift: {
            refunds: { enabled: false, maxCount: 0, maxAmount: 0 },
            voids: { enabled: false, maxCount: 0, maxAmount: 0 },
            noSale: { enabled: false, maxCount: 0 },
          },
          dualApproval: { enabled: false, thresholdAmount: 0 },
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

  it('submits per-shift refund count and amount controls', async () => {
    const user = userEvent.setup();
    render(<CompanyLossPreventionCard />);

    const managerCard = screen.getByTestId('loss-prevention-role-manager');
    await user.click(screen.getAllByRole('checkbox', { name: /Limit refunds per shift/ })[1]!);
    const count = managerCard.querySelector<HTMLInputElement>(
      '#loss-prevention-manager-refunds-count'
    );
    const amount = managerCard.querySelector<HTMLInputElement>(
      '#loss-prevention-manager-refunds-amount'
    );
    if (!count || !amount) throw new Error('Expected manager refund limit inputs');
    await user.clear(count);
    await user.type(count, '2');
    await user.clear(amount);
    await user.type(amount, '150');
    await user.click(screen.getByRole('button', { name: 'Save checkout controls' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: expect.objectContaining({
          manager: expect.objectContaining({
            shift: expect.objectContaining({
              refunds: { enabled: true, maxCount: 2, maxAmount: 150 },
            }),
          }),
        }),
      })
    );
  });

  it('submits a per-role dual-approval amount threshold', async () => {
    const user = userEvent.setup();
    render(<CompanyLossPreventionCard />);

    const cashierCard = screen.getByTestId('loss-prevention-role-cashier');
    await user.click(
      screen.getAllByRole('checkbox', {
        name: /Require two approvals above an amount/,
      })[0]!
    );
    const threshold = cashierCard.querySelector<HTMLInputElement>(
      '#loss-prevention-cashier-dual-approval-threshold'
    );
    if (!threshold) throw new Error('Expected cashier dual-approval threshold');
    await user.clear(threshold);
    await user.type(threshold, '250');
    await user.click(screen.getByRole('button', { name: 'Save checkout controls' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: expect.objectContaining({
          cashier: expect.objectContaining({
            dualApproval: { enabled: true, thresholdAmount: 250 },
          }),
        }),
      })
    );
  });

  it('normalizes the optional WhatsApp handoff through the authoritative save', async () => {
    const user = userEvent.setup();
    render(<CompanyLossPreventionCard />);

    await user.click(screen.getByRole('checkbox', { name: /Add WhatsApp link to alerts/ }));
    await user.type(screen.getByLabelText('Manager WhatsApp number'), '+57 300 123 4567');
    await user.click(screen.getByRole('button', { name: 'Save checkout controls' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        alerts: {
          whatsappHandoff: { enabled: true, recipientPhone: '+57 300 123 4567' },
        },
      })
    );
  });

  it('blocks an enabled WhatsApp handoff without a valid recipient', async () => {
    const user = userEvent.setup();
    render(<CompanyLossPreventionCard />);

    await user.click(screen.getByRole('checkbox', { name: /Add WhatsApp link to alerts/ }));
    await user.type(screen.getByLabelText('Manager WhatsApp number'), '123');

    expect(screen.getByRole('alert')).toHaveTextContent('international number');
    expect(screen.getByRole('button', { name: 'Save checkout controls' })).toBeDisabled();
  });

  it('shows a retryable error state', async () => {
    queryState.error = new Error('offline');
    render(<CompanyLossPreventionCard />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(queryState.refetch).toHaveBeenCalledOnce();
  });
});
