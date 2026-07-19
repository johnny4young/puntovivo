import {
  serializeCheckoutApprovalContext,
  getRequiredCheckoutApprovalActions,
  type CheckoutApprovalAction,
  type CheckoutApprovalContext,
  type CheckoutApprovalItem,
} from '@puntovivo/shared/checkout-approval';
import type { SalePaymentValues } from './salePaymentModal.types';
import { getCheckoutPaymentState } from './checkoutPayment';

export interface BuildCheckoutApprovalContextInput {
  saleId: string | null;
  items: CheckoutApprovalItem[];
  values: SalePaymentValues;
  grandTotal: number;
  discountAmount: number;
  currencyCode: string;
}

export function buildCheckoutApprovalContext({
  saleId,
  items,
  values,
  grandTotal,
  discountAmount,
  currencyCode,
}: BuildCheckoutApprovalContextInput): CheckoutApprovalContext {
  const payment = getCheckoutPaymentState(values, grandTotal);
  const creditAmount = payment.payments
    ? payment.payments
        .filter(tender => tender.method === 'credit')
        .reduce((sum, tender) => sum + tender.amount, 0)
    : payment.paymentMethod === 'credit'
      ? grandTotal
      : 0;

  return {
    mode: saleId ? 'fromDraft' : 'fresh',
    saleId,
    customerId: values.customerId || null,
    // Cart rows carry renderer-only inventory and presentation fields. Keep the
    // request payload identical to the strict server contract instead of
    // relying on TypeScript's structural assignability to strip them.
    items: items.map(({ productId, unitId, quantity, unitPrice, discount }) => ({
      productId,
      unitId,
      quantity,
      unitPrice,
      discount,
    })),
    paymentMethod: payment.paymentMethod,
    payments: payment.payments ?? [],
    amountReceived: payment.amountReceived ?? null,
    discountAmount,
    total: grandTotal,
    creditAmount,
    tipAmount: Math.max(0, values.tipAmount),
    serviceChargeAmount: Math.max(0, values.serviceChargeAmount),
    currencyCode,
  };
}

export function requiredCheckoutApprovalActions(input: {
  role: string | undefined;
  hasDiscount: boolean;
  hasCreditTender: boolean;
  creditOverrideRequired: boolean;
}): CheckoutApprovalAction[] {
  return getRequiredCheckoutApprovalActions({
    role: input.role,
    isCompletion: true,
    hasDiscount: input.hasDiscount,
    hasCreditTender: input.hasCreditTender,
    creditOverride: input.creditOverrideRequired,
  });
}

export async function hashCheckoutApprovalContext(
  context: CheckoutApprovalContext
): Promise<string> {
  return hashCheckoutApprovalPayload(serializeCheckoutApprovalContext(context));
}

export async function hashCheckoutApprovalPayload(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(
    ''
  );
  return `checkout:sha256:${hex}`;
}
