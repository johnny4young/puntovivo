import type { ProductSearchSelection } from '@/types';

export interface SaleCartItem {
  key: string;
  productId: string;
  productName: string;
  productSku: string;
  unitId: string;
  unitName: string;
  unitEquivalence: number;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  availableStock: number;
  sellByFraction: boolean;
  fractionStep?: number | null;
  fractionMinimum?: number | null;
}

export interface SaleCartSummary {
  itemCount: number;
  subtotal: number;
  taxAmount: number;
  total: number;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function getSaleQuantityStep(
  item: Pick<SaleCartItem, 'sellByFraction' | 'fractionStep'>
) {
  return item.sellByFraction ? Math.max(item.fractionStep ?? 0.01, 0.01) : 1;
}

export function getSaleMinimumQuantity(
  item: Pick<SaleCartItem, 'sellByFraction' | 'fractionStep' | 'fractionMinimum'>
) {
  if (!item.sellByFraction) {
    return 1;
  }

  const step = getSaleQuantityStep(item);
  return Math.max(item.fractionMinimum ?? step, step);
}

export function getCartItemKey(productId: string, unitId: string) {
  return `${productId}:${unitId}`;
}

export function buildCartItem(selection: ProductSearchSelection): SaleCartItem {
  const unitName =
    selection.unit.unitName ??
    selection.unit.unitAbbreviation ??
    selection.product.baseUnitAbbreviation ??
    selection.unit.unitId;

  return {
    key: getCartItemKey(selection.product.id, selection.unit.unitId),
    productId: selection.product.id,
    productName: selection.product.name,
    productSku: selection.product.sku,
    unitId: selection.unit.unitId,
    unitName,
    unitEquivalence: selection.unit.equivalence,
    quantity: getSaleMinimumQuantity(selection.product),
    unitPrice: selection.price,
    discount: 0,
    taxRate: selection.product.taxRate ?? 0,
    availableStock: selection.product.stock,
    sellByFraction: selection.product.sellByFraction,
    fractionStep: selection.product.fractionStep,
    fractionMinimum: selection.product.fractionMinimum,
  };
}

export function updateCartItem(
  item: SaleCartItem,
  updates: Partial<Pick<SaleCartItem, 'quantity' | 'discount' | 'unitPrice'>>
): SaleCartItem {
  return {
    ...item,
    ...updates,
  };
}

export function mergeCartItem(items: SaleCartItem[], selection: ProductSearchSelection) {
  const nextItem = buildCartItem(selection);
  const existingIndex = items.findIndex(item => item.key === nextItem.key);

  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  return items.map((item, index) =>
    index === existingIndex
      ? updateCartItem(item, {
          quantity: roundQuantity(item.quantity + getSaleQuantityStep(item)),
        })
      : item
  );
}

export function getLineTotals(item: SaleCartItem) {
  const grossAmount = item.unitPrice * item.quantity;
  const discountAmount = grossAmount * (item.discount / 100);
  const total = grossAmount - discountAmount;
  const subtotal = item.taxRate > 0 ? total / (1 + item.taxRate / 100) : total;
  const taxAmount = total - subtotal;
  const normalizedQuantity = item.quantity * item.unitEquivalence;

  return {
    subtotal: roundCurrency(subtotal),
    taxAmount: roundCurrency(taxAmount),
    total: roundCurrency(total),
    normalizedQuantity,
  };
}

export function getCartSummary(items: SaleCartItem[]): SaleCartSummary {
  return items.reduce<SaleCartSummary>(
    (summary, item) => {
      const lineTotals = getLineTotals(item);

      return {
        itemCount: summary.itemCount + item.quantity,
        subtotal: roundCurrency(summary.subtotal + lineTotals.subtotal),
        taxAmount: roundCurrency(summary.taxAmount + lineTotals.taxAmount),
        total: roundCurrency(summary.total + lineTotals.total),
      };
    },
    {
      itemCount: 0,
      subtotal: 0,
      taxAmount: 0,
      total: 0,
    }
  );
}
