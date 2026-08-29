import { roundMoney } from '../../lib/money.js';
import type { TaxKind } from '../../db/schema.js';

export interface ReceiptTaxLineSnapshot {
  taxKind: TaxKind;
  taxAmount: number;
}

export interface ReceiptTaxItemSnapshot {
  taxComponents: readonly ReceiptTaxLineSnapshot[];
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

/**
 * Summarize normalized line-tax snapshots rather than the legacy scalar
 * compatibility columns on their parent items. A mixed IVA + INC line stores
 * its combined rate and amount on the parent, so treating that parent as one
 * tax line silently assigns the complete amount to whichever kind appears
 * first.
 */
export function summarizeItemTaxBreakdown(items: readonly ReceiptTaxItemSnapshot[]): {
  iva: number | null;
  inc: number | null;
} {
  return summarizeTaxBreakdown(items.flatMap(item => item.taxComponents));
}
