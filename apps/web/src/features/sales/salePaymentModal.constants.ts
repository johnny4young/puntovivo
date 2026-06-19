/**
 * Constants + pure helpers for the sale payment modal.
 *
 * ENG-178 — extracted verbatim from the former single-file
 * `SalePaymentModal.tsx` during the megafile decomposition. Holds the tender
 * epsilon, tip presets, the single-tender method tiles, the form default-value
 * builder, and the tip coercion helper. No React state — safe to import from
 * the hook and the presentational sections alike.
 *
 * @module features/sales/salePaymentModal.constants
 */
import { ArrowLeftRight, Banknote, CreditCard, Landmark, MoreHorizontal } from 'lucide-react';

import type { PaymentMethod } from '@/types';
import type { SalePaymentValues } from './salePaymentModal.types';

export const TENDER_SUM_EPSILON = 0.005;
// ENG-039d — preset tip percentages. 0% is rendered as "Sin propina"
// so the cashier can explicitly clear after picking 10/15.
export const TIP_PRESETS = [0, 10, 15] as const;

// Single-tender method tiles (rediseño §06). The order + icon mapping
// mirrors the approved mockup; `credit` is gated to manager + admin
// with an attached customer (same rule as the legacy <option>) and is
// filtered out of this list when `creditMethodAvailable` is false. The
// labels reuse the existing `payment.*` i18n keys so no copy is
// duplicated. The hidden <select> below remains the registered form
// control — the tiles only drive `form.setValue('paymentMethod', …)`.
export const PAYMENT_METHOD_TILES: ReadonlyArray<{
  method: PaymentMethod;
  labelKey: string;
  icon: typeof Banknote;
}> = [
  { method: 'cash', labelKey: 'payment.cash', icon: Banknote },
  { method: 'card', labelKey: 'payment.card', icon: CreditCard },
  { method: 'transfer', labelKey: 'payment.transfer', icon: ArrowLeftRight },
  { method: 'credit', labelKey: 'payment.credit', icon: Landmark },
  { method: 'other', labelKey: 'payment.other', icon: MoreHorizontal },
];

export function getDefaultValues(
  total: number,
  serviceChargeAmount: number,
  serviceChargeRate: number
): SalePaymentValues {
  return {
    customerId: '',
    paymentMethod: 'cash',
    // ENG-039d3 — seed amountReceived at total+service so the cashier
    // sees the auto-applied service line reflected upfront. Tip layers
    // on later via `syncPaymentInputsForTip`.
    amountReceived: total + serviceChargeAmount,
    notes: '',
    tenders: [],
    tipAmount: 0,
    tipMethod: null,
    serviceChargeAmount,
    serviceChargeRate: serviceChargeRate > 0 ? serviceChargeRate : null,
    creditOverride: false,
  };
}

export function coerceTipAmount(value: unknown): number {
  if (value === '' || value === null || value === undefined) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
