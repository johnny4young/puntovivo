import { roundMoney } from './money.ts';

/**
 * The one line-level tax split, shared by the server sale engine, the
 * server quotation engine, and the web cart previews.
 *
 * Before this module the inclusive split (`lineTotal / (1 + rate)`) was
 * hand-copied in six places across two processes; a pricing-mode seam
 * landing in only one of them would silently show the cashier a total the
 * server would not charge.
 *
 * Two pricing modes, selected per tenant:
 *
 * - `priceIncludesTax: true` (the default, and the only behavior before
 *   this seam existed): the catalog price is what the customer pays; the
 *   tax is extracted FROM the discounted line total.
 * - `priceIncludesTax: false`: the catalog price is the pre-tax base; the
 *   tax is added ON TOP of the discounted base.
 *
 * In BOTH modes the returned `lineTotal` is what the customer pays for
 * the line (tax inclusive), `lineBase` is the pre-tax base and `lineTax`
 * the tax portion — so every downstream consumer (payments, receipts,
 * fiscal serializers reconstructing net amounts from `lineTotal` and
 * `taxAmount`) keeps its semantics regardless of the mode.
 *
 * Every intermediate is `roundMoney`-ed to two decimals before it is used
 * again (the uniform money-rounding rule): the inclusive division produces non-terminating
 * decimals the storage layer's `chk_*_2dec` CHECKs would reject, and a
 * long line list would otherwise stack sub-cent drift.
 */
export interface TaxSplitInput {
  /** Catalog unit price — gross when inclusive, pre-tax when exclusive. */
  unitPrice: number;
  quantity: number;
  /** Percent, 0-100. */
  discountPercent: number;
  /** Percent, 0-100. */
  taxRate: number;
  priceIncludesTax: boolean;
}

export interface TaxSplitResult {
  /** Pre-tax base after the line discount. */
  lineBase: number;
  /** Tax portion of the line. */
  lineTax: number;
  /** What the customer pays for the line, in both modes. */
  lineTotal: number;
  /** The discount amount actually applied, for audit surfaces. */
  discountAmount: number;
}

export function splitLineTax(input: TaxSplitInput): TaxSplitResult {
  const gross = roundMoney(input.unitPrice * input.quantity);
  const discountAmount = roundMoney(gross * (input.discountPercent / 100));
  const discounted = roundMoney(gross - discountAmount);

  if (input.taxRate <= 0) {
    return { lineBase: discounted, lineTax: 0, lineTotal: discounted, discountAmount };
  }

  if (input.priceIncludesTax) {
    const lineBase = roundMoney(discounted / (1 + input.taxRate / 100));
    const lineTax = roundMoney(discounted - lineBase);
    return { lineBase, lineTax, lineTotal: discounted, discountAmount };
  }

  const lineTax = roundMoney(discounted * (input.taxRate / 100));
  const lineTotal = roundMoney(discounted + lineTax);
  return { lineBase: discounted, lineTax, lineTotal, discountAmount };
}
