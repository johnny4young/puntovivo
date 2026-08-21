/**
 * per-kind tax classification for fiscal documents.
 *
 * The DIAN-side structure existed before the transactional side could
 * feed it: the CUFE algorithm already interleaves '01' IVA / '04' INC /
 * '03' ICA, and `fiscal_document_items.tax_category_code` already holds
 * the per-line code — but both the emit and enqueue paths hardcoded '01'
 * and passed `incAmount: 0` in duplicated blocks. This leaf is the one
 * place that maps the sale line's frozen `taxKind` to the DIAN category
 * and buckets the header totals, so the two paths can never drift again.
 *
 * ICA is a municipal tax Puntovivo does not model on sale lines; its slot
 * stays zero until it exists in the catalog.
 *
 * @module services/fiscal/orchestrator/tax-lines
 */

import { roundMoney } from '../../../lib/money.js';
import type { TaxKind } from '../../../db/schema.js';
import type { FiscalAdapterLine } from '../adapter.js';
import type { ResolvedLine } from './types.js';

/** DIAN tax category code for a sale line's frozen kind. */
export function taxCategoryCodeFor(kind: TaxKind): string {
  return kind === 'inc' ? '04' : '01';
}

/** Build the adapter lines the packs consume, one source for both paths. */
export function toAdapterLines(lines: readonly ResolvedLine[]): FiscalAdapterLine[] {
  return lines.map(line => ({
    lineNumber: line.lineNumber,
    productName: line.productName,
    productSku: line.productSku ?? null,
    // The unit catalog's UN/ECE code (KGM, LTR, H87...) so a
    // weighed kilogram line serializes as KGM in the UBL unitCode /
    // CFDI ClaveUnidad; EA remains the fallback for legacy units.
    unitMeasureCode: line.unitStandardCode ?? 'EA',
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    taxRate: line.taxRate,
    taxAmount: line.taxAmount,
    taxCategoryCode: taxCategoryCodeFor(line.taxKind),
    lineTotal: line.lineTotal,
  }));
}

/**
 * The frozen per-line row both write paths insert into
 * `fiscal_document_items`. One builder so the sync emit and the outbox
 * enqueue can never drift on a per-line field again - the hardcoded-'01'
 * bug existed precisely because this mapping was duplicated.
 */
export function toDocumentItemValues(fiscalDocumentId: string, line: ResolvedLine) {
  return {
    fiscalDocumentId,
    lineNumber: line.lineNumber,
    productId: line.productId,
    productName: line.productName,
    productSku: line.productSku,
    unitMeasureCode: line.unitStandardCode ?? 'EA',
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    taxRate: line.taxRate,
    taxAmount: line.taxAmount,
    taxCategoryCode: taxCategoryCodeFor(line.taxKind),
    lineTotal: line.lineTotal,
  };
}

export interface HeaderTaxTotals {
  ivaAmount: number;
  incAmount: number;
}

/**
 * Bucket the header tax totals by kind from the frozen lines, rounding
 * each accumulation per the uniform money-rounding rule. Feeds the CUFE's '01' and '04' slots —
 * before this, `incAmount` was always zero and an INC sale hashed its
 * consumption tax into the IVA slot.
 */
export function sumTaxTotals(lines: readonly ResolvedLine[]): HeaderTaxTotals {
  let ivaAmount = 0;
  let incAmount = 0;
  for (const line of lines) {
    if (line.taxKind === 'inc') {
      incAmount = roundMoney(incAmount + line.taxAmount);
    } else {
      ivaAmount = roundMoney(ivaAmount + line.taxAmount);
    }
  }
  return { ivaAmount, incAmount };
}
