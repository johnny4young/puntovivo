/**
 * Renderer compatibility facade for the shared money primitive ().
 *
 * The renderer only computes
 * display-side previews (cart summary, payment grand total, pricing
 * margins) and the server always recalculates before persisting. Keeping
 * this import path preserves existing call sites while
 * `@puntovivo/shared/money` owns the cross-runtime implementation.
 */
export {
  ALLOWED_CASH_ROUNDING_STEPS,
  defaultCashRoundingStep,
  isCashOnlyTender,
  isValidCashRoundingStep,
  payableDecimals,
  resolvePayableTotal,
  roundMoney,
  roundPayable,
  type AllowedCashRoundingStep,
  type PayableTotal,
} from '@puntovivo/shared/money';
