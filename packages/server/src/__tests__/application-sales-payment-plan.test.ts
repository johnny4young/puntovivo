import { describe, expect, it } from 'vitest';
import { resolveSalePaymentPlan } from '../application/sales/pricing.js';
import type { SalePaymentMethod } from '../application/sales/types.js';

describe('cash receipt evidence and net settlement', () => {
  it.each([
    { name: 'exact cash', total: 100, received: 100, captured: 100, change: 0, net: 100 },
    {
      name: 'cash overpayment',
      total: 10000,
      received: 20000,
      captured: 20000,
      change: 10000,
      net: 10000,
    },
    {
      name: 'legitimate partial cash',
      total: 30000,
      received: 20000,
      captured: 20000,
      change: 0,
      net: 20000,
    },
    { name: 'cent rounding', total: 23.8, received: 23.999, captured: 24, change: 0.2, net: 23.8 },
    {
      name: 'omitted exact cash',
      total: 100,
      received: undefined,
      captured: 100,
      change: 0,
      net: 100,
    },
  ])(
    '$name preserves physical evidence separately from net payment and drawer income',
    scenario => {
      const plan = resolveSalePaymentPlan({
        amountReceived: scenario.received,
        payments: undefined,
        paymentMethod: 'cash',
        requestedStatus: 'pending',
        total: scenario.total,
        collectCash: true,
      });
      expect(plan.cashReceivedSnapshot).toBe(scenario.captured);
      expect(plan.cashChangeSnapshot).toBe(scenario.change);
      expect(plan.resolvedPayments.rows[0]?.amount).toBe(scenario.net);
      expect(plan.cashCollectedAmount).toBe(scenario.net);
    }
  );
  it.each(['card', 'transfer', 'credit'] as SalePaymentMethod[])(
    'does not invent a physical handover for %s',
    paymentMethod => {
      const plan = resolveSalePaymentPlan({
        amountReceived: 100,
        payments: undefined,
        paymentMethod,
        requestedStatus: 'pending',
        total: 100,
        collectCash: true,
      });
      expect(plan.cashReceivedSnapshot).toBeNull();
      expect(plan.cashChangeSnapshot).toBeNull();
      expect(plan.cashCollectedAmount).toBe(0);
    }
  );
  it('does not capture a draft or infer overpayment from exact split rows', () => {
    const args = {
      amountReceived: 200,
      payments: undefined,
      paymentMethod: 'cash' as const,
      requestedStatus: 'pending' as const,
      total: 100,
      collectCash: false,
    };
    const draft = resolveSalePaymentPlan(args);
    expect(draft.cashReceivedSnapshot).toBeNull();
    expect(draft.cashChangeSnapshot).toBeNull();
    expect(draft.cashCollectedAmount).toBe(0);
    const split = resolveSalePaymentPlan({
      ...args,
      collectCash: true,
      payments: [
        { method: 'cash', amount: 60, reference: null },
        { method: 'credit', amount: 40, reference: null },
      ],
    });
    expect(split.cashReceivedSnapshot).toBeNull();
    expect(split.cashChangeSnapshot).toBeNull();
    expect(split.cashCollectedAmount).toBe(60);
    expect(split.creditSaleAmount).toBe(40);
    expect(split.paymentStatus).toBe('partial');
  });
});
