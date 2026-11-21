import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils';
import CustomerTillPaymentDialog from './CustomerTillPaymentDialog';

const toastSuccess = vi.hoisted(() => vi.fn());
const invalidated = vi.hoisted(() => [] as string[]);
const failing = vi.hoisted(() => new Set<string>());
const mutation = vi.hoisted(() => ({
  path: '',
  options: null as null | { onSuccess: () => Promise<void> },
  mutateAsync: vi.fn(),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/lib/trpc', () => {
  const tracked = (name: string) => ({
    invalidate: vi.fn(async (input?: { customerId?: string }) => {
      invalidated.push(input?.customerId ? `${name}:${input.customerId}` : name);
      if (failing.has(name)) throw new Error('refetch failed');
    }),
  });
  return {
    trpc: {
      useUtils: () => ({
        customerLedger: { getBalance: tracked('getBalance'), list: tracked('list') },
        cashSessions: {
          getActive: tracked('getActive'),
          movements: tracked('movements'),
          report: tracked('report'),
          myShiftSummary: tracked('myShiftSummary'),
        },
      }),
    },
  };
});

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string, options: { onSuccess: () => Promise<void> }) => {
    mutation.path = path;
    mutation.options = options;
    return { mutateAsync: mutation.mutateAsync, isPending: false, error: null };
  },
}));

describe('CustomerTillPaymentDialog', () => {
  beforeEach(() => {
    invalidated.length = 0;
    failing.clear();
    mutation.mutateAsync.mockReset();
    mutation.mutateAsync.mockImplementation(async () => mutation.options?.onSuccess());
  });

  it('takes the abono into the drawer and refreshes the account and the register', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CustomerTillPaymentDialog
        customerId="customer-1"
        customerName="Juan Pérez"
        balance={84_300}
        onClose={onClose}
      />
    );

    const amount = screen.getByTestId('customer-ledger-amount-input');
    await user.clear(amount);
    await user.type(amount, '30000');
    await user.type(screen.getByTestId('customer-ledger-note-input'), 'semana');
    await user.click(screen.getByRole('button', { name: 'Take payment' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mutation.path).toBe('customerLedger.addTillPayment');
    expect(mutation.mutateAsync).toHaveBeenCalledWith({
      customerId: 'customer-1',
      amount: 30_000,
      note: 'semana',
    });
    expect(invalidated).toEqual(
      expect.arrayContaining([
        'getBalance:customer-1',
        'list:customer-1',
        'getActive',
        'movements',
        'report',
      ])
    );
    expect(toastSuccess).toHaveBeenCalledWith({ title: 'Payment taken into the register' });
  });

  it('closes and confirms a committed abono even when a refresh fails', async () => {
    failing.add('getBalance');
    failing.add('report');
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CustomerTillPaymentDialog
        customerId="customer-1"
        customerName="Juan Pérez"
        balance={84_300}
        onClose={onClose}
      />
    );

    await user.click(screen.getByTestId('customer-ledger-pay-all'));
    await user.click(screen.getByRole('button', { name: 'Take payment' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenLastCalledWith({ title: 'Payment taken into the register' });
  });
});
