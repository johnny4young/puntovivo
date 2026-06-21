/**
 * Quotation service — timestamp + totals math (ENG-178 split).
 *
 * `getTimestamp` + `computeQuotationTotals` (ENG-176a two-decimal rounding).
 *
 * @module services/quotations/pricing
 */
import { nanoid } from 'nanoid';
import { roundMoney } from '../../lib/money.js';

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
 * — they enter the customer-facing number, not the tax-exclusive base.
 */
export function computeQuotationTotals(
  rawLines: readonly QuotationItemInput[],
  productTaxRateById: ReadonlyMap<string, number>
): QuotationTotals {
  let subtotal = 0;
  let taxAmount = 0;
  let discountAmount = 0;

  // ENG-176a-rounding — mirror completeSale.ts: round every derived
  // monetary quantity to two decimals before accumulation, and round
  // the running totals after each iteration so a long line list does
  // not stack sub-cent drift.
  const rows: ResolvedQuotationLine[] = rawLines.map(line => {
    const grossLine = roundMoney(line.unitPrice * line.quantity);
    const lineDiscountAmount = roundMoney(grossLine * (line.discount / 100));
    const lineTotal = roundMoney(grossLine - lineDiscountAmount);
    // Resolve VAT rate: per-line input wins; product VAT is the fallback.
    const effectiveTaxRate =
      line.taxRate > 0 ? line.taxRate : productTaxRateById.get(line.productId) ?? 0;
    const lineBase = roundMoney(
      effectiveTaxRate > 0 ? lineTotal / (1 + effectiveTaxRate / 100) : lineTotal
    );
    const lineTax = roundMoney(lineTotal - lineBase);

    subtotal = roundMoney(subtotal + lineBase);
    taxAmount = roundMoney(taxAmount + lineTax);
    discountAmount = roundMoney(discountAmount + lineDiscountAmount);

    return {
      id: nanoid(),
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: roundMoney(line.unitPrice),
      discount: roundMoney(line.discount),
      taxRate: effectiveTaxRate,
      taxAmount: lineTax,
      total: lineTotal,
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
