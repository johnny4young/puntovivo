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
import { throwServerError } from '../../../lib/errorCodes.js';
import type { TaxKind } from '../../../db/schema.js';
import type { FiscalAdapterLine } from '../adapter.js';
import type { ResolvedLine } from './types.js';

/** Compatibility bridge for in-memory callers and historical rows. */
export function getResolvedLineTaxComponents(line: ResolvedLine) {
  return line.taxComponents?.length
    ? line.taxComponents
    : [
        {
          componentKey: `legacy:${line.taxKind}:${Number(line.taxRate).toFixed(6)}`,
          vatRateId: null,
          taxKind: line.taxKind,
          taxRate: line.taxRate,
          taxableAmount: roundMoney(line.lineTotal - line.taxAmount),
          taxAmount: line.taxAmount,
          position: 0,
        },
      ];
}

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
    taxComponents: getResolvedLineTaxComponents(line).map(component => ({
      componentKey: component.componentKey,
      taxKind: component.taxKind,
      taxRate: component.taxRate,
      taxableAmount: component.taxableAmount,
      taxAmount: component.taxAmount,
      taxCategoryCode: taxCategoryCodeFor(component.taxKind),
      position: component.position,
    })),
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

export function toDocumentTaxComponentValues(
  tenantId: string,
  fiscalDocumentItemId: string,
  component: ReturnType<typeof getResolvedLineTaxComponents>[number]
) {
  return {
    tenantId,
    fiscalDocumentItemId,
    componentKey: component.componentKey,
    taxKind: component.taxKind,
    taxCategoryCode: taxCategoryCodeFor(component.taxKind),
    taxRate: component.taxRate,
    taxableAmount: component.taxableAmount,
    taxAmount: component.taxAmount,
    position: component.position,
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
    for (const component of getResolvedLineTaxComponents(line)) {
      if (component.taxKind === 'inc') {
        incAmount = roundMoney(incAmount + component.taxAmount);
      } else {
        ivaAmount = roundMoney(ivaAmount + component.taxAmount);
      }
    }
  }
  return { ivaAmount, incAmount };
}

/**
 * The fiscal header remains a compatibility total while IVA and INC are
 * represented separately. Refuse emission when the frozen line buckets do
 * not reconstruct that header exactly at the money boundary.
 */
export function assertFiscalTaxHeaderParity(
  headerTaxAmount: number,
  totals: HeaderTaxTotals
): void {
  const lineTaxAmount = roundMoney(totals.ivaAmount + totals.incAmount);
  const normalizedHeader = roundMoney(headerTaxAmount);
  if (lineTaxAmount === normalizedHeader) return;

  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'FISCAL_TAX_TOTAL_MISMATCH',
    message: 'Fiscal tax buckets do not match the frozen sale tax header',
    details: {
      headerTaxAmount: normalizedHeader,
      ivaAmount: totals.ivaAmount,
      incAmount: totals.incAmount,
      lineTaxAmount,
    },
  });
}
