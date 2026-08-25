/** Pure draft-line state and totals for quotation creation. */
import { roundMoney } from '@/lib/money';
import { splitLineTax } from '@puntovivo/shared/tax-split';

export interface DraftLine {
  /** Unique row id for stable React keys (not persisted on the server). */
  rowId: string;
  productId: string;
  quantityInput: string;
  unitPriceInput: string;
  discountInput: string;
  taxRateInput: string;
}

export interface ProductOption {
  id: string;
  name: string;
  sku: string;
  price: number;
  taxRate: number;
}

export interface ResolvedLine {
  productId: string;
  product: ProductOption | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  effectiveTaxRate: number;
  total: number;
  lineTax: number;
  /** The discount actually applied, straight from the shared split. */
  discountAmount: number;
  /** True when the row has no product picked yet (neutral, not an error). */
  isEmpty: boolean;
  /** True when a product IS picked but one of its numeric fields is invalid. */
  hasFieldError: boolean;
}

export interface QuotationTotals {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
}

let nextRowSequence = 0;

function makeRowId(): string {
  nextRowSequence += 1;
  return `line-${nextRowSequence}`;
}

export function createEmptyQuotationLine(): DraftLine {
  return {
    rowId: makeRowId(),
    productId: '',
    quantityInput: '1',
    unitPriceInput: '',
    discountInput: '0',
    taxRateInput: '',
  };
}

export function parseQuotationNumber(raw: string): number {
  if (raw.trim().length === 0) {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

// priceIncludesTax is deliberately required - see saleCart.getLineTotals.
export function resolveQuotationLine(
  line: DraftLine,
  productById: ReadonlyMap<string, ProductOption>,
  priceIncludesTax: boolean
): ResolvedLine {
  const product = line.productId ? (productById.get(line.productId) ?? null) : null;
  const quantity = parseQuotationNumber(line.quantityInput);
  const unitPrice = parseQuotationNumber(line.unitPriceInput);
  const discount = parseQuotationNumber(line.discountInput);
  const taxRate = parseQuotationNumber(line.taxRateInput);

  const isEmpty = !product;
  const hasFieldError =
    !!product &&
    (Number.isNaN(quantity) ||
      quantity <= 0 ||
      Number.isNaN(unitPrice) ||
      unitPrice < 0 ||
      Number.isNaN(discount) ||
      discount < 0 ||
      discount > 100 ||
      Number.isNaN(taxRate) ||
      taxRate < 0);

  const safeQuantity = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
  const safeUnitPrice = Number.isFinite(unitPrice) ? Math.max(0, unitPrice) : 0;
  const safeDiscount = Number.isFinite(discount) ? Math.max(0, Math.min(100, discount)) : 0;
  const effectiveTaxRate = taxRate > 0 ? taxRate : (product?.taxRate ?? 0);

  // Same shared split as the server quotation engine, so the draft
  // preview matches the stored header in either pricing mode.
  const split = splitLineTax({
    unitPrice: safeUnitPrice,
    quantity: safeQuantity,
    discountPercent: safeDiscount,
    taxRate: effectiveTaxRate,
    priceIncludesTax,
  });

  return {
    productId: line.productId,
    product,
    quantity: safeQuantity,
    unitPrice: safeUnitPrice,
    discount: safeDiscount,
    taxRate,
    effectiveTaxRate,
    total: split.lineTotal,
    lineTax: split.lineTax,
    discountAmount: split.discountAmount,
    isEmpty,
    hasFieldError,
  };
}

export function calculateQuotationTotals(resolvedLines: readonly ResolvedLine[]): QuotationTotals {
  let subtotal = 0;
  let taxAmount = 0;
  let discountAmount = 0;
  let total = 0;

  for (const line of resolvedLines) {
    const base = roundMoney(line.total - line.lineTax);
    subtotal = roundMoney(subtotal + base);
    taxAmount = roundMoney(taxAmount + line.lineTax);
    discountAmount = roundMoney(discountAmount + line.discountAmount);
    total = roundMoney(total + line.total);
  }

  return { subtotal, taxAmount, discountAmount, total };
}
