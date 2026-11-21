import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { initialTenderValues } from './salePaymentModal.constants';
import { useSalePaymentModal, type UseSalePaymentModalParams } from './useSalePaymentModal';

const idleQuery = vi.hoisted(() => () => ({
  data: undefined,
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
  refetch: () => undefined,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ managerApprovals: { mine: { invalidate: vi.fn() } } }),
    customerLedger: { getBalance: { useQuery: idleQuery } },
    lossPrevention: {
      evaluateCheckout: {
        useQuery: () => ({ ...idleQuery(), data: { requiredActions: [], violations: [] } }),
      },
    },
    sales: {
      electronicInvoiceAvailability: { useQuery: idleQuery },
      quotePromotions: { useQuery: idleQuery },
    },
    pharmacy: {
      checkoutRequirements: {
        useQuery: () => ({
          ...idleQuery(),
          data: { customerValid: null, requirements: [], ready: true },
        }),
      },
    },
    managerApprovals: { mine: { useQuery: () => ({ ...idleQuery(), data: [] }) } },
    loyalty: { forCustomer: { useQuery: idleQuery } },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

function renderPayment(overrides: Partial<UseSalePaymentModalParams> = {}) {
  return renderHook((props: Partial<UseSalePaymentModalParams>) =>
    useSalePaymentModal({
      isOpen: true,
      total: 87_420,
      customers: [],
      isSaving: false,
      userRole: 'cashier',
      onSubmit: vi.fn(async () => undefined),
      ...overrides,
      ...props,
    })
  );
}

describe('initialTenderValues', () => {
  it('starts on the tender picked on the ticket', () => {
    expect(initialTenderValues('card', 100, false)).toEqual({ paymentMethod: 'card', tenders: [] });
    expect(initialTenderValues('transfer', 100, false).paymentMethod).toBe('transfer');
    expect(initialTenderValues('credit', 100, true).paymentMethod).toBe('credit');
  });

  it('falls back to cash for credit without a customer', () => {
    expect(initialTenderValues('credit', 100, false).paymentMethod).toBe('cash');
  });

  it('seeds the first split row with the amount due', () => {
    expect(initialTenderValues('split', 96_162, false).tenders).toEqual([
      { method: 'cash', amount: 96_162, reference: '' },
    ]);
  });
});

describe('useSalePaymentModal — tender chosen before opening', () => {
  it('opens on cash by default', () => {
    const { result } = renderPayment();
    expect(result.current.paymentMethod).toBe('cash');
    expect(result.current.splitMode).toBe(false);
  });

  it('opens on the remembered method', () => {
    const { result } = renderPayment({ initialMethod: 'transfer' });
    expect(result.current.paymentMethod).toBe('transfer');
    expect(result.current.isCash).toBe(false);
  });

  it('starts credit as soon as a customer is picked when it opened on credit', async () => {
    const { result } = renderPayment({ initialMethod: 'credit' });
    expect(result.current.paymentMethod).toBe('cash');

    act(() => result.current.form.setValue('customerId', 'customer-1'));
    await waitFor(() => expect(result.current.paymentMethod).toBe('credit'));
  });

  it('keeps cash when the cashier taps it before picking a customer', async () => {
    const { result } = renderPayment({ initialMethod: 'credit' });
    act(() =>
      result.current.form.setValue('paymentMethod', 'cash', {
        shouldDirty: true,
        shouldTouch: true,
      })
    );
    act(() => result.current.form.setValue('customerId', 'customer-1'));

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(result.current.paymentMethod).toBe('cash');
  });

  it('keeps the method the cashier switched to before picking a customer', async () => {
    const { result } = renderPayment({ initialMethod: 'credit' });
    act(() => result.current.form.setValue('paymentMethod', 'card'));
    act(() => result.current.form.setValue('customerId', 'customer-1'));

    await waitFor(() => expect(result.current.paymentMethod).toBe('card'));
  });

  it('opens split with the first row covering the total', () => {
    const { result } = renderPayment({ initialMethod: 'split' });
    expect(result.current.splitMode).toBe(true);
    expect(result.current.tenderFields.fields).toHaveLength(1);
    expect(result.current.tenderSum).toBe(87_420);
  });
});

describe('useSalePaymentModal — one-touch cash', () => {
  it('enters the tendered bill and shows its change', async () => {
    const { result } = renderPayment({ fastCashTrigger: 1, fastCashAmount: 90_000 });

    await waitFor(() => expect(result.current.amountReceivedValue).toBe(90_000));
    expect(result.current.paymentMethod).toBe('cash');
    expect(result.current.change).toBe(2_580);
    expect(result.current.outstanding).toBe(0);
  });

  it('enters the exact total when no amount comes with the signal', async () => {
    const { result } = renderPayment({ initialMethod: 'card', fastCashTrigger: 1 });

    await waitFor(() => expect(result.current.paymentMethod).toBe('cash'));
    expect(result.current.amountReceivedValue).toBe(87_420);
    expect(result.current.change).toBe(0);
  });

  it('re-applies a new bill while the drawer is open', async () => {
    const { result, rerender } = renderPayment({ fastCashTrigger: 1, fastCashAmount: 90_000 });
    await waitFor(() => expect(result.current.amountReceivedValue).toBe(90_000));

    act(() => rerender({ fastCashTrigger: 2, fastCashAmount: 100_000 }));
    await waitFor(() => expect(result.current.amountReceivedValue).toBe(100_000));
    expect(result.current.change).toBe(12_580);
  });
});
