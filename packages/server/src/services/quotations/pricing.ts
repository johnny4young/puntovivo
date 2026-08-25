/**
 * Quotation service — timestamp + totals math ( split).
 *
 * `getTimestamp` + `computeQuotationTotals` ( two-decimal rounding).
 *
 * @module services/quotations/pricing
 */
import { nanoid } from 'nanoid';
import { roundMoney } from '../../lib/money.js';
import { splitLineTax } from '@puntovivo/shared/tax-split';

import type { QuotationItemInput, ResolvedQuotationLine, QuotationTotals } from './types.js';

export function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Per-line totals helper.
 *
 * Tax model (mirrors sales): the supplied `unitPrice` is treated as the
 * gross/with-tax amount per unit, so the line's tax is extracted from the
 * post-discount total. This matches how operators quote prices in the field
 * they enter the customer-facing number, not the tax-exclusive base.
 */
export function computeQuotationTotals(
  rawLines: readonly QuotationItemInput[],
  productTaxRateById: ReadonlyMap<string, number>,
  // REQUIRED - see CreateQuotationArgs.priceIncludesTax.
  options: { priceIncludesTax: boolean }
): QuotationTotals {
  let subtotal = 0;
  let taxAmount = 0;
  let discountAmount = 0;
  const priceIncludesTax = options.priceIncludesTax;

  // mirror completeSale.ts through the SAME shared
  // `splitLineTax` (rounding every derived quantity to two decimals
  // before accumulation, and the running totals after each iteration so
  // a long line list does not stack sub-cent drift).
  const rows: ResolvedQuotationLine[] = rawLines.map(line => {
    // Resolve VAT rate: per-line input wins; product VAT is the fallback.
    const effectiveTaxRate =
      line.taxRate > 0 ? line.taxRate : (productTaxRateById.get(line.productId) ?? 0);
    const split = splitLineTax({
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      discountPercent: line.discount,
      taxRate: effectiveTaxRate,
      priceIncludesTax,
    });

    subtotal = roundMoney(subtotal + split.lineBase);
    taxAmount = roundMoney(taxAmount + split.lineTax);
    discountAmount = roundMoney(discountAmount + split.discountAmount);

    return {
      id: nanoid(),
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: roundMoney(line.unitPrice),
      discount: roundMoney(line.discount),
      taxRate: effectiveTaxRate,
      taxAmount: split.lineTax,
      total: split.lineTotal,
    };
  });

  return {
    subtotal,
    taxAmount,
    discountAmount,
    total: roundMoney(subtotal + taxAmount),
    rows,
  };
}
