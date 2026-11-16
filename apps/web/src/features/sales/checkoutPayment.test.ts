import { describe, expect, it } from 'vitest';
import type { SalePaymentValues } from '@/features/sales/SalePaymentModal';
import type { SalePayment } from '@/types';
import {
  checkoutUsesCreditTender,
  deriveSingleTenders,
  getCheckoutPaymentState,
  getRequestedPaymentStatus,
  hasSplitPayments,
} from './checkoutPayment';

function buildPaymentValues(overrides?: Partial<SalePaymentValues>): SalePaymentValues {
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
    creditOverride: false,
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

    expect(checkoutUsesCreditTender(values)).toBe(false);
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

  it('derives a partial checkout state from split credit and demotes credit from the dominant legacy method', () => {
    const values = buildPaymentValues({
      paymentMethod: 'cash',
      amountReceived: 0,
      tenders: [
        { method: 'cash', amount: 40, reference: '' },
        { method: 'credit', amount: 60, reference: '' },
      ],
    });

    expect(checkoutUsesCreditTender(values)).toBe(true);
    expect(getRequestedPaymentStatus(values, 100)).toBe('partial');
    expect(getCheckoutPaymentState(values, 100)).toEqual({
      paymentMethod: 'cash',
      paymentStatus: 'partial',
      amountReceived: 100,
      payments: [
        { method: 'cash', amount: 40 },
        { method: 'credit', amount: 60 },
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
      // exactOptional rejects `{ payments: undefined }`; pass the bare object instead.
      expect(hasSplitPayments({} as { payments?: SalePayment[] })).toBe(false);
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

  it('forwards whole points only on loyalty tenders', () => {
    const values = buildPaymentValues({
      customerId: 'customer-1',
      tenders: [
        { method: 'loyalty', amount: 20, loyaltyPoints: 4, reference: '' },
        { method: 'store_credit', amount: 30, reference: '' },
        { method: 'cash', amount: 50, loyaltyPoints: undefined, reference: '' },
      ],
    });

    expect(getCheckoutPaymentState(values, 100).payments).toEqual([
      { method: 'loyalty', amount: 20, loyaltyPoints: 4 },
      { method: 'store_credit', amount: 30 },
      { method: 'cash', amount: 50 },
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

    it('returns "partial" when split tenders include a credit portion', () => {
      const values = buildPaymentValues({
        paymentMethod: 'cash',
        amountReceived: 0,
        tenders: [
          { method: 'cash', amount: 80, reference: '' },
          { method: 'credit', amount: 20, reference: '' },
        ],
      });
      expect(getRequestedPaymentStatus(values, 100)).toBe('partial');
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

    it('demotes credit from the dominant method when a non-credit tender exists', () => {
      const values = buildPaymentValues({
        tenders: [
          { method: 'cash', amount: 30, reference: '' },
          { method: 'credit', amount: 70, reference: '' },
        ],
      });
      expect(getCheckoutPaymentState(values, 100).paymentMethod).toBe('cash');
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

describe('deriveSingleTenders', () => {
  const base = {
    paymentMethod: 'cash' as const,
    grandTotal: 18_800,
    amountReceived: 18_800,
    reference: '',
    creditDownPayment: 0,
  };

  it('keeps plain cash, card and credit on the one-row path', () => {
    expect(deriveSingleTenders(base)).toEqual([]);
    expect(deriveSingleTenders({ ...base, paymentMethod: 'card' })).toEqual([]);
    expect(deriveSingleTenders({ ...base, paymentMethod: 'credit' })).toEqual([]);
  });

  it('carries the proof of a fully paid transfer or card as one tender', () => {
    expect(
      deriveSingleTenders({ ...base, paymentMethod: 'transfer', reference: '  M482190 ' })
    ).toEqual([{ method: 'transfer', amount: 18_800, reference: 'M482190' }]);
    expect(deriveSingleTenders({ ...base, paymentMethod: 'card', reference: '004512' })).toEqual([
      { method: 'card', amount: 18_800, reference: '004512' },
    ]);
  });

  it('never attaches a reference to cash', () => {
    expect(deriveSingleTenders({ ...base, reference: 'ignored' })).toEqual([]);
  });

  it('leaves a partial payment on the one-row path, where tenders cannot add up', () => {
    expect(
      deriveSingleTenders({
        ...base,
        paymentMethod: 'transfer',
        reference: 'M482190',
        amountReceived: 10_000,
      })
    ).toEqual([]);
  });

  it('splits a credit sale into the cash paid now and the rest on credit', () => {
    expect(
      deriveSingleTenders({ ...base, paymentMethod: 'credit', creditDownPayment: 5_000 })
    ).toEqual([
      { method: 'cash', amount: 5_000, reference: '' },
      { method: 'credit', amount: 13_800, reference: '' },
    ]);
  });

  it('rounds the financed part to cents', () => {
    const tenders = deriveSingleTenders({
      ...base,
      paymentMethod: 'credit',
      grandTotal: 100.1,
      creditDownPayment: 33.33,
    });
    expect(tenders.map(tender => tender.amount)).toEqual([33.33, 66.77]);
  });

  it('ignores a down payment that is not a real split', () => {
    for (const creditDownPayment of [0, -10, 18_800, 20_000]) {
      expect(deriveSingleTenders({ ...base, paymentMethod: 'credit', creditDownPayment })).toEqual(
        []
      );
    }
  });

  it('builds a payable state from the derived tenders', () => {
    const tenders = deriveSingleTenders({
      ...base,
      paymentMethod: 'credit',
      creditDownPayment: 5_000,
    });
    const state = getCheckoutPaymentState(
      buildPaymentValues({ paymentMethod: 'credit', tenders }),
      18_800
    );
    expect(state.paymentMethod).toBe('cash');
    expect(state.paymentStatus).toBe('partial');
    expect(state.payments).toHaveLength(2);
  });
});
