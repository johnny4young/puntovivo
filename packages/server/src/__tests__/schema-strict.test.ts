/**
 * ENG-166 — pins `.strict()` on the auth-critical Zod schemas. The audit
 * found that every `z.object` in the schemas folder was running under
 * the default `strip` mode, silently dropping unrecognised keys. Adding
 * `.strict()` to the auth + users + sales-mutation + payments-mutation
 * inputs flips them to reject extra keys with a clear ZodError instead.
 */

import { describe, expect, it } from 'vitest';
import {
  createSaleInput,
  updateSaleInput,
  voidSaleInput,
  returnSaleInput,
  suspendSaleInput,
  completeDraftInput,
  discardDraftInput,
  changeSaleTableInput,
  splitDraftInput,
  getForReprintInput,
  salePaymentInput,
  saleItemInput,
} from '../trpc/schemas/sales.js';
import {
  peekPaymentOutboxInput,
  paymentReconciliationInput,
  updatePaymentRailSettingsInput,
  retryPaymentOutboxInput,
  markPaymentOutboxSettledInput,
  paymentMethodBreakdownInput,
} from '../trpc/schemas/payments.js';

function expectExtraKeyRejected<T>(schema: { parse: (v: T) => unknown }, valid: T, extra: object): void {
  const polluted = { ...valid, ...extra } as T;
  expect(() => schema.parse(polluted)).toThrow();
}

describe('sales schemas reject extra keys', () => {
  it('saleItemInput', () => {
    expectExtraKeyRejected(
      saleItemInput,
      {
        productId: 'p1',
        unitId: 'u1',
        quantity: 1,
        unitPrice: 100,
        discount: 0,
      },
      { evil: true }
    );
  });

  it('salePaymentInput', () => {
    expectExtraKeyRejected(
      salePaymentInput,
      { method: 'cash', amount: 100 },
      { hijack: 'value' }
    );
  });

  it('updateSaleInput', () => {
    expectExtraKeyRejected(updateSaleInput, { id: 'x' }, { unknown: 1 });
  });

  it('voidSaleInput', () => {
    expectExtraKeyRejected(voidSaleInput, { id: 'x' }, { evil: 1 });
  });

  it('returnSaleInput', () => {
    expectExtraKeyRejected(returnSaleInput, { id: 'x' }, { extra: 1 });
  });

  it('suspendSaleInput', () => {
    expectExtraKeyRejected(suspendSaleInput, { saleId: 'x' }, { extra: 1 });
  });

  it('discardDraftInput', () => {
    expectExtraKeyRejected(discardDraftInput, { saleId: 'x' }, { extra: 1 });
  });

  it('changeSaleTableInput', () => {
    expectExtraKeyRejected(
      changeSaleTableInput,
      { saleId: 'x', tableId: null },
      { extra: 1 }
    );
  });

  it('splitDraftInput', () => {
    expectExtraKeyRejected(
      splitDraftInput,
      { sourceSaleId: 'x', saleItemIds: ['i'], tableId: null },
      { extra: 1 }
    );
  });

  it('getForReprintInput', () => {
    expectExtraKeyRejected(getForReprintInput, { saleId: 'x' }, { extra: 1 });
  });

  it('createSaleInput (refined object — strict applied before refine)', () => {
    expectExtraKeyRejected(
      createSaleInput,
      {
        items: [{ productId: 'p1', unitId: 'u1', quantity: 1, unitPrice: 100 }],
      },
      { evil: true }
    );
  });

  it('completeDraftInput (refined object — strict applied before refine)', () => {
    expectExtraKeyRejected(completeDraftInput, { saleId: 'x' }, { evil: true });
  });
});

describe('payments schemas reject extra keys', () => {
  it('peekPaymentOutboxInput', () => {
    expectExtraKeyRejected(peekPaymentOutboxInput, {}, { extra: 1 });
  });

  it('paymentReconciliationInput', () => {
    expectExtraKeyRejected(paymentReconciliationInput, {}, { extra: 1 });
  });

  it('updatePaymentRailSettingsInput', () => {
    expectExtraKeyRejected(
      updatePaymentRailSettingsInput,
      { railId: 'co.bold', credentials: {} },
      { unknown: 1 }
    );
  });

  it('retryPaymentOutboxInput', () => {
    expectExtraKeyRejected(retryPaymentOutboxInput, { outboxId: 'x' }, { extra: 1 });
  });

  it('markPaymentOutboxSettledInput', () => {
    expectExtraKeyRejected(
      markPaymentOutboxSettledInput,
      { outboxId: 'x' },
      { extra: 1 }
    );
  });

  it('paymentMethodBreakdownInput', () => {
    expectExtraKeyRejected(paymentMethodBreakdownInput, {}, { extra: 1 });
  });
});
