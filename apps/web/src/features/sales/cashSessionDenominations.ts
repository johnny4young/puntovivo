import type { CashSessionDenomination } from '@/types';

export const CASH_SESSION_DENOMINATION_VALUES = [
  100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50,
] as const;

export interface CashDenominations {
  /** Every note and coin in circulation, largest first. */
  values: readonly number[];
  /** Values below this are coins. */
  smallestNote: number;
  /** Banknote colour by value, for recognising a note at a glance. */
  noteColors: Readonly<Record<number, string>>;
}

const CASH_DENOMINATIONS: Readonly<Record<string, CashDenominations>> = {
  COP: {
    values: CASH_SESSION_DENOMINATION_VALUES,
    smallestNote: 1000,
    noteColors: {
      100000: '#2f7d5b',
      50000: '#6b4fa0',
      20000: '#d9822b',
      10000: '#b8443a',
      5000: '#8a6a4f',
      2000: '#2f6fb0',
      1000: '#c9a227',
    },
  },
  MXN: {
    values: [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5],
    smallestNote: 20,
    noteColors: {
      1000: '#6b7280',
      500: '#2f6fb0',
      200: '#2f7d5b',
      100: '#b8443a',
      50: '#a0457e',
      20: '#2f8f8f',
    },
  },
  CLP: {
    values: [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 10],
    smallestNote: 1000,
    noteColors: {
      20000: '#d9822b',
      10000: '#2f6fb0',
      5000: '#b8443a',
      2000: '#6b4fa0',
      1000: '#2f7d5b',
    },
  },
  PEN: {
    values: [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1],
    smallestNote: 10,
    noteColors: {
      200: '#8a8f98',
      100: '#2f6fb0',
      50: '#d9822b',
      20: '#8a6a4f',
      10: '#2f7d5b',
    },
  },
  USD: {
    values: [100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05, 0.01],
    smallestNote: 1,
    noteColors: {},
  },
};

/** Notes and coins for a currency, or null when it is not catalogued. */
export function getCashDenominations(currencyCode: string): CashDenominations | null {
  return CASH_DENOMINATIONS[currencyCode.toUpperCase()] ?? null;
}

export function createCashSessionDenominations(): CashSessionDenomination[] {
  return CASH_SESSION_DENOMINATION_VALUES.map(value => ({
    value,
    count: 0,
  }));
}

export function getCashSessionCountedTotal(
  denominations: readonly CashSessionDenomination[]
): number {
  return denominations.reduce((total, denomination) => {
    return total + denomination.value * denomination.count;
  }, 0);
}

export function cashSessionTotalsMatch(
  openingFloat: number,
  denominations: readonly CashSessionDenomination[]
): boolean {
  return Math.abs(openingFloat - getCashSessionCountedTotal(denominations)) < 1e-6;
}
