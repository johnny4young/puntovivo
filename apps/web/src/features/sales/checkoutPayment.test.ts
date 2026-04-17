import { describe, expect, it } from 'vitest';
import type { SalePaymentValues } from '@/features/sales/SalePaymentModal';
import { getCheckoutPaymentState, getRequestedPaymentStatus } from './checkoutPayment';

function buildPaymentValues(
  overrides?: Partial<SalePaymentValues>
): SalePaymentValues {
  return {
    customerId: '',
    paymentMethod: 'cash',
    amountReceived: 100,
    notes: '',
    tenders: [],
    ...overrides,
  };
}

describe('checkoutPayment', () => {
  it('keeps credit sales pending on the legacy single-tender path', () => {
    const values = buildPaymentValues({
      paymentMethod: 'credit',
      amountReceived: 100,
    });

    expect(getRequestedPaymentStatus(values, 100)).toBe('pending');
    expect(getCheckoutPaymentState(values, 100)).toEqual({
      paymentMethod: 'credit',
      paymentStatus: 'pending',
      amountReceived: 0,
      payments: undefined,
    });
  });

  it('derives a paid checkout state from split tenders even if the hidden legacy method was credit', () => {
    const values = buildPaymentValues({
      paymentMethod: 'credit',
      amountReceived: 0,
      tenders: [
        { method: 'cash', amount: 40, reference: '' },
        { method: 'card', amount: 60, reference: 'AUTH-42' },
      ],
    });

    expect(getRequestedPaymentStatus(values, 100)).toBe('paid');
    expect(getCheckoutPaymentState(values, 100)).toEqual({
      paymentMethod: 'card',
      paymentStatus: 'paid',
      amountReceived: 100,
      payments: [
        { method: 'cash', amount: 40 },
        { method: 'card', amount: 60, reference: 'AUTH-42' },
      ],
    });
  });

  it('strips blank/whitespace-only references when forwarding split tenders', () => {
    const values = buildPaymentValues({
      tenders: [
        { method: 'cash', amount: 50, reference: '   ' },
        { method: 'transfer', amount: 50, reference: '  WIRE-9   ' },
      ],
    });

    const state = getCheckoutPaymentState(values, 100);

    expect(state.payments).toEqual([
      { method: 'cash', amount: 50 },
      { method: 'transfer', amount: 50, reference: 'WIRE-9' },
    ]);
  });
});
