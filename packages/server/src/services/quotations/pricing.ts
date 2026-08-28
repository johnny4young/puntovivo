/**
 * Quotation service — timestamp + totals math ( split).
 *
 * `getTimestamp` + `computeQuotationTotals` ( two-decimal rounding).
 *
 * @module services/quotations/pricing
 */
import { nanoid } from 'nanoid';
import { roundMoney } from '../../lib/money.js';
import {
  calculateTaxComponentSnapshots,
  legacyComponent,
  summarizeTaxComponents,
  type TaxComponentDefinition,
} from '../tax-components.js';
import type { QuotationItemInput, ResolvedQuotationLine, QuotationTotals } from './types.js';

export interface QuotationProductTaxProfile {
  components: TaxComponentDefinition[];
}

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
  productTaxProfileById: ReadonlyMap<string, QuotationProductTaxProfile>,
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
    const productTaxProfile = productTaxProfileById.get(line.productId) ?? {
      components: [legacyComponent({ vatRateId: null, taxKind: 'iva', taxRate: 0 })],
    };
    const catalogSummary = summarizeTaxComponents(productTaxProfile.components);
    const effectiveTaxRate = line.taxRate > 0 ? line.taxRate : catalogSummary.taxRate;
    const components =
      line.taxRate > 0 && productTaxProfile.components.length === 1
        ? [{ ...productTaxProfile.components[0]!, taxRate: line.taxRate }]
        : productTaxProfile.components;
    const split = calculateTaxComponentSnapshots({
      components,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      discountPercent: line.discount,
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
      taxKind: components[0]!.taxKind,
      taxAmount: split.lineTax,
      taxComponents: split.components,
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
