import { describe, expect, it } from 'vitest';
import type { SalePaymentValues } from '@/features/sales/SalePaymentModal';
import type { SalePayment } from '@/types';
import {
  getCheckoutPaymentState,
  getRequestedPaymentStatus,
  hasSplitPayments,
} from './checkoutPayment';

function buildPaymentValues(
  overrides?: Partial<SalePaymentValues>
): SalePaymentValues {
  return {
    customerId: '',
    paymentMethod: 'cash',
    amountReceived: 100,
    notes: '',
    tenders: [],
    tipAmount: 0,
    tipMethod: null,
    serviceChargeAmount: 0,
    serviceChargeRate: null,
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

  describe('hasSplitPayments', () => {
    function buildPayment(overrides?: Partial<SalePayment>): SalePayment {
      return {
        id: 'pay_1',
        method: 'cash',
        amount: 10,
        reference: null,
        createdAt: '2026-04-17T00:00:00.000Z',
        ...overrides,
      };
    }

    it('returns false when payments is missing or empty', () => {
      expect(hasSplitPayments({ payments: undefined })).toBe(false);
      expect(hasSplitPayments({ payments: [] })).toBe(false);
    });

    it('returns false for a single-tender sale (the Payment tile already covers it)', () => {
      expect(hasSplitPayments({ payments: [buildPayment()] })).toBe(false);
    });

    it('returns true when two or more tenders are present', () => {
      expect(
        hasSplitPayments({
          payments: [
            buildPayment({ method: 'cash', amount: 4 }),
            buildPayment({ id: 'pay_2', method: 'card', amount: 6 }),
          ],
        })
      ).toBe(true);
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

  describe('getRequestedPaymentStatus — single-tender branches', () => {
    it('returns "paid" when the cashier covers the total in cash', () => {
      const values = buildPaymentValues({
        paymentMethod: 'cash',
        amountReceived: 120,
      });
      expect(getRequestedPaymentStatus(values, 100)).toBe('paid');
    });

    it('returns "partial" when the cashier covers part of the total', () => {
      const values = buildPaymentValues({
        paymentMethod: 'cash',
        amountReceived: 50,
      });
      expect(getRequestedPaymentStatus(values, 100)).toBe('partial');
    });

    it('returns "pending" when no money has been received and the method is not credit', () => {
      const values = buildPaymentValues({
        paymentMethod: 'cash',
        amountReceived: 0,
      });
      expect(getRequestedPaymentStatus(values, 100)).toBe('pending');
    });

    it('returns "paid" when split tenders exist regardless of the legacy method', () => {
      const values = buildPaymentValues({
        paymentMethod: 'cash',
        amountReceived: 0,
        tenders: [{ method: 'cash', amount: 100, reference: '' }],
      });
      expect(getRequestedPaymentStatus(values, 100)).toBe('paid');
    });
  });

  describe('getCheckoutPaymentState — split-tender dominant-method tie-break', () => {
    it('preserves the first tender on amount ties (cash-biased default)', () => {
      const values = buildPaymentValues({
        tenders: [
          { method: 'cash', amount: 50, reference: '' },
          { method: 'card', amount: 50, reference: '' },
        ],
      });
      // The first tender (cash) wins the tie via strict `>` comparison.
      expect(getCheckoutPaymentState(values, 100).paymentMethod).toBe('cash');
    });

    it('elects the largest tender as the dominant method', () => {
      const values = buildPaymentValues({
        tenders: [
          { method: 'cash', amount: 30, reference: '' },
          { method: 'card', amount: 70, reference: '' },
        ],
      });
      expect(getCheckoutPaymentState(values, 100).paymentMethod).toBe('card');
    });

    it('falls back to cash when the tenders array is empty (defensive helper guard)', () => {
      // Synthetic case: tenders=[] forces the legacy branch in the public
      // function. The internal helper never sees this path because the
      // outer `if (values.tenders.length > 0)` short-circuits first.
      const values = buildPaymentValues({
        paymentMethod: 'cash',
        tenders: [],
      });
      expect(getCheckoutPaymentState(values, 100).paymentMethod).toBe('cash');
    });
  });
});
