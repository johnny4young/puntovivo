import { describe, expect, it } from 'vitest';
import {
  buildCheckoutApprovalContext,
  hashCheckoutApprovalContext,
  requiredCheckoutApprovalActions,
} from './checkoutApprovals';
import type { SalePaymentValues } from './salePaymentModal.types';

function paymentValues(overrides: Partial<SalePaymentValues> = {}): SalePaymentValues {
  return {
    customerId: '',
    paymentMethod: 'cash',
    amountReceived: 100,
    notes: '',
    tenders: [],
    tipAmount: 0,
    tipMethod: null,
    creditOverride: false,
    serviceChargeAmount: 0,
    serviceChargeRate: null,
    approvalRequests: [],
    ...overrides,
  };
}

describe('checkout approvals', () => {
  it('keeps the web role policy aligned with direct server permissions', () => {
    expect(
      requiredCheckoutApprovalActions({
        role: 'cashier',
        hasDiscount: true,
        hasCreditTender: true,
        creditOverrideRequired: false,
      })
    ).toEqual(['sale_discount', 'credit_sale']);
    expect(
      requiredCheckoutApprovalActions({
        role: 'cashier',
        hasDiscount: true,
        hasCreditTender: true,
        creditOverrideRequired: true,
      })
    ).toEqual(['sale_discount', 'credit_override']);
    expect(
      requiredCheckoutApprovalActions({
        role: 'manager',
        hasDiscount: true,
        hasCreditTender: true,
        creditOverrideRequired: false,
      })
    ).toEqual([]);
    expect(
      requiredCheckoutApprovalActions({
        role: 'manager',
        hasDiscount: false,
        hasCreditTender: true,
        creditOverrideRequired: true,
      })
    ).toEqual(['credit_override']);
    expect(
      requiredCheckoutApprovalActions({
        role: 'admin',
        hasDiscount: true,
        hasCreditTender: true,
        creditOverrideRequired: true,
      })
    ).toEqual([]);
  });

  it('normalizes credit and split tenders exactly like the submitted checkout', () => {
    const item = {
      productId: 'product-1',
      unitId: 'unit-1',
      quantity: 1,
      unitPrice: 100,
      discount: 0,
    };
    expect(
      buildCheckoutApprovalContext({
        saleId: null,
        items: [item],
        values: paymentValues({
          customerId: 'customer-1',
          paymentMethod: 'credit',
          amountReceived: 100,
        }),
        grandTotal: 100,
        discountAmount: 0,
        currencyCode: 'COP',
      })
    ).toMatchObject({
      mode: 'fresh',
      saleId: null,
      customerId: 'customer-1',
      paymentMethod: 'credit',
      payments: [],
      amountReceived: 0,
      creditAmount: 100,
    });

    expect(
      buildCheckoutApprovalContext({
        saleId: 'draft-1',
        items: [item],
        values: paymentValues({
          customerId: 'customer-1',
          tenders: [
            { method: 'cash', amount: 40, reference: ' ' },
            { method: 'credit', amount: 60, reference: ' CREDIT-1 ' },
          ],
        }),
        grandTotal: 100,
        discountAmount: 0,
        currencyCode: 'COP',
      })
    ).toMatchObject({
      mode: 'fromDraft',
      saleId: 'draft-1',
      paymentMethod: 'cash',
      payments: [
        { method: 'cash', amount: 40 },
        { method: 'credit', amount: 60, reference: 'CREDIT-1' },
      ],
      amountReceived: 100,
      creditAmount: 60,
    });
  });

  it('strips renderer-only cart fields from the strict checkout request', () => {
    const rendererItem = {
      productId: 'product-1',
      unitId: 'unit-1',
      quantity: 1,
      unitPrice: 100,
      discount: 10,
      productName: 'Renderer-only name',
      availableStock: 15,
    };
    const context = buildCheckoutApprovalContext({
      saleId: null,
      items: [rendererItem],
      values: paymentValues(),
      grandTotal: 90,
      discountAmount: 10,
      currencyCode: 'COP',
    });

    expect(context.items).toEqual([
      {
        productId: 'product-1',
        unitId: 'unit-1',
        quantity: 1,
        unitPrice: 100,
        discount: 10,
      },
    ]);
  });

  it('hashes equivalent item orders to the same checkout resource', async () => {
    const context = {
      mode: 'fresh' as const,
      saleId: null,
      customerId: null,
      items: [
        { productId: 'b', unitId: 'u', quantity: 2, unitPrice: 5, discount: 0 },
        { productId: 'a', unitId: 'u', quantity: 1, unitPrice: 10, discount: 0 },
      ],
      paymentMethod: 'cash' as const,
      payments: [],
      amountReceived: 20,
      discountAmount: 0,
      total: 20,
      creditAmount: 0,
      tipAmount: 0,
      serviceChargeAmount: 0,
      currencyCode: 'COP',
    };
    await expect(hashCheckoutApprovalContext(context)).resolves.toBe(
      await hashCheckoutApprovalContext({
        ...context,
        items: [...context.items].reverse(),
      })
    );
  });
});
