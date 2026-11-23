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

/** Decimals of the payable total for a currency; 2 unless the catalog says less. */
export function payableDecimals(currencyCode: string | null | undefined): number {
  return (currencyCode ? PAYABLE_DECIMALS[currencyCode.toUpperCase()] : undefined) ?? 2;
}

export interface PayableTotal {
  /** What the customer pays: the gross total rounded to the currency's payable unit. */
  total: number;
  /** total - gross, kept explicit so the books still reconcile with the lines. */
  roundingAdjustment: number;
}

/**
 * Round a sale's gross total to the currency's payable unit, half away from
 * zero. Line and tax math stay on 2-decimal roundMoney; only the payable
 * total and what derives from it (tenders, change, cash, ledger) use this.
 */
export function resolvePayableTotal(
  grossTotal: number,
  currencyCode: string | null | undefined
): PayableTotal {
  const gross = roundMoney(grossTotal);
  const factor = 10 ** payableDecimals(currencyCode);
  const total = roundMoney(
    Math.sign(gross) * (Math.round((Math.abs(gross) + Number.EPSILON) * factor) / factor)
  );
  return { total, roundingAdjustment: roundMoney(total - gross) };
}

/** Round an amount that is paid or handed back (a tender, a refund) to the payable unit. */
export function roundPayable(value: number, currencyCode: string | null | undefined): number {
  return resolvePayableTotal(value, currencyCode).total;
}
