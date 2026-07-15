export const CHECKOUT_APPROVAL_RESOURCE_TYPE = 'sale_checkout';

export const checkoutApprovalActionEnum = [
  'sale_discount',
  'credit_sale',
  'credit_override',
] as const;

export type CheckoutApprovalAction = (typeof checkoutApprovalActionEnum)[number];

export interface CheckoutApprovalPolicyInput {
  role: string | undefined;
  isCompletion: boolean;
  hasDiscount: boolean;
  hasCreditTender: boolean;
  creditOverride: boolean;
}

/** Canonical direct-authority and escalation policy shared by UI and server. */
export function getRequiredCheckoutApprovalActions(
  input: CheckoutApprovalPolicyInput
): CheckoutApprovalAction[] {
  if (!input.isCompletion) return [];

  const actions: CheckoutApprovalAction[] = [];
  if (input.hasDiscount && input.role === 'cashier') {
    actions.push('sale_discount');
  }
  if (input.creditOverride) {
    if (input.role !== 'admin') actions.push('credit_override');
  } else if (input.hasCreditTender && input.role === 'cashier') {
    actions.push('credit_sale');
  }
  return actions;
}

export interface CheckoutApprovalItem {
  productId: string;
  unitId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

type CheckoutApprovalDiscountItem = Pick<
  CheckoutApprovalItem,
  'quantity' | 'unitPrice' | 'discount'
>;

/** Mirrors sale-line cent rounding before summing the approved discount. */
export function getCheckoutApprovalDiscountAmount(
  items: CheckoutApprovalDiscountItem[],
  headerDiscount = 0
): number {
  return items.reduce(
    (total, item) => {
      const grossAmount = roundTo(item.unitPrice * item.quantity, 2);
      const lineDiscount = roundTo(grossAmount * (item.discount / 100), 2);
      return roundTo(total + lineDiscount, 2);
    },
    roundTo(headerDiscount, 2)
  );
}

export interface CheckoutApprovalPayment {
  method: 'cash' | 'card' | 'transfer' | 'credit' | 'other';
  amount: number;
  reference?: string | null | undefined;
}

/**
 * Financial snapshot bound to a checkout approval request.
 *
 * The serializer below is consumed by both the browser and server before
 * hashing. Keeping normalization in this dependency-free shared package makes
 * a grant unusable when the cart, customer, tender mix, or final amount changes.
 */
export interface CheckoutApprovalContext {
  mode: 'fresh' | 'fromDraft';
  saleId: string | null;
  customerId: string | null;
  items: CheckoutApprovalItem[];
  paymentMethod: CheckoutApprovalPayment['method'];
  payments: CheckoutApprovalPayment[];
  amountReceived: number | null;
  discountAmount: number;
  total: number;
  creditAmount: number;
  tipAmount: number;
  serviceChargeAmount: number;
  currencyCode: string;
}

function normalizedItems(items: CheckoutApprovalItem[]) {
  return items
    .map(item => ({
      productId: item.productId,
      unitId: item.unitId,
      quantity: roundTo(item.quantity, 6),
      unitPrice: roundTo(item.unitPrice, 2),
      discount: roundTo(item.discount, 6),
    }))
    .sort((left, right) => {
      const productOrder = left.productId.localeCompare(right.productId);
      if (productOrder !== 0) return productOrder;
      const unitOrder = left.unitId.localeCompare(right.unitId);
      if (unitOrder !== 0) return unitOrder;
      return (
        left.quantity - right.quantity ||
        left.unitPrice - right.unitPrice ||
        left.discount - right.discount
      );
    });
}

function normalizedPayments(payments: CheckoutApprovalPayment[]) {
  return payments.map(payment => ({
    method: payment.method,
    amount: roundTo(payment.amount, 2),
    reference: payment.reference?.trim() || null,
  }));
}

function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Stable JSON payload; callers hash it with the platform SHA-256 API. */
export function serializeCheckoutApprovalContext(context: CheckoutApprovalContext): string {
  return JSON.stringify({
    version: 1,
    mode: context.mode,
    saleId: context.saleId,
    customerId: context.customerId,
    items: normalizedItems(context.items),
    paymentMethod: context.paymentMethod,
    payments: normalizedPayments(context.payments),
    amountReceived: context.amountReceived === null ? null : roundTo(context.amountReceived, 2),
    discountAmount: roundTo(context.discountAmount, 2),
    total: roundTo(context.total, 2),
    creditAmount: roundTo(context.creditAmount, 2),
    tipAmount: roundTo(context.tipAmount, 2),
    serviceChargeAmount: roundTo(context.serviceChargeAmount, 2),
    currencyCode: context.currencyCode.trim().toUpperCase(),
  });
}
