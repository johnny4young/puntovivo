import type {
  SalePaymentTenderValue,
  SalePaymentValues,
} from '@/features/sales/SalePaymentModal';
import type { PaymentMethod, PaymentStatus } from '@/types';

/**
 * Shape of a single forwarded tender sent to `sales.create`. Mirrors
 * `salePaymentInput` on the server (method/amount/reference, no `credit`
 * method on the split path).
 */
export interface CheckoutForwardTender {
  method: SalePaymentTenderValue['method'];
  amount: number;
  reference?: string;
}

function getDominantSplitTenderMethod(
  tenders: SalePaymentValues['tenders']
): PaymentMethod {
  const [firstTender, ...restTenders] = tenders;
  if (!firstTender) {
    return 'cash';
  }

  // Strict `>` preserves the first-seen tender on ties, which is cash-biased
  // (cash is the seeded first row). Deterministic + sensible cashier default.
  return restTenders.reduce(
    (dominantTender, tender) =>
      tender.amount > dominantTender.amount ? tender : dominantTender,
    firstTender
  ).method;
}

export function getRequestedPaymentStatus(
  values: SalePaymentValues,
  total: number
): PaymentStatus {
  if (values.tenders.length > 0) {
    return 'paid';
  }

  if (values.paymentMethod === 'credit') {
    return 'pending';
  }

  if (values.amountReceived >= total) {
    return 'paid';
  }

  if (values.amountReceived > 0) {
    return 'partial';
  }

  return 'pending';
}

/**
 * Normalizes the modal's form values into the `sales.create` payload shape.
 * Folds the "is this a split?" decision into a single place: callers get
 * back a `payments` array to forward verbatim (or undefined on the legacy
 * single-tender path), plus the legacy `paymentMethod`/`paymentStatus`/
 * `amountReceived` triplet echoed onto the sale's top-level columns.
 */
export function getCheckoutPaymentState(
  values: SalePaymentValues,
  total: number
): {
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  amountReceived: number;
  payments: CheckoutForwardTender[] | undefined;
} {
  if (values.tenders.length > 0) {
    return {
      paymentMethod: getDominantSplitTenderMethod(values.tenders),
      paymentStatus: 'paid',
      amountReceived: total,
      payments: values.tenders.map(tender => {
        const trimmedReference = tender.reference?.trim();
        return {
          method: tender.method,
          amount: tender.amount,
          // Omit the field entirely when blank — the server schema treats
          // `reference` as optional and an empty string would survive the
          // round-trip as a meaningless blank audit value.
          ...(trimmedReference ? { reference: trimmedReference } : {}),
        };
      }),
    };
  }

  return {
    paymentMethod: values.paymentMethod,
    paymentStatus: getRequestedPaymentStatus(values, total),
    amountReceived: values.paymentMethod === 'credit' ? 0 : values.amountReceived,
    payments: undefined,
  };
}
