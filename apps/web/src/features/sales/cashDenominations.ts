/** Bills and coins in circulation, largest first, for currencies with a known cash set. */
interface CurrencyCash {
  bills: readonly number[];
  coins: readonly number[];
}

const CURRENCY_CASH: Readonly<Record<string, CurrencyCash>> = {
  COP: { bills: [100000, 50000, 20000, 10000, 5000, 2000], coins: [1000, 500, 200, 100, 50] },
  CLP: { bills: [20000, 10000, 5000, 2000, 1000], coins: [500, 100, 50, 10] },
  MXN: { bills: [1000, 500, 200, 100, 50, 20], coins: [10, 5, 2, 1, 0.5] },
  PEN: { bills: [200, 100, 50, 20, 10], coins: [5, 2, 1, 0.5, 0.2, 0.1] },
  USD: { bills: [100, 50, 20, 10, 5, 1], coins: [0.25, 0.1, 0.05, 0.01] },
};

/** Every bill and coin of the currency, largest first; empty when unknown. */
export function cashDenominationsFor(currencyCode: string): number[] {
  const cash = CURRENCY_CASH[currencyCode.toUpperCase()];
  return cash ? [...cash.bills, ...cash.coins] : [];
}

/** True when the value is a coin of a currency with a known cash set. */
export function isCashCoin(value: number, currencyCode: string): boolean {
  return CURRENCY_CASH[currencyCode.toUpperCase()]?.coins.includes(value) ?? false;
}

export interface ChangeBreakdown {
  bills: Array<{ value: number; count: number }>;
  /** What is left for coins, summed; zero when bills cover the change. */
  coins: number;
}

/**
 * One way to hand over the change: as few bills as possible, the rest in coins.
 * Null when the currency has no known cash set or there is no change.
 */
export function changeBreakdown(change: number, currencyCode: string): ChangeBreakdown | null {
  const cash = CURRENCY_CASH[currencyCode.toUpperCase()];
  // Whole cents keep 0.1 + 0.2 style float drift out of the greedy split.
  let remaining = Math.round(change * 100);
  if (!cash || remaining <= 0) return null;
  const bills: ChangeBreakdown['bills'] = [];
  for (const value of cash.bills) {
    const cents = Math.round(value * 100);
    const count = Math.floor(remaining / cents);
    if (count > 0) {
      bills.push({ value, count });
      remaining -= count * cents;
    }
  }
  return { bills, coins: remaining / 100 };
}
