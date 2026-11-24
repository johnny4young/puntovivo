/**
 * Round monetary values to two decimals using the POS-wide
 * shared half-away-from-zero contract.
 *
 * The absolute-value mirror keeps negative half-cent values aligned with
 * SQLite round(), while Number.EPSILON corrects common IEEE-754 boundaries
 * such as 1.005. Negative zero is normalized before values reach UI or DB.
 */
export function roundMoney(value: number): number {
  const rounded = Math.sign(value) * (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100);
  return Object.is(rounded, -0) ? 0 : rounded;
}

// Mirrors currency_catalog.display_decimals: the smallest unit a customer can
// actually pay in. A server test pins this map against the seeded catalog.
const PAYABLE_DECIMALS: Readonly<Record<string, number>> = { CLP: 0, COP: 0, PYG: 0 };

// Smallest circulating coin for optional cash-only rounding so blind cash
// closes do not suffer irreconcilable shortages on weighed or fractional sales.
const DEFAULT_CASH_ROUNDING_STEPS: Readonly<Record<string, number>> = {
  CLP: 10,
  COP: 50,
  PYG: 50,
};

export const ALLOWED_CASH_ROUNDING_STEPS = [5, 10, 50, 100] as const;

export type AllowedCashRoundingStep = (typeof ALLOWED_CASH_ROUNDING_STEPS)[number];

export function isValidCashRoundingStep(value: unknown): value is AllowedCashRoundingStep {
  return (
    typeof value === 'number' && (ALLOWED_CASH_ROUNDING_STEPS as readonly number[]).includes(value)
  );
}

/** Default smallest-coin rounding step for a currency when cash rounding is enabled. */
export function defaultCashRoundingStep(currencyCode: string | null | undefined): number | null {
  return (
    (currencyCode ? DEFAULT_CASH_ROUNDING_STEPS[currencyCode.toUpperCase()] : undefined) ?? null
  );
}

/** True when a tender list (or single legacy method) settles entirely in cash. */
export function isCashOnlyTender(args: {
  paymentMethod: string;
  payments?: readonly { method: string; amount: number }[] | undefined;
}): boolean {
  if (args.payments && args.payments.length > 0) {
    return args.payments.every(payment => payment.method === 'cash');
  }
  return args.paymentMethod === 'cash';
}

/** Decimals of the payable total for a currency; 2 unless the catalog says less. */
export function payableDecimals(currencyCode: string | null | undefined): number {
  return (currencyCode ? PAYABLE_DECIMALS[currencyCode.toUpperCase()] : undefined) ?? 2;
}

export interface PayableTotal {
  /** What the customer pays: the gross total rounded to the currency's payable unit or cash step. */
  total: number;
  /** total - gross, kept explicit so the books still reconcile with the lines. */
  roundingAdjustment: number;
}

/**
 * Round a sale's gross total to the currency's payable unit (or an explicit
 * cash-coin step such as 50 COP), half away from zero. Line and tax math stay
 * on 2-decimal roundMoney; only the payable total and what derives from it
 * (tenders, change, cash, ledger) use this.
 */
export function resolvePayableTotal(
  grossTotal: number,
  currencyCode: string | null | undefined,
  roundingStep?: number | null
): PayableTotal {
  const gross = roundMoney(grossTotal);
  if (roundingStep !== undefined && roundingStep !== null && roundingStep > 0) {
    const stepped = Math.round(Math.abs(gross) / roundingStep + Number.EPSILON) * roundingStep;
    const total = roundMoney(Math.sign(gross) * stepped);
    return { total, roundingAdjustment: roundMoney(total - gross) };
  }
  const factor = 10 ** payableDecimals(currencyCode);
  const total = roundMoney(
    Math.sign(gross) * (Math.round((Math.abs(gross) + Number.EPSILON) * factor) / factor)
  );
  return { total, roundingAdjustment: roundMoney(total - gross) };
}

/** Round an amount that is paid or handed back (a tender, a refund) to the payable unit or step. */
export function roundPayable(
  value: number,
  currencyCode: string | null | undefined,
  roundingStep?: number | null
): number {
  return resolvePayableTotal(value, currencyCode, roundingStep).total;
}
