import { roundMoney } from '../../lib/money.js';
import type { TaxKind } from '../../db/schema.js';

export interface ReceiptTaxLineSnapshot {
  taxKind: TaxKind;
  taxAmount: number;
}

/** Preserve both presence and rounded value so an exempt IVA line is not mistaken for no IVA. */
export function summarizeTaxBreakdown(lines: readonly ReceiptTaxLineSnapshot[]): {
  iva: number | null;
  inc: number | null;
} {
  let iva: number | null = null;
  let inc: number | null = null;
  for (const line of lines) {
    if (line.taxKind === 'inc') {
      inc = roundMoney((inc ?? 0) + line.taxAmount);
    } else {
      iva = roundMoney((iva ?? 0) + line.taxAmount);
    }
  }
  return { iva, inc };
}
