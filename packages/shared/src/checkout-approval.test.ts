import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCheckoutApprovalDiscountAmount,
  getRequiredCheckoutApprovalActions,
  serializeCheckoutApprovalContext,
} from './checkout-approval.ts';

const base = {
  mode: 'fresh' as const,
  saleId: null,
  customerId: 'customer-1',
  items: [
    {
      productId: 'product-b',
      unitId: 'unit-2',
      quantity: 1,
      unitPrice: 25,
      discount: 10,
    },
    {
      productId: 'product-a',
      unitId: 'unit-1',
      quantity: 2,
      unitPrice: 50,
      discount: 0,
    },
  ],
  paymentMethod: 'cash' as const,
  payments: [{ method: 'cash' as const, amount: 100, reference: '  drawer  ' }],
  amountReceived: 100,
  discountAmount: 10,
  total: 100,
  creditAmount: 0,
  tipAmount: 0,
  serviceChargeAmount: 0,
  currencyCode: 'COP',
};

test('checkout approval serialization is stable across item order and float drift', () => {
  const reordered = {
    ...base,
    items: [...base.items].reverse().map(item => ({
      ...item,
      quantity: item.quantity + Number.EPSILON,
    })),
  };

  assert.equal(serializeCheckoutApprovalContext(reordered), serializeCheckoutApprovalContext(base));
});

test('checkout approval serialization is stable for repeated product and unit keys', () => {
  const repeated = {
    ...base,
    items: [
      { ...base.items[0]!, productId: 'same', unitId: 'same', quantity: 2 },
      { ...base.items[1]!, productId: 'same', unitId: 'same', quantity: 1 },
    ],
  };

  assert.equal(
    serializeCheckoutApprovalContext(repeated),
    serializeCheckoutApprovalContext({ ...repeated, items: [...repeated.items].reverse() })
  );
});

test('checkout approval serialization changes with the financial payload', () => {
  const changed = {
    ...base,
    payments: [{ method: 'credit' as const, amount: 100 }],
    creditAmount: 100,
  };

  assert.notEqual(
    serializeCheckoutApprovalContext(changed),
    serializeCheckoutApprovalContext(base)
  );
});

test('checkout approval discount mirrors per-line sale rounding', () => {
  assert.equal(
    getCheckoutApprovalDiscountAmount([
      { productId: 'a', unitId: 'u', quantity: 1, unitPrice: 0.05, discount: 10 },
      { productId: 'b', unitId: 'u', quantity: 1, unitPrice: 0.05, discount: 10 },
    ]),
    0.02
  );
  assert.equal(getCheckoutApprovalDiscountAmount([], 1.005), 1.01);
});

test('checkout approval policy preserves direct authority and exact escalation', () => {
  assert.deepEqual(
    getRequiredCheckoutApprovalActions({
      role: 'cashier',
      isCompletion: true,
      hasDiscount: true,
      hasCreditTender: true,
      creditOverride: false,
    }),
    ['sale_discount', 'credit_sale']
  );
  assert.deepEqual(
    getRequiredCheckoutApprovalActions({
      role: 'manager',
      isCompletion: true,
      hasDiscount: true,
      hasCreditTender: true,
      creditOverride: true,
    }),
    ['credit_override']
  );
  assert.deepEqual(
    getRequiredCheckoutApprovalActions({
      role: 'admin',
      isCompletion: true,
      hasDiscount: true,
      hasCreditTender: true,
      creditOverride: true,
    }),
    []
  );
  assert.deepEqual(
    getRequiredCheckoutApprovalActions({
      role: 'cashier',
      isCompletion: false,
      hasDiscount: true,
      hasCreditTender: true,
      creditOverride: true,
    }),
    []
  );
});
